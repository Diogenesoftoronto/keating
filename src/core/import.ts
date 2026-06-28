import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { ensureKeatingDirs, sessionsDir } from "./paths.js";
import { slugify } from "./util.js";
import {
  addUniqueExamples,
  inferFormat,
  parseAlpaca,
  parseChatMl,
  parseJsonl,
  type FineTuneImportFormat,
  type ImportedExample,
} from "../../shared/finetune-parse.js";

export type { FineTuneImportFormat };

export interface KeatingImportOptions {
  sourcePath: string;
  format?: FineTuneImportFormat;
  title?: string;
}

export interface KeatingImportResult {
  filesRead: number;
  examplesImported: number;
  sessionsImported: number;
  skipped: number;
  /** Paths of every reconstructed session file (one per imported example). */
  sessionPaths: string[];
  /** First reconstructed session path, for convenience. */
  sessionPath: string;
  warnings: string[];
}

async function importFiles(
  sourcePath: string,
  format: FineTuneImportFormat,
): Promise<Array<{ path: string; format: Exclude<FineTuneImportFormat, "auto"> }>> {
  const info = await stat(sourcePath);
  if (info.isFile()) return [{ path: sourcePath, format: inferFormat(basename(sourcePath), format) }];
  if (!info.isDirectory()) throw new Error(`Import source is not a file or directory: ${sourcePath}`);

  const candidates = [
    { name: "train.chatml.jsonl", format: "chatml" as const },
    { name: "keating-finetune.chatml.jsonl", format: "chatml" as const },
    { name: "train.alpaca.jsonl", format: "alpaca" as const },
    { name: "keating-finetune.alpaca.jsonl", format: "alpaca" as const },
  ];
  const files: Array<{ path: string; format: Exclude<FineTuneImportFormat, "auto"> }> = [];
  for (const candidate of candidates) {
    const path = join(sourcePath, candidate.name);
    const exists = await stat(path).then((value) => value.isFile(), () => false);
    if (exists && (format === "auto" || format === candidate.format)) {
      files.push({ path, format: candidate.format });
    }
  }
  if (files.length === 0) throw new Error(`No supported fine-tune JSONL files found in ${sourcePath}.`);
  return files;
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** Builds a single reconstructed session record from one imported example. */
function sessionFromExample(example: ImportedExample, baseId: string, index: number, fallbackTitle: string) {
  const meta = example.meta;
  const createdAt = new Date().toISOString();
  // Lossless resume: prefer the original full-fidelity messages when the
  // export carried them in the `keating` envelope.
  const messages = Array.isArray(meta?.rawMessages) ? meta!.rawMessages : example.messages;
  const session: Record<string, unknown> = {
    id: meta?.sessionId ? `${meta.sessionId}-import-${index}` : `${baseId}-${index}`,
    title: meta?.title?.trim() || fallbackTitle,
    createdAt,
    lastModified: createdAt,
    source: meta?.source ?? "keating-finetune-import",
    messages,
  };
  if (meta?.model) session.model = meta.model;
  if (meta?.thinkingLevel) session.thinkingLevel = meta.thinkingLevel;
  return session;
}

export async function importFineTuneDataset(
  cwd: string,
  inputOptions: KeatingImportOptions,
): Promise<KeatingImportResult> {
  await ensureKeatingDirs(cwd);
  const format = inputOptions.format ?? "auto";
  const files = await importFiles(inputOptions.sourcePath, format);
  const importedExamples: ImportedExample[] = [];
  const seenExamples = new Set<string>();
  const warnings: string[] = [];
  let examplesImported = 0;
  let skipped = 0;

  for (const file of files) {
    const text = await readFile(file.path, "utf8");
    const parsedJsonl = parseJsonl(text, basename(file.path));
    skipped += parsedJsonl.skipped;
    warnings.push(...parsedJsonl.warnings);
    const parsed = file.format === "alpaca" ? parseAlpaca(parsedJsonl.values) : parseChatMl(parsedJsonl.values);
    examplesImported += addUniqueExamples(importedExamples, seenExamples, parsed.imported);
    skipped += parsed.skipped;
    warnings.push(...parsed.warnings);
  }

  if (examplesImported === 0 || importedExamples.length === 0) {
    throw new Error("No importable fine-tune examples found.");
  }

  await mkdir(sessionsDir(cwd), { recursive: true });
  const baseId = `imported-finetune-${timestampSlug()}`;
  const baseTitle = inputOptions.title?.trim();
  // One resumable session per imported example — never flatten independent
  // examples into a single fake conversation.
  const sessionPaths: string[] = [];
  for (let index = 0; index < importedExamples.length; index += 1) {
    const fallbackTitle =
      baseTitle && importedExamples.length > 1
        ? `${baseTitle} (${index + 1}/${importedExamples.length})`
        : baseTitle || `Imported fine-tune session ${index + 1}`;
    const session = sessionFromExample(importedExamples[index], baseId, index, fallbackTitle);
    const sessionPath = join(sessionsDir(cwd), `${slugify(String(session.id))}.json`);
    await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    sessionPaths.push(sessionPath);
  }

  return {
    filesRead: files.length,
    examplesImported,
    sessionsImported: sessionPaths.length,
    skipped,
    sessionPaths,
    sessionPath: sessionPaths[0],
    warnings,
  };
}
