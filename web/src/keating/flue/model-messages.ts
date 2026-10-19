import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { stripReviewNotice } from "../judgement/review-notice";

/** Persisted formats from older Keating sessions, independent of any UI kit. */
export interface SavedAttachment {
  type: "image" | "document";
  content: string;
  mimeType: string;
  fileName: string;
  extractedText?: string;
}

export interface SavedAttachmentMessage {
  role: "user-with-attachments";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
  attachments?: SavedAttachment[];
}

export interface SavedArtifactMessage {
  role: "artifact";
  action: "create" | "update" | "delete";
  filename: string;
  content?: string;
  title?: string;
  timestamp: string;
}

declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    "user-with-attachments": SavedAttachmentMessage;
    artifact: SavedArtifactMessage;
  }
}

/** Prepare a provider request without modifying the saved conversation. */
export function toModelMessages(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];
  for (const message of messages) {
    if (message.role === "user-with-attachments") {
      const content: (TextContent | ImageContent)[] = typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : [...message.content];
      for (const attachment of message.attachments ?? []) {
        if (attachment.type === "image") {
          content.push({ type: "image", data: attachment.content, mimeType: attachment.mimeType });
        } else if (attachment.extractedText) {
          content.push({ type: "text", text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}` });
        }
      }
      result.push({ role: "user", content, timestamp: message.timestamp });
    } else if (message.role === "assistant") {
      // Review notices are chat presentation metadata, not tutor speech.
      // Older saved sessions may hold string content despite the declared type.
      const content = message.content as AssistantMessage["content"] | string;
      result.push(typeof content === "string" ? { ...message, content: stripReviewNotice(content) } as unknown as Message
        : { ...message, content: content.map(part => part.type === "text" ? { ...part, text: stripReviewNotice(part.text) } : part) });
    } else if (message.role === "user" || message.role === "toolResult") {
      result.push(message);
    }
    // Artifacts and other UI-only records never become provider messages.
  }
  return result;
}

/** Epoch-ms timestamps before this are fixtures or legacy placeholders, not real send times. */
const PLAUSIBLE_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
/** A shorter pause carries no teaching signal and would only add noise. */
const NOTABLE_GAP_MS = 30 * 60_000;

function epochMs(value: unknown): number | null {
  const ms = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms >= PLAUSIBLE_TIMESTAMP_MS ? ms : null;
}

function describeGap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${Math.round(days / 365.25)} years`;
}

/**
 * The note Keating attaches to a learner message, or null when none is useful.
 * A pure function of the message's own and previous timestamps, so earlier
 * turns render identically on every request and keep provider caches warm.
 */
export function learnerTimeNote(sentAt: number, previousAt: number | null, timeZone?: string): string | null {
  const gap = previousAt === null ? null : sentAt - previousAt;
  if (gap !== null && gap < NOTABLE_GAP_MS) return null;
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(timeZone ? { timeZone } : {}),
  }).format(sentAt);
  const elapsed = gap === null ? "first message in this conversation" : `${describeGap(gap)} after the previous message`;
  return `[Keating time note: sent ${when}; ${elapsed}.]`;
}

/**
 * Provider input for the live tutor: like {@link toModelMessages}, plus a time
 * note on learner turns that open a conversation or follow a notable pause.
 * The saved conversation is never modified.
 */
export function toModelMessagesWithTime(messages: AgentMessage[], timeZone?: string): Message[] {
  let previousAt: number | null = null;
  const notes = new Map<AgentMessage, string>();
  for (const message of messages) {
    const at = epochMs((message as { timestamp?: unknown }).timestamp);
    if (at === null) continue;
    if (message.role === "user" || message.role === "user-with-attachments") {
      const note = learnerTimeNote(at, previousAt, timeZone);
      if (note) notes.set(message, note);
    }
    previousAt = at;
  }
  if (!notes.size) return toModelMessages(messages);
  return toModelMessages(messages.map(message => {
    const note = notes.get(message);
    if (!note || (message.role !== "user" && message.role !== "user-with-attachments")) return message;
    const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
    return { ...message, content: [{ type: "text" as const, text: note }, ...content] } as AgentMessage;
  }));
}
