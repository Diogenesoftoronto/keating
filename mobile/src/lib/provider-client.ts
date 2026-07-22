import { KEATING_MOBILE_SYSTEM_PROMPT } from "./system-prompt";
import type { ChatMessage, ProviderSettings } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderRequest {
  url: string;
  init: RequestInit;
}

export interface ProviderRequestOptions {
  signal?: AbortSignal;
  /** Ask the provider for a Server-Sent Events token stream. */
  stream?: boolean;
  /** Composed persona + teaching protocol. Defaults to the built-in prompt. */
  systemPrompt?: string;
}

const MAX_HISTORY_MESSAGES = 40;

function withoutTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function openAiChatUrl(baseUrl: string): string {
  const base = withoutTrailingSlash(baseUrl);
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function recentMessages(messages: ChatMessage[]) {
  const window = messages
    .filter((message) => message.content.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES);

  // Anthropic requires the first conversation message to be a user turn, and
  // Gemini has the same practical alternation expectation for contents. When a
  // long transcript ending in the newest user prompt is sliced to an even-sized
  // window, the first retained turn can be the prior assistant response. Drop
  // any leading assistant-only context so every provider receives a valid
  // user-started transcript.
  while (window[0]?.role === "assistant") window.shift();
  return window;
}

export function buildProviderRequest(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  options: ProviderRequestOptions = {},
): ProviderRequest {
  const { signal, stream = false, systemPrompt = KEATING_MOBILE_SYSTEM_PROMPT } = options;
  const history = recentMessages(messages);
  const commonHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (stream) commonHeaders.Accept = "text/event-stream";

  if (settings.provider === "anthropic") {
    if (apiKey) commonHeaders["x-api-key"] = apiKey;
    commonHeaders["anthropic-version"] = "2023-06-01";
    return {
      url: `${withoutTrailingSlash(settings.baseUrl)}/messages`,
      init: {
        method: "POST",
        headers: commonHeaders,
        signal,
        body: JSON.stringify({
          model: settings.model,
          system: systemPrompt,
          max_tokens: 4096,
          temperature: settings.temperature,
          ...(stream ? { stream: true } : {}),
          messages: history.map((message) => ({ role: message.role, content: message.content })),
        }),
      },
    };
  }

  if (settings.provider === "google") {
    const encodedModel = encodeURIComponent(settings.model);
    const method = stream ? "streamGenerateContent" : "generateContent";
    const params = new URLSearchParams();
    if (stream) params.set("alt", "sse");
    if (apiKey) params.set("key", apiKey);
    const query = params.toString();
    return {
      url: `${withoutTrailingSlash(settings.baseUrl)}/models/${encodedModel}:${method}${query ? `?${query}` : ""}`,
      init: {
        method: "POST",
        headers: commonHeaders,
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: history.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: { temperature: settings.temperature, maxOutputTokens: 4096 },
        }),
      },
    };
  }

  if (apiKey) commonHeaders.Authorization = `Bearer ${apiKey}`;
  if (settings.provider === "openrouter") {
    commonHeaders["HTTP-Referer"] = "https://keating.help";
    commonHeaders["X-Title"] = "Keating Mobile";
  }

  return {
    url: openAiChatUrl(settings.baseUrl),
    init: {
      method: "POST",
      headers: commonHeaders,
      signal,
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        ...(stream ? { stream: true } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((message) => ({ role: message.role, content: message.content })),
        ],
      }),
    },
  };
}

function providerErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== "object" || payload === null) return fallback;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  const message = record.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function extractProviderText(settings: ProviderSettings, payload: unknown): string {
  const record = payload as Record<string, any>;
  if (settings.provider === "anthropic") {
    const text = Array.isArray(record.content)
      ? record.content.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n")
      : "";
    if (text.trim()) return text.trim();
  } else if (settings.provider === "google") {
    const text = record.candidates?.[0]?.content?.parts
      ?.map((part: any) => typeof part?.text === "string" ? part.text : "")
      .join("\n");
    if (typeof text === "string" && text.trim()) return text.trim();
  } else {
    const content = record.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content.map((part: any) => part?.text ?? "").join("\n");
      if (text.trim()) return text.trim();
    }
  }
  throw new Error("The provider returned a response without readable text.");
}

const EVENT_SEPARATOR = /\r?\n\r?\n/;

/**
 * Splits an incoming SSE text stream into `data:` payload strings, carrying any
 * partial trailing event across chunk boundaries.
 */
export function createSseParser(): (chunk: string) => string[] {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const events: string[] = [];
    for (let match = EVENT_SEPARATOR.exec(buffer); match; match = EVENT_SEPARATOR.exec(buffer)) {
      const rawEvent = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data) events.push(data);
    }
    return events;
  };
}

function textFromParts(parts: unknown): string {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("");
}

/**
 * Pulls the incremental text out of one SSE event for the given provider.
 * Returns an empty string for keep-alives and non-text events.
 */
export function extractStreamDelta(settings: ProviderSettings, data: string): string {
  if (!data || data === "[DONE]") return "";
  let payload: any;
  try {
    payload = JSON.parse(data);
  } catch {
    return "";
  }

  if (payload?.error) {
    throw new Error(providerErrorMessage(payload, "The provider reported a streaming error."));
  }

  if (settings.provider === "anthropic") {
    if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") {
      return typeof payload.delta.text === "string" ? payload.delta.text : "";
    }
    return "";
  }

  if (settings.provider === "google") {
    return textFromParts(payload?.candidates?.[0]?.content?.parts);
  }

  const delta = payload?.choices?.[0]?.delta;
  if (typeof delta?.content === "string") return delta.content;
  return textFromParts(delta?.content);
}

async function throwProviderError(response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  throw new Error(providerErrorMessage(payload, `Provider request failed with HTTP ${response.status}.`));
}

export interface StreamCompletionOptions extends ProviderRequestOptions {
  /** Called with each incremental text chunk as it arrives. */
  onDelta?: (delta: string, accumulated: string) => void;
  fetchImpl?: FetchLike;
}

/**
 * Streams a completion, invoking `onDelta` per chunk and resolving with the
 * full text. Falls back to a single non-streamed read when the provider
 * responds without a readable body.
 */
export async function streamCompletion(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  options: StreamCompletionOptions = {},
): Promise<string> {
  const { onDelta, fetchImpl = fetch, ...requestOptions } = options;
  const request = buildProviderRequest(settings, apiKey, messages, { ...requestOptions, stream: true });
  const response = await fetchImpl(request.url, request.init);

  if (!response.ok) await throwProviderError(response);

  const body = response.body;
  if (!body) {
    // No readable stream on this platform — take the whole payload at once.
    return wholePayloadFallback(settings, await response.text(), onDelta);
  }

  const decoder = new TextDecoder();
  const parse = createSseParser();
  const reader = body.getReader();
  let accumulated = "";
  let raw = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      for (const data of parse(chunk)) {
        const delta = extractStreamDelta(settings, data);
        if (!delta) continue;
        accumulated += delta;
        onDelta?.(delta, accumulated);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const trimmed = accumulated.trim();
  if (trimmed) return trimmed;

  // Some OpenAI-compatible servers (local runtimes especially) ignore
  // `stream: true` and answer with one plain JSON body instead of SSE.
  return wholePayloadFallback(settings, raw, onDelta);
}

function wholePayloadFallback(
  settings: ProviderSettings,
  text: string,
  onDelta?: (delta: string, accumulated: string) => void,
): string {
  let payload: unknown;
  try {
    payload = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error("The provider returned a response without readable text.");
  }
  const content = extractProviderText(settings, payload);
  onDelta?.(content, content);
  return content;
}

export async function requestCompletion(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
  systemPrompt?: string,
): Promise<string> {
  const request = buildProviderRequest(settings, apiKey, messages, { signal, systemPrompt });
  const response = await fetchImpl(request.url, request.init);
  const responseText = await response.text();
  let payload: unknown = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}.`);
    throw new Error("The provider returned an invalid JSON response.");
  }

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload, `Provider request failed with HTTP ${response.status}.`));
  }
  return extractProviderText(settings, payload);
}
