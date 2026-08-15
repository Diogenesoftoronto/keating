import { toolResultCardLines } from "../core/cards.js";
import {
  createTuiPresentationProfile,
  terminalLayoutProfile,
  type TuiPresentationProfile,
} from "./terminal-profile.js";
import {
  hasMeaningfulToolResult,
  MISSING_TOOL_RESULT_MESSAGE,
} from "./tool-result.js";

export type TranscriptEntryKind = "user" | "assistant" | "tool" | "artifact" | "notice" | "error";

/** Heading levels are styled as semantic response colors by the OpenTUI host. */
const TRANSCRIPT_HEADING_LEVEL: Readonly<Record<TranscriptEntryKind, number>> = {
  assistant: 1,
  user: 2,
  tool: 3,
  artifact: 4,
  notice: 5,
  error: 6,
};

export interface TranscriptEntry {
  id: string;
  kind: TranscriptEntryKind;
  title: string;
  body: string;
  detail?: string;
}

export interface TuiHeaderState {
  model: string;
  thinking: string;
  session: string;
  busy: boolean;
}

export const EMPTY_HEADER_STATE: TuiHeaderState = {
  model: "model unavailable",
  thinking: "off",
  session: "new session",
  busy: false,
};

export interface TuiCommand {
  id: "setup" | "sessions" | "library" | "review" | "courses" | "share" | "settings" | "model" | "thinking" | "new-session" | "abort" | "retry" | "shell";
  label: string;
  shortcut?: string;
  description: string;
}

export const TUI_COMMANDS: readonly TuiCommand[] = [
  { id: "setup", label: "Setup Keating", description: "Configure providers, model, thinking, and runtime defaults" },
  { id: "sessions", label: "Sessions", shortcut: "Ctrl+S", description: "Resume, rename, or fork a saved learning session" },
  { id: "library", label: "Library", shortcut: "Ctrl+L", description: "Preview, export, or recoverably remove a saved artifact" },
  { id: "review", label: "Review", description: "Review due cards and inspect estimated topic urgency" },
  { id: "courses", label: "Courses", shortcut: "Ctrl+O", description: "Browse local or hosted courses and continue a lesson" },
  { id: "share", label: "Share session", description: "Publish a read-only web rendering of this session" },
  { id: "settings", label: "Settings", description: "Inspect capabilities and change real Pi runtime behavior" },
  { id: "model", label: "Select model", shortcut: ":m", description: "Search and select an authenticated Pi model" },
  { id: "thinking", label: "Change thinking", shortcut: "Ctrl+T", description: "Cycle the reasoning level" },
  { id: "new-session", label: "New session", shortcut: "Ctrl+N", description: "Start a fresh learning session" },
  { id: "abort", label: "Stop response", shortcut: "Ctrl+X", description: "Abort the active response" },
  { id: "retry", label: "Retry last prompt", shortcut: "Ctrl+R", description: "Resend the exact draft preserved after a failed send" },
  { id: "shell", label: "Classic Pi shell", description: "Switch to the classic Pi interface" },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function messageText(message: unknown): string {
  const content = asRecord(message).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const candidate = asRecord(part);
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function stableId(prefix: string, message: Record<string, unknown>, index: number): string {
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : index;
  const toolCall = typeof message.toolCallId === "string" ? `-${message.toolCallId}` : "";
  return `${prefix}-${timestamp}-${index}${toolCall}`;
}

export function sanitizeDiagnostic(value: unknown, maxLength = 700): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (value instanceof Error) text = value.message;
  else {
    try { text = JSON.stringify(value); }
    catch { text = String(value); }
  }

  const clean = text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/gi, "$1-[redacted]")
    .replace(/(["']?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)["']?\s*:\s*)["']?([^"',\s}]+)/g, "$1\"[redacted]\"")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*[=:]\s*([^\s,;]+)/g, "$1=[redacted]")
    .trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

export function transcriptEntriesFromMessages(messages: readonly unknown[]): TranscriptEntry[] {
  return messages.flatMap((raw, index): TranscriptEntry[] => {
    const message = asRecord(raw);
    const role = message.role;
    const body = messageText(message).trim();
    if (role === "user" && body) {
      return [{ id: stableId("user", message, index), kind: "user", title: "You", body }];
    }
    if (role === "assistant") {
      const entries: TranscriptEntry[] = [];
      if (body) entries.push({ id: stableId("assistant", message, index), kind: "assistant", title: "Keating", body });
      if ((message.stopReason === "error" || message.stopReason === "aborted") && typeof message.errorMessage === "string") {
        entries.push({
          id: stableId("assistant-error", message, index),
          kind: "error",
          title: message.stopReason === "aborted" ? "Response stopped" : "Response failed",
          body: sanitizeDiagnostic(message.errorMessage),
        });
      }
      return entries;
    }
    if (role === "toolResult") {
      const toolName = typeof message.toolName === "string" ? message.toolName : "tool";
      const missingResult =
        !hasMeaningfulToolResult(message.content) &&
        !hasMeaningfulToolResult(message.details);
      if (message.isError || missingResult) {
        return [{
          id: stableId("tool-error", message, index),
          kind: "error",
          title: `${toolName} failed`,
          body: sanitizeDiagnostic(
            missingResult
              ? MISSING_TOOL_RESULT_MESSAGE
              : body || message.details || "The tool did not return a diagnostic.",
          ),
        }];
      }
      const card = toolResultCardLines(toolName, { content: message.content, details: message.details });
      return [{
        id: stableId("tool-result", message, index),
        kind: card ? "artifact" : "tool",
        title: card ? `${toolName} result` : toolName,
        body: card?.join("\n") || body || "Completed",
      }];
    }
    return [];
  });
}

function entryMark(kind: TranscriptEntryKind, profile: TuiPresentationProfile): string {
  return profile.marks[kind];
}

/** Caret appended to the in-progress assistant entry so streaming reads as live. */
export const STREAM_CARET = "▌";

export function streamCaret(profile: TuiPresentationProfile): string {
  return profile.design.glyphMode === "ascii" ? "_" : STREAM_CARET;
}

/** Entries whose whole payload fits one line collapse to a single labelled row. */
const INLINE_BODY_LIMIT = 72;

function isInlineBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length > 0 && !trimmed.includes("\n") && trimmed.length <= INLINE_BODY_LIMIT;
}

function blockquote(text: string): string {
  return text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
}

/** Pad `left` so `right` ends at `width`; falls back to a separator when tight. */
export function justifyLine(left: string, right: string, width: number): string {
  if (!right) return left;
  if (!left) return right;
  const gap = Math.floor(width) - [...left].length - [...right].length;
  return gap >= 2 ? `${left}${" ".repeat(gap)}${right}` : `${left}  ·  ${right}`;
}

function explicitMarkdownTargets(source: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const pattern = /(!?)\[([^\]\n]*)\]\(((?:https?|mailto|file|artifact):[^)\s]+)\)/g;
  for (const match of source.matchAll(pattern)) {
    const kind = match[1] === "!" ? "Image" : "Link";
    const label = (match[2] || "target").replace(/[\r\n]+/g, " ").trim();
    const target = (match[3] ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
    const line = `${kind} target — ${label}: ${target}`;
    if (target && !seen.has(line)) {
      seen.add(line);
      targets.push(line);
    }
  }
  return targets;
}

/**
 * Preserve the complete source while giving terminal-only extensions truthful,
 * readable semantics. OpenTUI handles GFM; this layer labels spoilers, exposes
 * TeX as readable source, and adds graphical/link handoffs.
 */
export function prepareTerminalMarkdown(source: string): string {
  const targets = explicitMarkdownTargets(source);
  const lines = source.split("\n");
  const rendered: string[] = [];
  let fenceLanguage: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = /^\s*```\s*([^\s`]*)/.exec(line);
    if (fence) {
      if (fenceLanguage === null) {
        fenceLanguage = (fence[1] || "text").toLowerCase();
        rendered.push(line);
      } else {
        const completedLanguage = fenceLanguage;
        fenceLanguage = null;
        rendered.push(line);
        if (completedLanguage === "mermaid") {
          rendered.push("", "> Mermaid source is preserved above. Open the same session on web or desktop for the graphical diagram.");
        }
      }
      continue;
    }
    if (fenceLanguage !== null) {
      rendered.push(line);
      continue;
    }
    if (line.trim() === "$$") {
      const math: string[] = [];
      let closed = false;
      for (index += 1; index < lines.length; index += 1) {
        const candidate = lines[index]!;
        if (candidate.trim() === "$$") {
          closed = true;
          break;
        }
        math.push(candidate);
      }
      rendered.push(
        "> **Display math — readable TeX source**",
        ">",
        ...math.map((part) => `> \`${part.replace(/`/g, "\\`")}\``),
      );
      if (!closed) rendered.push("> Incomplete math block; source preserved for retry.");
      continue;
    }
    rendered.push(line
      .replace(/\|\|([^|\n]+)\|\|/g, "**Spoiler (revealed in terminal):** $1")
      .replace(/(^|[^$])\$([^$\n]+)\$/g, (_match, before: string, math: string) => `${before}Math \`${math}\` (TeX source: \`$${math}$\`)`));
  }
  if (fenceLanguage !== null) {
    rendered.push("", `> Incomplete ${fenceLanguage} code fence; source remains visible while the response streams.`);
  }
  if (targets.length > 0) {
    rendered.push("", "### Explicit targets", ...targets.map((target) => `- ${target}`));
  }
  return rendered.join("\n");
}

export function transcriptEntryText(
  entry: TranscriptEntry,
  profile = createTuiPresentationProfile(),
): string {
  const mark = entryMark(entry.kind, profile);
  const detail = entry.detail ? `\n  ${entry.detail}` : "";
  if (entry.kind === "user") {
    return `${entry.body.split("\n").map((line) => `${mark} ${line}`.trimEnd()).join("\n")}${detail}`;
  }
  if (entry.kind !== "assistant" && isInlineBody(entry.body)) {
    return `${mark} ${entry.title}  ·  ${entry.body.trim()}${detail}`;
  }
  return `${mark} ${entry.title}\n${entry.body}${detail}`;
}

export const TRANSCRIPT_EMPTY_TEXT =
  "Ask a question, continue a learning goal, or press Ctrl+P to explore commands.";

export function transcriptText(
  entries: readonly TranscriptEntry[],
  streaming?: TranscriptEntry | null,
  profile = createTuiPresentationProfile(),
): string {
  const all = streaming ? [...entries, streaming] : entries;
  if (all.length === 0) return TRANSCRIPT_EMPTY_TEXT;
  return all.map((entry) => transcriptEntryText(entry, profile)).join("\n\n");
}

/**
 * Markdown fed to OpenTUI's real MarkdownRenderable. Deliberately flat: the
 * user's own words carry a quote gutter, every other entry gets one bold marker
 * row, and entries are separated by whitespace rather than horizontal rules.
 */
function entryMarkdown(
  entry: TranscriptEntry,
  profile: TuiPresentationProfile,
  caret: string,
  width: number,
): string {
  const mark = entryMark(entry.kind, profile);
  const rawTitle = entry.title.replace(/[\r\n#*_`]+/g, " ").replace(/\s+/g, " ").trim();
  const titleWidth = Math.max(12, Math.floor(width) - [...mark].length - 4);
  const titleGlyphs = [...rawTitle];
  const title = titleGlyphs.length <= titleWidth
    ? rawTitle
    : `${titleGlyphs.slice(0, titleWidth - 1).join("")}…`;
  const heading = `${"#".repeat(TRANSCRIPT_HEADING_LEVEL[entry.kind])} ${mark} ${title}`;
  const detail = entry.detail ? `\n\n${blockquote(entry.detail)}` : "";
  const body = `${prepareTerminalMarkdown(entry.body)}${caret}`;

  if (entry.kind === "user") return `${heading}\n\n${blockquote(entry.body.trim() + caret)}${detail}`;
  if (entry.kind === "error") return `${heading}\n\n${blockquote(entry.body.trim())}${detail}`;
  if (entry.kind !== "assistant" && isInlineBody(entry.body)) {
    return `${heading}\n\n${entry.body.trim()}${detail}`;
  }
  return `${heading}\n\n${body}${detail}`;
}

export function transcriptMarkdown(
  entries: readonly TranscriptEntry[],
  streaming?: TranscriptEntry | null,
  profile = createTuiPresentationProfile(),
  width = 80,
): string {
  const all = streaming ? [...entries, streaming] : entries;
  if (all.length === 0) {
    return "Ask a question, continue a learning goal, or press **Ctrl+P** to explore commands.";
  }
  const caret = streamCaret(profile);
  return all
    .map((entry) => entryMarkdown(entry, profile, entry === streaming ? caret : "", width))
    .join("\n\n");
}

export interface HeaderTextOptions {
  /** Terminal width; when given, the runtime facts are flushed right. */
  width?: number;
  label?: string;
}

export function headerText(
  state: TuiHeaderState,
  profile = createTuiPresentationProfile(),
  options: HeaderTextOptions = {},
): string {
  const semantic = state.busy ? profile.design.states.active : profile.design.states.ready;
  const label = options.label ?? "keating";
  const left = `${profile.marks.assistant} ${label}  ${state.session}`;
  const right = `${state.model}  ·  ${state.thinking}  ·  ${semantic.glyph} ${state.busy ? "working" : semantic.label.toLowerCase()}`;
  return options.width ? justifyLine(left, right, options.width) : `${left}  ·  ${right}`;
}

function truncate(text: string, width: number): string {
  const glyphs = [...text.replace(/\s+/g, " ").trim()];
  return glyphs.length <= width ? glyphs.join("") : `${glyphs.slice(0, Math.max(1, width - 1)).join("")}…`;
}

export function activityText(
  entries: readonly TranscriptEntry[],
  state: TuiHeaderState,
  profile = createTuiPresentationProfile(),
  width = 30,
): string {
  const inner = Math.max(8, Math.floor(width) - 2);
  const recent = entries.filter((entry) => entry.kind !== "user" && entry.kind !== "assistant").slice(-8);
  return [
    "SESSION",
    truncate(state.session, inner),
    "",
    "ACTIVITY",
    ...(recent.length
      ? recent.map((entry) => truncate(`${entryMark(entry.kind, profile)} ${entry.title}`, inner))
      : [`${profile.marks.notice} No tool activity yet`]),
  ].join("\n");
}

export function showActivityRail(terminalWidth: number): boolean {
  return terminalLayoutProfile(terminalWidth, 30).showActivityRail;
}

export function commandOption(command: TuiCommand): string {
  return `${command.label}${command.shortcut ? `  ·  ${command.shortcut}` : ""}  —  ${command.description}`;
}
