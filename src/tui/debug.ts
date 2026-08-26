import type { KeatingPiModel } from "../runtime/pty-rpc-client.js";
import { sanitizeDiagnostic } from "./view-model.js";

export interface TuiDebugEvent {
  timestamp: string;
  type: string;
  summary: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function roleCounts(messages: readonly unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    const role = record(message).role;
    const key = typeof role === "string" ? role : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function jsonLength(value: unknown): number {
  try { return JSON.stringify(value).length; }
  catch { return 0; }
}

function eventSummary(event: Record<string, unknown>): string {
  const message = record(event.message);
  const parts = [
    typeof event.toolName === "string" ? `tool=${event.toolName}` : "",
    typeof message.role === "string" ? `role=${message.role}` : "",
    typeof message.stopReason === "string" ? `stop=${message.stopReason}` : "",
    event.isError === true ? "error=true" : "",
    typeof event.method === "string" ? `method=${event.method}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "event received";
}

export function captureTuiDebugEvent(value: unknown, timestamp = new Date().toISOString()): TuiDebugEvent | null {
  const candidate = record(value);
  if (typeof candidate.type !== "string") return null;
  return {
    timestamp,
    type: sanitizeDiagnostic(candidate.type, 80),
    summary: sanitizeDiagnostic(eventSummary(candidate), 240),
  };
}

export function tuiDebugSummary(input: {
  state: unknown;
  messages: readonly unknown[];
  models: readonly KeatingPiModel[];
  commands: readonly { name: string; source?: string }[];
  sessionStats?: unknown;
  events: readonly TuiDebugEvent[];
  processDiagnostics: string;
}): string {
  const state = record(input.state);
  const model = record(state.model);
  const providerCounts = new Map<string, number>();
  for (const available of input.models) {
    providerCounts.set(available.provider, (providerCounts.get(available.provider) ?? 0) + 1);
  }
  const characters = jsonLength(input.messages);
  const roles = roleCounts(input.messages);
  const latest = input.events.at(-1);
  const extensionCommands = input.commands.filter((command) => command.source === "extension").length;
  const modelName = [model.provider, model.id].filter((part) => typeof part === "string" && part).join("/") || "unavailable";

  return [
    "## Terminal debug service",
    "",
    "This is local, read-only inspection of the public Pi RPC session. It does not upload or persist message content.",
    "",
    "### Runtime",
    "",
    `- Model: **${modelName}**`,
    `- Thinking: **${typeof state.thinkingLevel === "string" ? state.thinkingLevel : "off"}**`,
    `- Session: **${sanitizeDiagnostic(state.sessionName ?? state.sessionId ?? state.sessionFile ?? "new session", 240)}**`,
    `- Streaming: **${state.isStreaming === true ? "yes" : "no"}** · compacting: **${state.isCompacting === true ? "yes" : "no"}**`,
    `- Queue: steering **${String(state.steeringMode ?? "unknown")}** · follow-up **${String(state.followUpMode ?? "unknown")}** · pending **${Number(state.pendingMessageCount ?? 0)}**`,
    "",
    "### Context exposed by Pi RPC",
    "",
    `- Messages: **${input.messages.length}** (${Object.entries(roles).map(([role, count]) => `${role}:${count}`).join(" · ") || "none"})`,
    `- Serialized message size: **${characters.toLocaleString()} characters** · approximately **${Math.ceil(characters / 4).toLocaleString()} tokens** before provider tokenization`,
    "- System prompt: **not exposed by this Pi RPC version**. The message inspector is exact for session messages; it does not pretend this missing boundary is visible.",
    `- Session statistics: ${sanitizeDiagnostic(input.sessionStats ?? "unavailable", 1_200)}`,
    "",
    "### Providers and capabilities",
    "",
    `- Available models: **${input.models.length}** across **${providerCounts.size}** providers`,
    `- Largest catalogs: ${[...providerCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([provider, count]) => `${provider}:${count}`).join(" · ") || "none"}`,
    `- Commands: **${input.commands.length}** (${extensionCommands} from extensions)`,
    "",
    "### Last runtime activity",
    "",
    latest
      ? `Last event: **${latest.type}** at ${latest.timestamp} · ${latest.summary}`
      : "No RPC events have been captured in this OpenTUI process yet.",
    `Captured event ring: **${input.events.length}** events`,
    `Pi process diagnostics: **${input.processDiagnostics.trim() ? "available" : "empty"}**`,
    "",
    "Use the debug actions to inspect model-facing messages, recent RPC events, or sanitized process diagnostics. Tool failures also remain visible inline in the transcript.",
  ].join("\n");
}

const CREDENTIAL_FIELD = /^(?:api[-_]?key|authorization|cookie|credential|password|refresh[-_]?token|secret|token)$/i;

export function tuiDebugMessagesMarkdown(messages: readonly unknown[]): string {
  let content: string;
  try {
    content = JSON.stringify(messages, (key, value) => CREDENTIAL_FIELD.test(key) ? "[credential omitted]" : value, 2) ?? "[]";
  } catch (error) {
    content = `Could not serialize session messages: ${sanitizeDiagnostic(error)}`;
  }
  if (content.length > 80_000) content = `${content.slice(0, 80_000)}\n\n[truncated ${content.length - 80_000} characters]`;
  return [
    "## Model-facing session messages",
    "",
    "These are the exact session messages exposed by Pi RPC. Credential-named fields are omitted. The system prompt is not available through this RPC version.",
    "",
    "```json",
    content,
    "```",
  ].join("\n");
}

export function tuiDebugEventsMarkdown(events: readonly TuiDebugEvent[]): string {
  return [
    "## Recent terminal runtime events",
    "",
    ...(events.length > 0
      ? [...events].reverse().map((event) => `- ${event.timestamp} · **${event.type}** · ${event.summary}`)
      : ["No RPC events captured."]),
  ].join("\n");
}

export function tuiProcessDiagnosticsMarkdown(diagnostics: string): string {
  return [
    "## Pi process diagnostics",
    "",
    diagnostics.trim()
      ? `\`\`\`text\n${sanitizeDiagnostic(diagnostics, 16_000)}\n\`\`\``
      : "Pi has not emitted any non-protocol process diagnostics.",
  ].join("\n");
}

export const TUI_DEBUG_ACTIONS = [
  "Show model-facing messages",
  "Show recent runtime events",
  "Show Pi process diagnostics",
  "Clear captured runtime events",
  "Close debug service",
] as const;
