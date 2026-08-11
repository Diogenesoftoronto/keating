import {
  anthropicMaxTokens,
  anthropicThinkingBudget,
  googleThinkingBudget,
  openAiReasoningEffort,
  openRouterReasoningEffort,
} from "./reasoning";
import { KEATING_MOBILE_SYSTEM_PROMPT } from "./system-prompt";
import type { ChatAttachment, ChatMessage, ProviderSettings, ProviderUsage } from "./types";
import type { AgentStreamEvent, ToolResult } from "@keating/learner-contracts";
import type { ReasoningLevel } from "./ui-settings";

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
  /**
   * Thinking budget to request. Only sent when the caller has confirmed the
   * selected model supports reasoning — providers reject the field otherwise.
   */
  reasoningLevel?: ReasoningLevel;
  /** Whether the exact selected model advertises temperature support. */
  supportsTemperature?: boolean;
  /** Trusted functions that this native client can actually execute. */
  tools?: ProviderToolDefinition[];
  /** Provider-native assistant call plus the local results being continued. */
  continuation?: ProviderToolContinuation;
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderToolResult {
  callId: string;
  nativeCallId?: string;
  name: string;
  output: Record<string, unknown>;
  isError?: boolean;
}

export type ProviderToolContinuation =
  | { provider: "openai"; previousResponseId: string; results: ProviderToolResult[] }
  | { provider: "anthropic"; exchanges: Array<{ assistantContent: Array<Record<string, unknown>>; results: ProviderToolResult[] }> }
  | { provider: "google"; exchanges: Array<{ modelContent: Record<string, unknown>; results: ProviderToolResult[] }> }
  | { provider: "openrouter" | "custom"; exchanges: Array<{ assistantMessage: Record<string, unknown>; results: ProviderToolResult[] }> };

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

function openAiResponsesUrl(baseUrl: string): string {
  const base = withoutTrailingSlash(baseUrl);
  if (base.endsWith("/responses")) return base;
  if (base.endsWith("/v1")) return `${base}/responses`;
  return `${base}/v1/responses`;
}

function recentMessages(messages: ChatMessage[]) {
  const window = messages
    .filter((message) => message.content.trim().length > 0 || Boolean(message.attachments?.length))
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

function attachmentData(attachment: ChatAttachment): string {
  if (!attachment.data || !attachment.encoding) {
    throw new Error(`${attachment.name} was not prepared for the provider request.`);
  }
  return attachment.data;
}

function textAttachmentBlock(attachment: ChatAttachment): string {
  return `<attachment name=${JSON.stringify(attachment.name)} type=${JSON.stringify(attachment.mimeType)}>\n${attachmentData(attachment)}\n</attachment>`;
}

function responsesMessageContent(message: ChatMessage): string | Array<Record<string, unknown>> {
  if (!message.attachments?.length) return message.content;
  const content: Array<Record<string, unknown>> = [];
  if (message.content.trim()) content.push({ type: "input_text", text: message.content });
  for (const attachment of message.attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "input_image",
        image_url: `data:${attachment.mimeType};base64,${attachmentData(attachment)}`,
        detail: "auto",
      });
    } else if (attachment.mimeType === "application/pdf") {
      content.push({
        type: "input_file",
        filename: attachment.name,
        file_data: `data:${attachment.mimeType};base64,${attachmentData(attachment)}`,
      });
    } else {
      content.push({ type: "input_text", text: textAttachmentBlock(attachment) });
    }
  }
  return content;
}

function anthropicMessageContent(message: ChatMessage): string | Array<Record<string, unknown>> {
  if (!message.attachments?.length) return message.content;
  const content: Array<Record<string, unknown>> = [];
  for (const attachment of message.attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "image",
        source: { type: "base64", media_type: attachment.mimeType, data: attachmentData(attachment) },
      });
    } else if (attachment.mimeType === "application/pdf") {
      content.push({
        type: "document",
        title: attachment.name,
        source: { type: "base64", media_type: "application/pdf", data: attachmentData(attachment) },
      });
    } else {
      content.push({ type: "text", text: textAttachmentBlock(attachment) });
    }
  }
  if (message.content.trim()) content.push({ type: "text", text: message.content });
  return content;
}

function geminiMessageParts(message: ChatMessage): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (message.content.trim()) parts.push({ text: message.content });
  for (const attachment of message.attachments ?? []) {
    if (attachment.encoding === "text") {
      parts.push({ text: textAttachmentBlock(attachment) });
    } else {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachmentData(attachment) } });
    }
  }
  return parts;
}

function chatMessageContent(message: ChatMessage, supportsFileParts: boolean): string | Array<Record<string, unknown>> {
  if (!message.attachments?.length) return message.content;
  const content: Array<Record<string, unknown>> = [];
  if (message.content.trim()) content.push({ type: "text", text: message.content });
  for (const attachment of message.attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "image_url",
        image_url: { url: `data:${attachment.mimeType};base64,${attachmentData(attachment)}` },
      });
    } else if (attachment.mimeType === "application/pdf") {
      if (!supportsFileParts) {
        throw new Error("PDF attachments are not portable to a custom OpenAI-compatible provider. Choose OpenAI, Anthropic, Google, or OpenRouter, or attach extracted text instead.");
      }
      content.push({
        type: "file",
        file: { filename: attachment.name, file_data: `data:application/pdf;base64,${attachmentData(attachment)}` },
      });
    } else {
      content.push({ type: "text", text: textAttachmentBlock(attachment) });
    }
  }
  return content;
}

interface HistoricalToolExchange {
  events: readonly AgentStreamEvent[];
  results: ReadonlyMap<string, ToolResult>;
}

function historicalToolExchange(message: ChatMessage): HistoricalToolExchange | null {
  if (message.role !== "assistant" || !message.agentEvents?.some((event) => event.type === "tool-call")) return null;
  const results = new Map(message.agentEvents
    .filter((event): event is Extract<AgentStreamEvent, { type: "tool-result" }> => event.type === "tool-result")
    .map((event) => [event.result.toolCallId, event.result]));
  const hasCompleteCall = message.agentEvents.some((event) => event.type === "tool-call" && results.has(event.call.id));
  return hasCompleteCall ? { events: message.agentEvents, results } : null;
}

function historicalResultOutput(result: ToolResult): Record<string, unknown> {
  let payload: Record<string, unknown> = { message: result.text };
  try {
    const parsed = JSON.parse(result.text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = parsed;
  } catch {
    // Compatibility traces before structured receipts stored a plain message.
  }
  return { ...payload, ok: result.status === "success" };
}

function openAiHistoryInput(history: readonly ChatMessage[], includeTools: boolean): Array<Record<string, unknown>> {
  return history.flatMap((message) => {
    const exchange = includeTools ? historicalToolExchange(message) : null;
    if (!exchange) return [{ role: message.role, content: responsesMessageContent(message) }];
    const items: Array<Record<string, unknown>> = [];
    for (const event of exchange.events) {
      if (event.type === "text-delta" && event.text.trim()) {
        items.push({ role: "assistant", content: event.text });
      } else if (event.type === "tool-call") {
        const result = exchange.results.get(event.call.id);
        if (!result) continue;
        items.push({
          type: "function_call",
          call_id: event.call.id,
          name: event.call.name,
          arguments: JSON.stringify(event.call.arguments),
        });
      } else if (event.type === "tool-result") {
        items.push({
          type: "function_call_output",
          call_id: event.result.toolCallId,
          output: JSON.stringify(historicalResultOutput(event.result)),
        });
      }
    }
    return items.length ? items : [{ role: "assistant", content: message.content }];
  });
}

function anthropicHistoryMessages(history: readonly ChatMessage[], includeTools: boolean): Array<Record<string, unknown>> {
  return history.flatMap((message) => {
    const exchange = includeTools ? historicalToolExchange(message) : null;
    if (!exchange) return [{ role: message.role, content: anthropicMessageContent(message) }];
    const messages: Array<Record<string, unknown>> = [];
    let assistantContent: Array<Record<string, unknown>> = [];
    for (const event of exchange.events) {
      if (event.type === "text-delta" && event.text.trim()) {
        assistantContent.push({ type: "text", text: event.text });
      } else if (event.type === "tool-call" && exchange.results.has(event.call.id)) {
        assistantContent.push({ type: "tool_use", id: event.call.id, name: event.call.name, input: event.call.arguments });
      } else if (event.type === "tool-result") {
        if (assistantContent.length) messages.push({ role: "assistant", content: assistantContent });
        messages.push({ role: "user", content: [{
          type: "tool_result",
          tool_use_id: event.result.toolCallId,
          content: JSON.stringify(historicalResultOutput(event.result)),
          ...(event.result.status === "success" ? {} : { is_error: true }),
        }] });
        assistantContent = [];
      }
    }
    if (assistantContent.length) messages.push({ role: "assistant", content: assistantContent });
    return messages.length ? messages : [{ role: "assistant", content: message.content }];
  });
}

function googleHistoryContents(history: readonly ChatMessage[], includeTools: boolean): Array<Record<string, unknown>> {
  return history.flatMap((message) => {
    const exchange = includeTools ? historicalToolExchange(message) : null;
    if (!exchange) return [{
      role: message.role === "assistant" ? "model" : "user",
      parts: geminiMessageParts(message),
    }];
    const contents: Array<Record<string, unknown>> = [];
    let modelParts: Array<Record<string, unknown>> = [];
    for (const event of exchange.events) {
      if (event.type === "text-delta" && event.text.trim()) {
        modelParts.push({ text: event.text });
      } else if (event.type === "tool-call" && exchange.results.has(event.call.id)) {
        modelParts.push({ functionCall: { id: event.call.id, name: event.call.name, args: event.call.arguments } });
      } else if (event.type === "tool-result") {
        if (modelParts.length) contents.push({ role: "model", parts: modelParts });
        contents.push({ role: "user", parts: [{ functionResponse: {
          id: event.result.toolCallId,
          name: exchange.events.find((candidate): candidate is Extract<AgentStreamEvent, { type: "tool-call" }> => candidate.type === "tool-call" && candidate.call.id === event.result.toolCallId)?.call.name ?? "unknown",
          response: { result: historicalResultOutput(event.result) },
        } }] });
        modelParts = [];
      }
    }
    if (modelParts.length) contents.push({ role: "model", parts: modelParts });
    return contents.length ? contents : [{ role: "model", parts: [{ text: message.content }] }];
  });
}

function chatHistoryMessages(
  history: readonly ChatMessage[],
  includeTools: boolean,
  supportsFileParts: boolean,
): Array<Record<string, unknown>> {
  return history.flatMap((message) => {
    const exchange = includeTools ? historicalToolExchange(message) : null;
    if (!exchange) return [{ role: message.role, content: chatMessageContent(message, supportsFileParts) }];
    const messages: Array<Record<string, unknown>> = [];
    let content = "";
    let toolCalls: Array<Record<string, unknown>> = [];
    const flushAssistant = () => {
      if (!content && !toolCalls.length) return;
      messages.push({ role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      content = "";
      toolCalls = [];
    };
    for (const event of exchange.events) {
      if (event.type === "text-delta") content += event.text;
      else if (event.type === "tool-call" && exchange.results.has(event.call.id)) {
        toolCalls.push({ id: event.call.id, type: "function", function: { name: event.call.name, arguments: JSON.stringify(event.call.arguments) } });
      } else if (event.type === "tool-result") {
        flushAssistant();
        messages.push({ role: "tool", tool_call_id: event.result.toolCallId, content: JSON.stringify(historicalResultOutput(event.result)) });
      }
    }
    flushAssistant();
    return messages.length ? messages : [{ role: "assistant", content: message.content }];
  });
}

export function buildProviderRequest(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  options: ProviderRequestOptions = {},
): ProviderRequest {
  const {
    signal,
    stream = false,
    systemPrompt = KEATING_MOBILE_SYSTEM_PROMPT,
    reasoningLevel = "off",
    supportsTemperature = settings.provider !== "openai",
    tools = [],
    continuation,
  } = options;
  const history = recentMessages(messages);
  const commonHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (stream) commonHeaders.Accept = "text/event-stream";

  if (settings.provider === "openai") {
    if (apiKey) commonHeaders.Authorization = `Bearer ${apiKey}`;
    const effort = openAiReasoningEffort(reasoningLevel);
    return {
      url: openAiResponsesUrl(settings.baseUrl),
      init: {
        method: "POST",
        headers: commonHeaders,
        signal,
        body: JSON.stringify({
          model: settings.model,
          instructions: systemPrompt,
          input: continuation?.provider === "openai"
            ? continuation.results.map((result) => ({
                type: "function_call_output",
                call_id: result.callId,
                output: JSON.stringify(result.output),
              }))
            : openAiHistoryInput(history, tools.length > 0),
          ...(continuation?.provider === "openai" ? { previous_response_id: continuation.previousResponseId } : {}),
          ...(tools.length ? {
            tools: tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: true,
            })),
          } : {}),
          ...(effort ? { reasoning: { effort } } : {}),
          ...(supportsTemperature ? { temperature: settings.temperature } : {}),
          ...(stream ? { stream: true } : {}),
        }),
      },
    };
  }

  if (settings.provider === "anthropic") {
    if (apiKey) commonHeaders["x-api-key"] = apiKey;
    commonHeaders["anthropic-version"] = "2023-06-01";
    const thinkingBudget = anthropicThinkingBudget(reasoningLevel);
    return {
      url: `${withoutTrailingSlash(settings.baseUrl)}/messages`,
      init: {
        method: "POST",
        headers: commonHeaders,
        signal,
        body: JSON.stringify({
          model: settings.model,
          system: systemPrompt,
          max_tokens: anthropicMaxTokens(thinkingBudget),
          // Anthropic rejects any temperature other than 1 while thinking is
          // enabled, so the teaching-style control yields to the budget.
          ...(thinkingBudget === null
            ? { temperature: settings.temperature }
            : { thinking: { type: "enabled", budget_tokens: thinkingBudget } }),
          ...(stream ? { stream: true } : {}),
          ...(tools.length ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          } : {}),
          messages: [
            ...anthropicHistoryMessages(history, tools.length > 0),
            ...(continuation?.provider === "anthropic" ? continuation.exchanges.flatMap((exchange) => [
              { role: "assistant", content: exchange.assistantContent },
              {
                role: "user",
                content: exchange.results.map((result) => ({
                  type: "tool_result",
                  tool_use_id: result.callId,
                  content: JSON.stringify(result.output),
                  ...(result.isError ? { is_error: true } : {}),
                })),
              },
            ]) : []),
          ],
        }),
      },
    };
  }

  if (settings.provider === "google") {
    const googleBudget = googleThinkingBudget(reasoningLevel);
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
          contents: [
            ...googleHistoryContents(history, tools.length > 0),
            ...(continuation?.provider === "google" ? continuation.exchanges.flatMap((exchange) => [
              exchange.modelContent,
              {
                role: "user",
                parts: exchange.results.map((result) => ({
                  functionResponse: {
                    name: result.name,
                  ...(result.nativeCallId ? { id: result.nativeCallId } : {}),
                    response: { result: result.output },
                  },
                })),
              },
            ]) : []),
          ],
          ...(tools.length ? {
            tools: [{
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          } : {}),
          generationConfig: {
            temperature: settings.temperature,
            maxOutputTokens: 4096,
            ...(googleBudget === null ? {} : { thinkingConfig: { thinkingBudget: googleBudget } }),
          },
        }),
      },
    };
  }

  const chatEffort = settings.provider === "openrouter"
    ? openRouterReasoningEffort(reasoningLevel)
    : openAiReasoningEffort(reasoningLevel);
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
        ...(supportsTemperature ? { temperature: settings.temperature } : {}),
        ...(chatEffort
          ? settings.provider === "openrouter"
            ? { reasoning: { effort: chatEffort } }
            : { reasoning_effort: chatEffort }
          : {}),
        ...(stream ? { stream: true } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          ...chatHistoryMessages(history, tools.length > 0, settings.provider === "openrouter"),
          ...(continuation && (continuation.provider === "openrouter" || continuation.provider === "custom") ? continuation.exchanges.flatMap((exchange) => [
            exchange.assistantMessage,
            ...exchange.results.map((result) => ({
              role: "tool",
              tool_call_id: result.callId,
              content: JSON.stringify(result.output),
            })),
          ]) : []),
        ],
        ...(tools.length ? {
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: "auto",
        } : {}),
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

function boundedProviderText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 2_000 ? `${compact.slice(0, 1_999)}…` : compact;
}

function extractProviderText(settings: ProviderSettings, payload: unknown): string {
  const record = payload as Record<string, any>;
  if (settings.provider === "openai") {
    if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text.trim();
    const text = Array.isArray(record.output)
      ? record.output
        .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
        .filter((part: any) => part?.type === "output_text" && typeof part?.text === "string")
        .map((part: any) => part.text)
        .join("\n")
      : "";
    if (text.trim()) return text.trim();
  } else if (settings.provider === "anthropic") {
    const text = Array.isArray(record.content)
      ? record.content.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n")
      : "";
    if (text.trim()) return text.trim();
  } else if (settings.provider === "google") {
    const text = record.candidates?.[0]?.content?.parts
      ?.filter((part: any) => part?.thought !== true)
      .map((part: any) => typeof part?.text === "string" ? part.text : "")
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

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function extractProviderUsage(settings: ProviderSettings, payload: unknown): ProviderUsage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, any>;
  let usage: Record<string, unknown> | undefined;
  if (settings.provider === "openai") usage = record.response?.usage ?? record.usage;
  else if (settings.provider === "anthropic") usage = record.message?.usage ?? record.usage;
  else if (settings.provider === "google") usage = record.usageMetadata;
  else usage = record.usage;
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = finiteCount(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount) ?? 0;
  const outputTokens = finiteCount(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount) ?? 0;
  const totalTokens = finiteCount(usage.total_tokens ?? usage.totalTokenCount) ?? inputTokens + outputTokens;
  const costUsd = finiteCount(usage.cost ?? usage.cost_usd);
  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0 && costUsd === undefined) return null;
  return { inputTokens, outputTokens, totalTokens, ...(costUsd === undefined ? {} : { costUsd }) };
}

function mergeProviderUsage(current: ProviderUsage | null, next: ProviderUsage | null): ProviderUsage | null {
  if (!next) return current;
  if (!current) return next;
  const inputTokens = Math.max(current.inputTokens, next.inputTokens);
  const outputTokens = Math.max(current.outputTokens, next.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(current.totalTokens, next.totalTokens, inputTokens + outputTokens),
    ...(current.costUsd === undefined && next.costUsd === undefined
      ? {}
      : { costUsd: Math.max(current.costUsd ?? 0, next.costUsd ?? 0) }),
  };
}

const EVENT_SEPARATOR = /\r?\n\r?\n/;

/**
 * Splits an incoming SSE text stream into `data:` payload strings, carrying any
 * partial trailing event across chunk boundaries.
 */
export interface SseParser {
  (chunk: string): string[];
  /** Emits a final event when a provider closes without a blank-line delimiter. */
  flush(): string[];
}

function sseEventData(rawEvent: string): string | null {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  return data || null;
}

export function createSseParser(): SseParser {
  let buffer = "";
  const parse = ((chunk: string) => {
    buffer += chunk;
    const events: string[] = [];
    for (let match = EVENT_SEPARATOR.exec(buffer); match; match = EVENT_SEPARATOR.exec(buffer)) {
      const rawEvent = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = sseEventData(rawEvent);
      if (data) events.push(data);
    }
    return events;
  }) as SseParser;
  parse.flush = () => {
    const data = sseEventData(buffer);
    buffer = "";
    return data ? [data] : [];
  };
  return parse;
}

function textFromParts(parts: unknown): string {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  // Gemini returns its thinking as ordinary parts flagged `thought: true`.
  // Those belong to the reasoning budget, not the reply the learner reads.
  return parts
    .filter((part: any) => part?.thought !== true)
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

export interface ProviderToolCall {
  id: string;
  /** Exact provider correlation id; absent only when that protocol makes it optional. */
  nativeId?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ProviderAssistantTurn =
  | { provider: "openai"; previousResponseId: string }
  | { provider: "anthropic"; assistantContent: Array<Record<string, unknown>> }
  | { provider: "google"; modelContent: Record<string, unknown> }
  | { provider: "openrouter" | "custom"; assistantMessage: Record<string, unknown> };

export interface ProviderRound {
  text: string;
  calls: ProviderToolCall[];
  usage: ProviderUsage | null;
  stopReason?: string;
  assistantTurn: ProviderAssistantTurn | null;
}

export interface ProviderRoundRequestOptions extends ProviderRequestOptions {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onReasoningDelta?: (delta: string, accumulated: string) => void;
  onToolCall?: (call: ProviderToolCall) => void;
  onUsage?: (usage: ProviderUsage) => void;
  fetchImpl?: FetchLike;
}

export function continueProviderTurn(
  turn: ProviderAssistantTurn,
  results: ProviderToolResult[],
  previous?: ProviderToolContinuation,
): ProviderToolContinuation {
  if (turn.provider === "openai") return { ...turn, results };
  if (turn.provider === "anthropic") return {
    provider: "anthropic",
    exchanges: [
      ...(previous?.provider === "anthropic" ? previous.exchanges : []),
      { assistantContent: turn.assistantContent, results },
    ],
  };
  if (turn.provider === "google") return {
    provider: "google",
    exchanges: [
      ...(previous?.provider === "google" ? previous.exchanges : []),
      { modelContent: turn.modelContent, results },
    ],
  };
  return {
    provider: turn.provider,
    exchanges: [
      ...(previous?.provider === turn.provider ? previous.exchanges : []),
      { assistantMessage: turn.assistantMessage, results },
    ],
  };
}

function extractProviderRound(settings: ProviderSettings, payload: unknown): ProviderRound {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("The provider returned an invalid response.");
  }
  const record = payload as Record<string, any>;
  if (record.error) throw new Error(providerErrorMessage(record, "The provider returned an error."));

  let text = "";
  let calls: ProviderToolCall[] = [];
  let stopReason: string | undefined;
  let assistantTurn: ProviderAssistantTurn | null = null;

  if (settings.provider === "openai") {
    if (record.status === "failed" || record.status === "incomplete") {
      throw new Error(providerErrorMessage({ error: record.error ?? record.incomplete_details }, `The OpenAI response ${record.status}.`));
    }
    text = typeof record.output_text === "string" ? record.output_text : (Array.isArray(record.output)
      ? record.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
        .filter((part: any) => part?.type === "output_text" && typeof part?.text === "string")
        .map((part: any) => part.text).join("\n")
      : "");
    calls = Array.isArray(record.output) ? record.output
      .filter((item: any) => item?.type === "function_call")
      .map((item: any) => ({
        id: String(item.call_id ?? ""),
        nativeId: String(item.call_id ?? ""),
        name: String(item.name ?? "unknown"),
        arguments: parsedToolArguments(item.arguments),
      })) : [];
    stopReason = typeof record.status === "string" ? record.status : undefined;
    if (calls.length && (typeof record.id !== "string" || !record.id.trim() || record.id.length > 512)) {
      throw new Error("OpenAI omitted the response id required to continue a tool call.");
    }
    if (typeof record.id === "string" && record.id.trim() && record.id.length <= 512) {
      assistantTurn = { provider: "openai", previousResponseId: record.id };
    }
  } else if (settings.provider === "anthropic") {
    const content = Array.isArray(record.content) ? record.content : [];
    text = content.filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text).join("\n");
    calls = content.filter((block: any) => block?.type === "tool_use").map((block: any) => ({
      id: String(block.id ?? ""),
      nativeId: String(block.id ?? ""),
      name: String(block.name ?? "unknown"),
      arguments: parsedToolArguments(block.input),
    }));
    stopReason = typeof record.stop_reason === "string" ? record.stop_reason : undefined;
    assistantTurn = { provider: "anthropic", assistantContent: structuredClone(content) };
  } else if (settings.provider === "google") {
    const candidate = record.candidates?.[0];
    const content = candidate?.content;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    text = textFromParts(parts);
    calls = parts.filter((part: any) => part?.functionCall).map((part: any, index: number) => ({
      id: typeof part.functionCall.id === "string" && part.functionCall.id ? part.functionCall.id : `google-call-${index}`,
      ...(typeof part.functionCall.id === "string" && part.functionCall.id ? { nativeId: part.functionCall.id } : {}),
      name: String(part.functionCall.name ?? "unknown"),
      arguments: parsedToolArguments(part.functionCall.args),
    }));
    stopReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined;
    if (content && typeof content === "object") {
      assistantTurn = { provider: "google", modelContent: structuredClone(content) };
    }
  } else {
    const choice = record.choices?.[0];
    if (choice?.error) throw new Error(providerErrorMessage(choice, "The model provider returned an error."));
    const message = choice?.message;
    text = typeof message?.content === "string" ? message.content : textFromParts(message?.content);
    calls = Array.isArray(message?.tool_calls) ? message.tool_calls.map((call: any) => ({
      id: String(call?.id ?? ""),
      nativeId: String(call?.id ?? ""),
      name: String(call?.function?.name ?? "unknown"),
      arguments: parsedToolArguments(call?.function?.arguments),
    })) : [];
    stopReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;
    if (message && typeof message === "object") {
      assistantTurn = {
        provider: settings.provider,
        assistantMessage: { role: "assistant", ...structuredClone(message) },
      };
    }
  }

  if (!text.trim() && calls.length === 0) {
    throw new Error("The provider returned a response without readable text or a tool call.");
  }
  if (calls.some((call) => !call.id || (settings.provider !== "google" && !call.nativeId))) {
    throw new Error("The provider returned a tool call without the id required for exactly-once continuation.");
  }
  return { text: text.trim(), calls, usage: extractProviderUsage(settings, payload), stopReason, assistantTurn };
}

export type ProviderStreamSignal =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; call: ProviderToolCall };

interface PendingToolCall { id: string; name: string; argumentsText: string }

function parsedToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : { value: parsed };
  } catch {
    return { unparsed: value.slice(0, 8_000) };
  }
}

/** Stateful adapter for provider-specific text, reasoning, and tool-call frames. */
export function createProviderStreamSignalParser(settings: ProviderSettings): (data: string) => ProviderStreamSignal[] {
  const pending = new Map<string | number, PendingToolCall>();
  let generatedCall = 0;
  return (data: string) => {
    if (!data || data === "[DONE]") return [];
    let payload: any;
    try { payload = JSON.parse(data); } catch { return []; }
    if (payload?.error) throw new Error(providerErrorMessage(payload, "The provider reported a streaming error."));
    if (settings.provider === "openai" && payload.type === "response.failed") {
      throw new Error(providerErrorMessage({ error: payload.response?.error ?? payload.response }, "The OpenAI response failed."));
    }
    const signals: ProviderStreamSignal[] = [];
    if (settings.provider === "anthropic") {
      if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta" && typeof payload.delta.text === "string") {
        signals.push({ type: "text-delta", text: payload.delta.text });
      } else if (payload.type === "content_block_start" && payload.content_block?.type === "tool_use") {
        const initialInput = payload.content_block.input;
        pending.set(payload.index, {
          id: String(payload.content_block.id ?? `anthropic-call-${generatedCall++}`),
          name: String(payload.content_block.name ?? "unknown"),
          argumentsText: initialInput && typeof initialInput === "object" && Object.keys(initialInput).length > 0
            ? JSON.stringify(initialInput)
            : "",
        });
      } else if (payload.type === "content_block_delta" && payload.delta?.type === "input_json_delta") {
        const call = pending.get(payload.index);
        if (call) call.argumentsText += String(payload.delta.partial_json ?? "");
      } else if (payload.type === "content_block_stop") {
        const call = pending.get(payload.index);
        if (call) {
          signals.push({ type: "tool-call", call: { id: call.id, nativeId: call.id, name: call.name, arguments: parsedToolArguments(call.argumentsText) } });
          pending.delete(payload.index);
        }
      }
      return signals;
    }
    if (settings.provider === "openai") {
      if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") signals.push({ type: "text-delta", text: payload.delta });
      else if (payload.type === "response.reasoning_summary_text.delta" && typeof payload.delta === "string") signals.push({ type: "reasoning-delta", text: payload.delta });
      else if (payload.type === "response.output_item.added" && payload.item?.type === "function_call") {
        pending.set(String(payload.item.id ?? payload.output_index), { id: String(payload.item.call_id ?? payload.item.id ?? `openai-call-${generatedCall++}`), name: String(payload.item.name ?? "unknown"), argumentsText: String(payload.item.arguments ?? "") });
      } else if (payload.type === "response.function_call_arguments.delta") {
        const call = pending.get(String(payload.item_id ?? payload.output_index));
        if (call) call.argumentsText += String(payload.delta ?? "");
      } else if (payload.type === "response.output_item.done" && payload.item?.type === "function_call") {
        const key = String(payload.item.id ?? payload.output_index);
        const call = pending.get(key) ?? { id: String(payload.item.call_id ?? payload.item.id ?? `openai-call-${generatedCall++}`), name: String(payload.item.name ?? "unknown"), argumentsText: String(payload.item.arguments ?? "") };
        signals.push({ type: "tool-call", call: { id: call.id, nativeId: call.id, name: call.name, arguments: parsedToolArguments(payload.item.arguments || call.argumentsText) } });
        pending.delete(key);
      }
      return signals;
    }
    if (settings.provider === "google") {
      for (const part of payload?.candidates?.[0]?.content?.parts ?? []) {
        if (part?.thought === true) continue;
        if (typeof part?.text === "string") signals.push({ type: "text-delta", text: part.text });
        if (part?.functionCall) {
          const nativeId = typeof part.functionCall.id === "string" && part.functionCall.id ? part.functionCall.id : undefined;
          signals.push({
            type: "tool-call",
            call: {
              id: nativeId ?? `google-call-${generatedCall++}`,
              ...(nativeId ? { nativeId } : {}),
              name: String(part.functionCall.name ?? "unknown"),
              arguments: parsedToolArguments(part.functionCall.args),
            },
          });
        }
      }
      return signals;
    }
    const delta = payload?.choices?.[0]?.delta;
    const text = typeof delta?.content === "string" ? delta.content : textFromParts(delta?.content);
    if (text) signals.push({ type: "text-delta", text });
    for (const fragment of delta?.tool_calls ?? []) {
      const key = Number.isInteger(fragment?.index) ? fragment.index : String(fragment?.id ?? generatedCall++);
      const call = pending.get(key) ?? { id: String(fragment?.id ?? `chat-call-${generatedCall++}`), name: "unknown", argumentsText: "" };
      if (fragment?.id) call.id = String(fragment.id);
      if (fragment?.function?.name) call.name = String(fragment.function.name);
      call.argumentsText += String(fragment?.function?.arguments ?? "");
      pending.set(key, call);
    }
    if (payload?.choices?.[0]?.finish_reason === "tool_calls") {
      for (const call of pending.values()) signals.push({ type: "tool-call", call: { id: call.id, nativeId: call.id, name: call.name, arguments: parsedToolArguments(call.argumentsText) } });
      pending.clear();
    }
    return signals;
  };
}

/**
 * Pulls the incremental text out of one SSE event for the given provider.
 * Returns an empty string for keep-alives and non-text events.
 */
export function extractStreamDelta(settings: ProviderSettings, data: string): string {
  return createProviderStreamSignalParser(settings)(data)
    .filter((signal): signal is Extract<ProviderStreamSignal, { type: "text-delta" }> => signal.type === "text-delta")
    .map((signal) => signal.text)
    .join("");
}

async function throwProviderError(response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const plainText = boundedProviderText(text);
    throw new Error(plainText || `Provider request failed with HTTP ${response.status}.`);
  }
  throw new Error(providerErrorMessage(payload, `Provider request failed with HTTP ${response.status}.`));
}

export interface StreamCompletionOptions extends ProviderRequestOptions {
  /** Called with each incremental text chunk as it arrives. */
  onDelta?: (delta: string, accumulated: string) => void;
  onReasoningDelta?: (delta: string, accumulated: string) => void;
  onToolCall?: (call: ProviderToolCall) => void;
  onUsage?: (usage: ProviderUsage) => void;
  fetchImpl?: FetchLike;
}

function uniqueStreamCalls(signals: readonly ProviderStreamSignal[]): ProviderToolCall[] {
  const calls = new Map<string, ProviderToolCall>();
  for (const signal of signals) {
    if (signal.type !== "tool-call") continue;
    calls.set(`${signal.call.nativeId ?? ""}:${signal.call.id}`, signal.call);
  }
  return [...calls.values()];
}

function streamedAnthropicPayload(payloads: readonly any[]): Record<string, unknown> {
  const message = structuredClone(payloads.find((payload) => payload?.type === "message_start")?.message ?? {});
  const blocks = new Map<number, Record<string, any>>();
  const toolArguments = new Map<number, string>();
  let stopReason: string | undefined;
  let usage: Record<string, unknown> | undefined = message.usage;

  for (const payload of payloads) {
    const index = Number(payload?.index);
    if (payload?.type === "content_block_start" && Number.isSafeInteger(index) && payload.content_block) {
      const block = structuredClone(payload.content_block) as Record<string, any>;
      blocks.set(index, block);
      if (block.type === "tool_use") {
        toolArguments.set(index, block.input && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : "");
      }
    } else if (payload?.type === "content_block_delta" && Number.isSafeInteger(index)) {
      const block = blocks.get(index);
      if (!block) continue;
      if (payload.delta?.type === "text_delta") block.text = String(block.text ?? "") + String(payload.delta.text ?? "");
      // Anthropic requires streamed thinking blocks and their signature to be
      // replayed exactly for a tool continuation. They remain transport-only:
      // the learner-visible signal parser deliberately emits neither field.
      if (payload.delta?.type === "thinking_delta") block.thinking = String(block.thinking ?? "") + String(payload.delta.thinking ?? "");
      if (payload.delta?.type === "signature_delta") block.signature = String(block.signature ?? "") + String(payload.delta.signature ?? "");
      if (payload.delta?.type === "input_json_delta") {
        toolArguments.set(index, (toolArguments.get(index) ?? "") + String(payload.delta.partial_json ?? ""));
      }
    } else if (payload?.type === "message_delta") {
      if (typeof payload.delta?.stop_reason === "string") stopReason = payload.delta.stop_reason;
      if (payload.usage && typeof payload.usage === "object") usage = { ...(usage ?? {}), ...payload.usage };
    }
  }

  for (const [index, argumentsText] of toolArguments) {
    const block = blocks.get(index);
    if (block) block.input = parsedToolArguments(argumentsText);
  }
  return {
    ...message,
    content: [...blocks.entries()].sort(([left], [right]) => left - right).map(([, block]) => block),
    ...(stopReason ? { stop_reason: stopReason } : {}),
    ...(usage ? { usage } : {}),
  };
}

function streamedGooglePayload(payloads: readonly any[]): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = [];
  let finishReason: string | undefined;
  let usageMetadata: Record<string, unknown> | undefined;
  for (const payload of payloads) {
    const candidate = payload?.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) parts.push(structuredClone(part));
    if (typeof candidate?.finishReason === "string") finishReason = candidate.finishReason;
    if (payload?.usageMetadata && typeof payload.usageMetadata === "object") usageMetadata = payload.usageMetadata;
  }
  return {
    candidates: [{ content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}) }],
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}

function streamedChatPayload(payloads: readonly any[], text: string): Record<string, unknown> {
  const toolCalls = new Map<string | number, Record<string, any>>();
  let finishReason: string | undefined;
  let usage: Record<string, unknown> | undefined;
  for (const payload of payloads) {
    const choice = payload?.choices?.[0];
    for (const fragment of choice?.delta?.tool_calls ?? []) {
      const key = Number.isSafeInteger(fragment?.index) ? fragment.index : String(fragment?.id ?? toolCalls.size);
      const call = toolCalls.get(key) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      if (fragment?.id) call.id = String(fragment.id);
      if (fragment?.type) call.type = String(fragment.type);
      if (fragment?.function?.name) call.function.name = String(fragment.function.name);
      call.function.arguments += String(fragment?.function?.arguments ?? "");
      toolCalls.set(key, call);
    }
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    if (payload?.usage && typeof payload.usage === "object") usage = payload.usage;
  }
  return {
    choices: [{
      message: {
        role: "assistant",
        content: text || null,
        ...(toolCalls.size ? { tool_calls: [...toolCalls.values()] } : {}),
      },
      ...(finishReason ? { finish_reason: finishReason } : {}),
    }],
    ...(usage ? { usage } : {}),
  };
}

function streamedProviderRound(
  settings: ProviderSettings,
  payloads: readonly any[],
  signals: readonly ProviderStreamSignal[],
  visibleText: string,
  usage: ProviderUsage | null,
): ProviderRound {
  let payload: Record<string, unknown>;
  if (settings.provider === "openai") {
    const complete = [...payloads].reverse().find((frame) => frame?.response && typeof frame.response === "object")?.response;
    if (complete && Array.isArray(complete.output)) {
      payload = complete;
    } else {
      const responseId = [...payloads].reverse().find((frame) => typeof frame?.response?.id === "string")?.response.id;
      payload = {
        id: responseId,
        status: "completed",
        output_text: visibleText,
        output: uniqueStreamCalls(signals).map((call) => ({
          type: "function_call",
          call_id: call.nativeId ?? call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        })),
      };
    }
  } else if (settings.provider === "anthropic") {
    payload = streamedAnthropicPayload(payloads);
  } else if (settings.provider === "google") {
    payload = streamedGooglePayload(payloads);
  } else {
    payload = streamedChatPayload(payloads, visibleText);
  }
  const round = extractProviderRound(settings, payload);
  return { ...round, text: visibleText.trim() || round.text, usage };
}

async function requestStreamingProviderRound(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  options: ProviderRoundRequestOptions,
): Promise<ProviderRound> {
  const {
    onTextDelta,
    onReasoningDelta,
    onToolCall,
    onUsage,
    fetchImpl = fetch,
    ...requestOptions
  } = options;
  const request = buildProviderRequest(settings, apiKey, messages, { ...requestOptions, stream: true });
  const response = await fetchImpl(request.url, request.init);
  if (!response.ok) await throwProviderError(response);

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("text/event-stream")) {
    const text = await response.text();
    let payload: unknown;
    try { payload = text.trim() ? JSON.parse(text) : {}; } catch { throw new Error("The provider returned an invalid JSON response."); }
    const round = extractProviderRound(settings, payload);
    if (round.text) onTextDelta?.(round.text, round.text);
    for (const call of round.calls) onToolCall?.(call);
    if (round.usage) onUsage?.(round.usage);
    return round;
  }
  if (!response.body) {
    throw new Error("The provider accepted streaming but returned no readable response body.");
  }

  const decoder = new TextDecoder();
  const parseEvents = createSseParser();
  const parseSignals = createProviderStreamSignalParser(settings);
  const reader = response.body.getReader();
  const payloads: any[] = [];
  const signals: ProviderStreamSignal[] = [];
  let visibleText = "";
  let visibleReasoning = "";
  let usage: ProviderUsage | null = null;

  const consume = (data: string) => {
    if (data && data !== "[DONE]") {
      try {
        const payload = JSON.parse(data);
        payloads.push(payload);
        usage = mergeProviderUsage(usage, extractProviderUsage(settings, payload));
      } catch {
        // The signal parser intentionally ignores non-JSON keep-alives.
      }
    }
    for (const signal of parseSignals(data)) {
      signals.push(signal);
      if (signal.type === "text-delta") {
        visibleText += signal.text;
        onTextDelta?.(signal.text, visibleText);
      } else if (signal.type === "reasoning-delta") {
        visibleReasoning += signal.text;
        onReasoningDelta?.(signal.text, visibleReasoning);
      } else {
        onToolCall?.(signal.call);
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const data of parseEvents(decoder.decode(value, { stream: true }))) consume(data);
    }
    const tail = decoder.decode();
    for (const data of parseEvents(tail)) consume(data);
    for (const data of parseEvents.flush()) consume(data);
  } finally {
    reader.releaseLock();
  }

  const round = streamedProviderRound(settings, payloads, signals, visibleText, usage);
  if (usage) onUsage?.(usage);
  return round;
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
  const { onDelta, onReasoningDelta, onToolCall, onUsage, fetchImpl = fetch, ...requestOptions } = options;
  const request = buildProviderRequest(settings, apiKey, messages, { ...requestOptions, stream: true });
  const response = await fetchImpl(request.url, request.init);

  if (!response.ok) await throwProviderError(response);

  const body = response.body;
  if (!body) {
    // No readable stream on this platform — take the whole payload at once.
    return wholePayloadFallback(settings, await response.text(), onDelta, onUsage);
  }

  const decoder = new TextDecoder();
  const parse = createSseParser();
  const reader = body.getReader();
  let accumulated = "";
  let accumulatedReasoning = "";
  let raw = "";
  let usage: ProviderUsage | null = null;
  const parseSignals = createProviderStreamSignalParser(settings);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      for (const data of parse(chunk)) {
        try {
          usage = mergeProviderUsage(usage, extractProviderUsage(settings, JSON.parse(data)));
        } catch {
          // Keep-alives and non-JSON terminal frames carry no usage.
        }
        for (const signal of parseSignals(data)) {
          if (signal.type === "text-delta") {
            accumulated += signal.text;
            onDelta?.(signal.text, accumulated);
          } else if (signal.type === "reasoning-delta") {
            accumulatedReasoning += signal.text;
            onReasoningDelta?.(signal.text, accumulatedReasoning);
          } else {
            onToolCall?.(signal.call);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const trimmed = accumulated.trim();
  if (trimmed) {
    if (usage) onUsage?.(usage);
    return trimmed;
  }

  // Some OpenAI-compatible servers (local runtimes especially) ignore
  // `stream: true` and answer with one plain JSON body instead of SSE.
  return wholePayloadFallback(settings, raw, onDelta, onUsage);
}

function wholePayloadFallback(
  settings: ProviderSettings,
  text: string,
  onDelta?: (delta: string, accumulated: string) => void,
  onUsage?: (usage: ProviderUsage) => void,
): string {
  let payload: unknown;
  try {
    payload = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error("The provider returned a response without readable text.");
  }
  const content = extractProviderText(settings, payload);
  const usage = extractProviderUsage(settings, payload);
  if (usage) onUsage?.(usage);
  onDelta?.(content, content);
  return content;
}

export async function requestProviderRound(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  options: ProviderRoundRequestOptions = {},
): Promise<ProviderRound> {
  if (options.stream) return requestStreamingProviderRound(settings, apiKey, messages, options);
  const { fetchImpl = fetch, ...requestOptions } = options;
  const request = buildProviderRequest(settings, apiKey, messages, requestOptions);
  const response = await fetchImpl(request.url, request.init);
  const responseText = await response.text();
  let payload: unknown = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) {
      const plainText = boundedProviderText(responseText);
      throw new Error(plainText || `Provider request failed with HTTP ${response.status}.`);
    }
    throw new Error("The provider returned an invalid JSON response.");
  }

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload, `Provider request failed with HTTP ${response.status}.`));
  }
  return extractProviderRound(settings, payload);
}

export async function requestCompletion(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
  systemPrompt?: string,
): Promise<string> {
  const round = await requestProviderRound(settings, apiKey, messages, { signal, fetchImpl, systemPrompt });
  if (!round.text) throw new Error("The provider returned a response without readable text.");
  return round.text;
}
