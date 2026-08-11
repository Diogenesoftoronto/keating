import { toolResultCardLines } from "../core/cards.js";
import {
  createTuiPresentationProfile,
  terminalLayoutProfile,
  type TuiPresentationProfile,
} from "./terminal-profile.js";

export type TranscriptEntryKind = "user" | "assistant" | "tool" | "artifact" | "notice" | "error";

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
  id: "sessions" | "library" | "review" | "settings" | "model" | "thinking" | "new-session" | "abort" | "retry" | "shell";
  label: string;
  shortcut?: string;
  description: string;
}

export const TUI_COMMANDS: readonly TuiCommand[] = [
  { id: "sessions", label: "Sessions", shortcut: "Ctrl+S", description: "Resume, rename, or fork a saved learning session" },
  { id: "library", label: "Library", shortcut: "Ctrl+L", description: "Preview, export, or recoverably remove a saved artifact" },
  { id: "review", label: "Review", description: "Review due cards and inspect estimated topic urgency" },
  { id: "settings", label: "Settings", description: "Inspect capabilities and change real Pi runtime behavior" },
  { id: "model", label: "Change model", shortcut: "Ctrl+M", description: "Cycle to the next configured model" },
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
      if (message.isError) {
        return [{
          id: stableId("tool-error", message, index),
          kind: "error",
          title: `${toolName} failed`,
          body: sanitizeDiagnostic(body || message.details || "The tool did not return a diagnostic."),
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
  return `${entryMark(entry.kind, profile)} ${entry.title}\n${entry.body}${entry.detail ? `\n  ${entry.detail}` : ""}`;
}

export function transcriptText(
  entries: readonly TranscriptEntry[],
  streaming?: TranscriptEntry | null,
  profile = createTuiPresentationProfile(),
): string {
  const all = streaming ? [...entries, streaming] : entries;
  if (all.length === 0) {
    return "Ask a question, continue a learning goal, or press Ctrl+P to explore commands.";
  }
  return all.map((entry) => transcriptEntryText(entry, profile)).join("\n\n");
}

/** Markdown fed to OpenTUI's real MarkdownRenderable, not raw terminal text. */
export function transcriptMarkdown(
  entries: readonly TranscriptEntry[],
  streaming?: TranscriptEntry | null,
  profile = createTuiPresentationProfile(),
): string {
  const all = streaming ? [...entries, streaming] : entries;
  if (all.length === 0) {
    return "Ask a question, continue a learning goal, or press **Ctrl+P** to explore commands.";
  }
  return all.map((entry) => {
    const title = entry.title.replace(/[\r\n#]+/g, " ").trim();
    const detail = entry.detail ? `\n\n> ${entry.detail.replace(/\n/g, "\n> ")}` : "";
    return `## ${entryMark(entry.kind, profile)} ${title}\n\n${prepareTerminalMarkdown(entry.body)}${detail}`;
  }).join("\n\n---\n\n");
}

export function headerText(
  state: TuiHeaderState,
  profile = createTuiPresentationProfile(),
): string {
  const semantic = state.busy ? profile.design.states.active : profile.design.states.ready;
  return [
    "KEATING",
    `${semantic.glyph} ${state.busy ? "THINKING" : semantic.label.toUpperCase()}`,
    state.model,
    `thinking ${state.thinking}`,
    state.session,
  ].join("  ·  ");
}

export function activityText(
  entries: readonly TranscriptEntry[],
  state: TuiHeaderState,
  profile = createTuiPresentationProfile(),
): string {
  const recent = entries.filter((entry) => entry.kind !== "user" && entry.kind !== "assistant").slice(-7);
  const lines = [
    "SESSION",
    state.session,
    "",
    "ACTIVITY",
    ...(recent.length
      ? recent.flatMap((entry) => [`${entryMark(entry.kind, profile)} ${entry.title}`, `  ${entry.body.split("\n")[0]?.slice(0, 24) ?? ""}`])
      : [`${profile.marks.notice} No tool activity yet`]),
  ];
  return lines.join("\n");
}

export function showActivityRail(terminalWidth: number): boolean {
  return terminalLayoutProfile(terminalWidth, 30).showActivityRail;
}

export function commandOption(command: TuiCommand): string {
  return `${command.label}${command.shortcut ? `  ·  ${command.shortcut}` : ""}  —  ${command.description}`;
}
