import { toolResultCardLines } from "../core/cards.js";

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
  id: "model" | "thinking" | "new-session" | "abort" | "shell";
  label: string;
  shortcut?: string;
  description: string;
}

export const TUI_COMMANDS: readonly TuiCommand[] = [
  { id: "model", label: "Change model", shortcut: "Ctrl+M", description: "Cycle to the next configured model" },
  { id: "thinking", label: "Change thinking", shortcut: "Ctrl+T", description: "Cycle the reasoning level" },
  { id: "new-session", label: "New session", shortcut: "Ctrl+N", description: "Start a fresh learning session" },
  { id: "abort", label: "Stop response", shortcut: "Ctrl+X", description: "Abort the active response" },
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

const ENTRY_MARK: Record<TranscriptEntryKind, string> = {
  user: ">",
  assistant: "◆",
  tool: "→",
  artifact: "▣",
  notice: "·",
  error: "!",
};

export function transcriptEntryText(entry: TranscriptEntry): string {
  return `${ENTRY_MARK[entry.kind]} ${entry.title}\n${entry.body}${entry.detail ? `\n  ${entry.detail}` : ""}`;
}

export function transcriptText(entries: readonly TranscriptEntry[], streaming?: TranscriptEntry | null): string {
  const all = streaming ? [...entries, streaming] : entries;
  if (all.length === 0) {
    return "Ask a question, continue a learning goal, or press Ctrl+P to explore commands.";
  }
  return all.map(transcriptEntryText).join("\n\n");
}

export function headerText(state: TuiHeaderState): string {
  return [
    "KEATING",
    state.busy ? "THINKING" : "READY",
    state.model,
    `thinking ${state.thinking}`,
    state.session,
  ].join("  ·  ");
}

export function activityText(entries: readonly TranscriptEntry[], state: TuiHeaderState): string {
  const recent = entries.filter((entry) => entry.kind !== "user" && entry.kind !== "assistant").slice(-7);
  const lines = [
    "SESSION",
    state.session,
    "",
    "ACTIVITY",
    ...(recent.length
      ? recent.flatMap((entry) => [`${ENTRY_MARK[entry.kind]} ${entry.title}`, `  ${entry.body.split("\n")[0]?.slice(0, 24) ?? ""}`])
      : ["· No tool activity yet"]),
  ];
  return lines.join("\n");
}

export function showActivityRail(terminalWidth: number): boolean {
  return terminalWidth >= 100;
}

export function commandOption(command: TuiCommand): string {
  return `${command.label}${command.shortcut ? `  ·  ${command.shortcut}` : ""}  —  ${command.description}`;
}
