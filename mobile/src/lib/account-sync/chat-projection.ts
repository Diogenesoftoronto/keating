import { chatSyncCanonical } from "../../../../shared/account-sync/chat-sync-state";
import type { KeatingPortableSession, SessionUsage } from "../../../../shared/account-sync/types";
import type { ChatMessage, ChatSession, ProviderId, ProviderSettings } from "../types";

const providers = new Set<ProviderId>(["openai", "anthropic", "google", "openrouter", "custom", "litert"]);
const zeroUsage = (): SessionUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
type WireMessage = KeatingPortableSession["data"]["messages"][number];
type NativeWireMessage = WireMessage & { keatingNative?: Omit<ChatMessage, "content" | "role" | "createdAt"> };
export type NativeChatIds = ReadonlyMap<string, string>;
const nativeId = (id: string, ids?: NativeChatIds) => ids?.get(id) ?? id;
const wireId = (id: string, ids?: NativeChatIds) => ids ? [...ids].find(([wire, native]) => !wire.startsWith("\0") && native === id)?.[0] ?? id : id;
const messageId = (id: string, index: number, ids?: NativeChatIds) => `sync-${ids?.get(`\0message:${id}`) ?? nativeId(id, ids)}-${index}`;

export async function nativeChatIdMap(ids: string[], sha256: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const id of new Set(ids)) {
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id)) {
      result.set(id, id);
      if (id.length > 100) {
        const digest = await sha256(new TextEncoder().encode(`keating-native-message-id-v1:${id}`));
        result.set(`\0message:${id}`, Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join(""));
      }
    }
    else {
      const digest = await sha256(new TextEncoder().encode(`keating-native-chat-id-v1:${id}`));
      result.set(id, `sync-${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`);
    }
  }
  if (new Set(result.values()).size !== result.size) throw new Error("Synced conversations have conflicting native identities.");
  return result;
}

function text(message: WireMessage): string {
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.flatMap(part => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n") : "";
}

/** The original wire transcript remains authoritative; native displays supported roles only. */
export function projectSyncedSession(session: KeatingPortableSession, ids?: NativeChatIds): ChatSession {
  const data = session.data;
  const messages: ChatMessage[] = [];
  data.messages.forEach((raw, index) => {
    if (raw.role !== "user" && raw.role !== "assistant") return;
    const message = raw as NativeWireMessage;
    const extra = message.keatingNative;
    const provider = "provider" in message && providers.has(message.provider as ProviderId) ? message.provider as ProviderId : undefined;
    messages.push({
      ...(extra ?? {}), id: extra?.id ?? messageId(data.id, index, ids),
      role: raw.role, content: text(message), createdAt: typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : Date.parse(data.createdAt) + index,
      ...(provider ? { provider } : {}),
      ...("model" in message && typeof message.model === "string" ? { model: message.model } : {}),
      ...(extra?.attachments ? { attachments: extra.attachments.map(({ uri: _uri, data: _data, ...attachment }) => ({ ...attachment, localState: "missing" as const })) } : {}),
    });
  });
  return {
    id: nativeId(data.id, ids), title: data.title, createdAt: Date.parse(data.createdAt), updatedAt: Date.parse(data.lastModified), messages,
    ...(data.parentSessionId ? { parentSessionId: nativeId(data.parentSessionId, ids) } : {}),
    ...(data.forkedAt ? { forkedAt: Date.parse(data.forkedAt) } : {}),
    ...(data.forkedFromMessageTimestamp !== undefined ? { forkedFromMessageId: messages.find(message => message.createdAt === data.forkedFromMessageTimestamp)?.id } : {}),
  };
}

function portableNative(message: ChatMessage): Omit<ChatMessage, "content" | "role" | "createdAt"> {
  const { content: _content, role: _role, createdAt: _createdAt, ...extra } = message;
  return {
    ...extra,
    ...(extra.attachments ? { attachments: extra.attachments.map(({ uri: _uri, data: _data, localState: _state, ...attachment }) => attachment) } : {}),
  };
}

function wireMessage(message: ChatMessage, settings: ProviderSettings): WireMessage {
  const base = { role: message.role, content: [{ type: "text", text: message.content }], timestamp: message.createdAt, keatingNative: portableNative(message) };
  if (message.role === "user") return base as unknown as WireMessage;
  const usage = message.usage;
  return { ...base, api: "openai-completions", provider: message.provider ?? settings.provider, model: message.model ?? settings.model,
    stopReason: "stop", usage: { ...zeroUsage(), input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0, cost: { ...zeroUsage().cost, total: usage?.costUsd ?? 0 } } } as unknown as WireMessage;
}

function comparable(message: ChatMessage): unknown {
  return { ...message, ...portableNative(message), attachments: portableNative(message).attachments };
}

/** Preserve tool calls, reasoning, provider metadata and message identity when native appends. */
export function nativeSessionToSync(session: ChatSession, settings: ProviderSettings, previous?: KeatingPortableSession, ids?: NativeChatIds): KeatingPortableSession {
  const projection = previous ? projectSyncedSession(previous, ids) : undefined;
  const comparableSession = (value: ChatSession) => ({ ...value, messages: value.messages.map(comparable) });
  if (projection && chatSyncCanonical(comparableSession(session)) === chatSyncCanonical(comparableSession(projection))) return previous!;
  const original = previous?.data.messages ?? [];
  const projectedById = new Map(projection?.messages.map(message => [message.id, message]));
  const originalById = new Map<string, WireMessage>();
  original.forEach((message, index) => {
    if (message.role === "user" || message.role === "assistant") originalById.set((message as NativeWireMessage).keatingNative?.id ?? messageId(previous?.data.id ?? session.id, index, ids), message);
  });
  const retained = new Set(session.messages.map(message => message.id));
  const messages: WireMessage[] = [];
  let cursor = 0;
  for (const message of session.messages) {
    const old = originalById.get(message.id);
    if (old) {
      const position = original.indexOf(old);
      for (; cursor < position; cursor++) {
        const hidden = original[cursor]!;
        if (hidden.role !== "user" && hidden.role !== "assistant") messages.push(hidden);
      }
      cursor = Math.max(cursor, position + 1);
      const projected = projectedById.get(message.id);
      if (projected && chatSyncCanonical(comparable(message)) === chatSyncCanonical(comparable(projected))) messages.push(old);
      else {
        // Feedback/attachment edits must not erase provider tool calls or reasoning.
        const updated: NativeWireMessage = { ...old, keatingNative: portableNative(message) };
        if (message.content !== projected?.content) {
          const content = Array.isArray(old.content) ? old.content : [];
          updated.content = [...content.filter(part => part && typeof part === "object" && part.type !== "text"), { type: "text", text: message.content }];
        }
        messages.push(updated);
      }
    } else messages.push(wireMessage(message, settings));
  }
  // Keep trailing tool events only when no visible turn was truncated (retry/fork).
  if (projection?.messages.every(message => retained.has(message.id))) {
    for (; cursor < original.length; cursor++) if (original[cursor]!.role !== "user" && original[cursor]!.role !== "assistant") messages.push(original[cursor]!);
  }
  const createdAt = new Date(session.createdAt).toISOString();
  const lastModified = new Date(session.updatedAt).toISOString();
  const preview = session.messages.map(message => message.content).join("\n").slice(0, 8192);
  const model = previous?.data.model ?? { id: settings.model, name: settings.model, provider: settings.provider,
    api: "openai-completions", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 0, maxTokens: 0 } as KeatingPortableSession["data"]["model"];
  const common = { id: previous?.data.id ?? wireId(session.id, ids), title: session.title, createdAt, lastModified,
    ...(session.parentSessionId ? { parentSessionId: wireId(session.parentSessionId, ids) } : {}),
    ...(session.forkedAt ? { forkedAt: new Date(session.forkedAt).toISOString() } : {}),
    ...(session.forkedFromMessageId ? { forkedFromMessageTimestamp: session.messages.find(message => message.id === session.forkedFromMessageId)?.createdAt } : {}) };
  return {
    data: { ...previous?.data, ...common, model, thinkingLevel: previous?.data.thinkingLevel ?? "off", messages },
    metadata: { ...previous?.metadata, ...common, messageCount: messages.length, thinkingLevel: previous?.metadata.thinkingLevel ?? "off", usage: previous?.metadata.usage ?? zeroUsage(), preview },
  };
}
