import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

export type ComposerMode = "prompt" | "command" | "shell";

export interface ComposerCommand {
  name: string;
  description?: string;
  source?: string;
}

export interface ComposerFileReference {
  token: string;
  path: string;
  absolutePath?: string;
  content?: string;
  error?: string;
}

export interface ParsedComposerInput {
  raw: string;
  trimmed: string;
  mode: ComposerMode;
  commandName?: string;
  commandArgument?: string;
  shellCommand?: string;
  fileReferences: ComposerFileReference[];
  /** A locally registered command, as opposed to a Pi prompt/skill command. */
  localCommand: boolean;
}

export interface ComposerResolutionOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  allowedExtensions?: readonly string[];
}

export interface ResolvedComposerInput extends ParsedComposerInput {
  prompt: string;
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const DEFAULT_TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".css", ".csv", ".d.ts", ".go", ".html", ".java", ".js", ".json",
  ".jsx", ".md", ".mdx", ".mjs", ".mmd", ".py", ".rs", ".sh", ".sql", ".svelte", ".toml",
  ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml",
]);

function normalizedCommands(commands: readonly ComposerCommand[]): Set<string> {
  return new Set(commands.map((command) => command.name.replace(/^\//, "").trim().toLowerCase()).filter(Boolean));
}

function unescapePath(value: string): string {
  return value.replace(/\\([\\\s])/g, "$1");
}

function parseFileReferences(source: string): ComposerFileReference[] {
  const references: ComposerFileReference[] = [];
  const seen = new Set<string>();
  // Keep the syntax deliberately shell-like: @path, @"path with spaces", or
  // @path/to/file. A trailing comma/period is prose punctuation, not a path.
  const pattern = /(^|\s)@("[^"]+"|'[^']+'|[^\s]+)/g;
  for (const match of source.matchAll(pattern)) {
    const quoted = match[2] ?? "";
    const path = unescapePath(
      quoted.startsWith('"') || quoted.startsWith("'") ? quoted.slice(1, -1) : quoted,
    ).replace(/[),.;:!?]+$/, "");
    if (!path || seen.has(path)) continue;
    seen.add(path);
    references.push({ token: `@${path}`, path });
  }
  return references;
}

/** Parse the terminal grammar without touching the filesystem or RPC. */
export function parseComposerInput(
  raw: string,
  commands: readonly ComposerCommand[] = [],
): ParsedComposerInput {
  const trimmed = raw.trim();
  const fileReferences = parseFileReferences(raw);
  const known = normalizedCommands(commands);
  if (trimmed.startsWith("!")) {
    return {
      raw,
      trimmed,
      mode: "shell",
      shellCommand: trimmed.slice(1).trim(),
      fileReferences,
      localCommand: false,
    };
  }
  if (trimmed.startsWith("/")) {
    const match = /^\/([^\s]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
    const commandName = match?.[1]?.toLowerCase();
    return {
      raw,
      trimmed,
      mode: "command",
      ...(commandName ? { commandName } : {}),
      ...(match?.[2] !== undefined ? { commandArgument: match[2] } : {}),
      fileReferences,
      localCommand: commandName ? known.has(commandName) : false,
    };
  }
  return { raw, trimmed, mode: "prompt", fileReferences, localCommand: false };
}

function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${candidate.includes("\\") ? "\\" : "/"}`));
}

function extensionAllowed(path: string, allowedExtensions: ReadonlySet<string>): boolean {
  const extension = extname(path).toLowerCase();
  // Files without an extension are common in projects (Makefile, Dockerfile,
  // LICENSE). They are admitted and still checked for binary bytes below.
  return !extension || allowedExtensions.has(extension);
}

/**
 * Resolve @file references into a bounded, text-only prompt appendix. The
 * original draft is never discarded, even when one reference is invalid.
 */
export async function resolveComposerInput(
  parsed: ParsedComposerInput,
  cwd: string,
  options: ComposerResolutionOptions = {},
): Promise<ResolvedComposerInput> {
  if (parsed.fileReferences.length === 0 || parsed.mode !== "prompt") {
    return { ...parsed, prompt: parsed.trimmed };
  }
  const root = await realpath(cwd).catch(() => resolve(cwd));
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const allowedExtensions = new Set(
    (options.allowedExtensions ?? [...DEFAULT_TEXT_EXTENSIONS]).map((extension) => extension.toLowerCase()),
  );
  let totalBytes = 0;
  const fileReferences: ComposerFileReference[] = [];
  const blocks: string[] = [];
  for (const reference of parsed.fileReferences) {
    const candidate = resolve(cwd, reference.path);
    const safeReference: ComposerFileReference = { ...reference, absolutePath: candidate };
    try {
      const info = await lstat(candidate);
      if (!info.isFile()) throw new Error("is not a regular file");
      const resolved = await realpath(candidate);
      if (!pathIsWithin(root, resolved)) throw new Error("is outside the project directory");
      if (!extensionAllowed(resolved, allowedExtensions)) throw new Error("does not look like a text file");
      const size = (await stat(resolved)).size;
      if (size > maxFileBytes) throw new Error(`is larger than ${maxFileBytes} bytes`);
      if (totalBytes + size > maxTotalBytes) throw new Error(`would exceed the ${maxTotalBytes}-byte reference budget`);
      const content = await readFile(resolved, "utf8");
      if (content.includes("\u0000")) throw new Error("contains binary data");
      totalBytes += Buffer.byteLength(content, "utf8");
      safeReference.absolutePath = resolved;
      safeReference.content = content;
      fileReferences.push(safeReference);
      const displayPath = relative(root, resolved) || reference.path;
      blocks.push(
        `<file path="${displayPath.replaceAll('"', "&quot;")}">` +
          "\n" + content + "\n</file>",
      );
    } catch (error) {
      safeReference.error = error instanceof Error ? error.message : String(error);
      fileReferences.push(safeReference);
    }
  }
  const prompt = blocks.length > 0
    ? `${parsed.trimmed}\n\n${blocks.join("\n\n")}`
    : parsed.trimmed;
  return {
    ...parsed,
    fileReferences,
    prompt,
  };
}

export interface ComposerSuggestion extends ComposerCommand {
  score: number;
}

function fuzzyScore(candidate: string, query: string): number {
  const value = candidate.toLowerCase();
  const needle = query.replace(/^\//, "").toLowerCase();
  if (!needle) return 0;
  if (value === needle) return 100;
  if (value.startsWith(needle)) return 80 - value.length;
  if (value.includes(needle)) return 50 - value.indexOf(needle);
  let cursor = 0;
  let score = 0;
  for (const character of needle) {
    const index = value.indexOf(character, cursor);
    if (index === -1) return -1;
    score += index === cursor ? 4 : 1;
    cursor = index + 1;
  }
  return score;
}

/** Rank slash-command completions for the current composer token. */
export function commandSuggestions(
  query: string,
  commands: readonly ComposerCommand[],
  limit = 8,
): ComposerSuggestion[] {
  return commands
    .map((command) => ({ ...command, score: fuzzyScore(command.name, query) }))
    .filter((command) => command.score >= 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, Math.max(1, limit));
}

/** Human-readable validation text for an @ reference failure. */
export function composerReferenceErrors(input: ResolvedComposerInput): string[] {
  return input.fileReferences
    .filter((reference) => reference.error)
    .map((reference) => `${reference.token}: ${reference.error}`);
}
