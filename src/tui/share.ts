import { messageText } from "./view-model.js";

export interface TuiSharedSessionResult {
  id: string;
  url: string;
  messageCount: number;
}

export interface PublishTuiSessionOptions {
  origin?: string;
  model?: string;
  thinking?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Match the web share renderer's text-only, user/assistant public contract. */
export function sanitizeTuiMessagesForShare(messages: readonly unknown[]): Array<Record<string, unknown>> {
  return messages.flatMap((message) => {
    const candidate = asRecord(message);
    if (candidate.role !== "user" && candidate.role !== "assistant") return [];
    const text = messageText(candidate).trim();
    if (!text) return [];
    return [{
      role: candidate.role,
      content: [{ type: "text", text }],
      ...(typeof candidate.timestamp === "number" ? { timestamp: candidate.timestamp } : {}),
    }];
  });
}

function modelInfo(model: string | undefined): Record<string, string> | undefined {
  if (!model || model === "model unavailable") return undefined;
  const separator = model.indexOf("/");
  if (separator < 1 || separator === model.length - 1) return undefined;
  return { provider: model.slice(0, separator), id: model.slice(separator + 1) };
}

export async function publishTuiSession(
  messages: readonly unknown[],
  options: PublishTuiSessionOptions = {},
): Promise<TuiSharedSessionResult> {
  const sharedMessages = sanitizeTuiMessagesForShare(messages);
  if (sharedMessages.length === 0) throw new Error("There is no user or assistant text to share yet.");
  const firstUser = sharedMessages.find((message) => message.role === "user");
  const title = firstUser ? messageText(firstUser).replace(/\s+/g, " ").slice(0, 80) : "Keating session";
  const now = (options.now ?? (() => new Date()))();
  const origin = new URL(options.origin ?? process.env.KEATING_SHARE_ORIGIN ?? "https://keating.help").origin;
  const payload = {
    schemaVersion: 2,
    title,
    createdAt: now.toISOString(),
    sharedAt: now.toISOString(),
    messageCount: sharedMessages.length,
    ...(modelInfo(options.model) ? { model: modelInfo(options.model) } : {}),
    ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
    messages: sharedMessages,
  };
  const response = await (options.fetch ?? globalThis.fetch)(new URL("/api/share", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 240);
    throw new Error(`Share server returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const result = asRecord(await response.json());
  if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]{8,32}$/.test(result.id)) {
    throw new Error("Share server did not return a valid session id.");
  }
  return {
    id: result.id,
    url: new URL(`/s/${encodeURIComponent(result.id)}`, origin).toString(),
    messageCount: sharedMessages.length,
  };
}
