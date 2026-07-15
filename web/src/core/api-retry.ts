export interface ApiRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  rateLimitIntervalMs: number;
  jitterRatio: number;
}

export const DEFAULT_API_RETRY_POLICY: ApiRetryPolicy = {
  maxAttempts: 4,
  initialDelayMs: 750,
  maxDelayMs: 30_000,
  rateLimitIntervalMs: 500,
  jitterRatio: 0.2
};

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export type LlmErrorCategory =
  | "aborted"
  | "auth"
  | "billing"
  | "context-length"
  | "invalid-request"
  | "model-unavailable"
  | "network"
  | "permission"
  | "rate-limit"
  | "safety"
  | "server"
  | "timeout"
  | "unknown";

export interface LlmErrorDetails {
  category: LlmErrorCategory;
  statusCode: number | null;
  title: string;
  description: string;
  recovery: string;
  automaticRetry: boolean;
  retryAfterMs: number | null;
}

const BILLING_ERROR_PATTERN = /\b(insufficient[_ -]?(?:quota|funds|credits?|balance)|billing|payment required|credit balance|add (?:funds|credits?)|purchase credits?|spending limit)\b/i;
const AUTH_ERROR_PATTERN = /\b(authentication[_ -]?error|invalid[_ .-]?api[_ .-]?key|api[_ .-]?key.*(?:invalid|expired)|unauthorized|invalid[_ -]?token|token.*expired|login.*fail|credentials?.*(?:invalid|expired))\b/i;
const CONTEXT_ERROR_PATTERN = /\b(context[_ -]?(?:length|window)|maximum context|prompt is too long|too many (?:input )?tokens|token limit|reduce the length|request too large)\b/i;
const MODEL_ERROR_PATTERN = /\b(model.*(?:not found|does not exist|unavailable|disabled|deprecated|not supported)|unknown model|no endpoints found)\b/i;
const SAFETY_ERROR_PATTERN = /\b(content[_ -]?(?:filter|policy)|safety (?:filter|policy)|blocked for safety|model refused|request was refused|moderation)\b/i;
const TIMEOUT_ERROR_PATTERN = /\b(timeout|timed out|etimedout|deadline exceeded|gateway timeout)\b/i;
const NETWORK_ERROR_PATTERN = /\b(network error|failed to fetch|fetch failed|econnreset|econnrefused|enotfound|socket hang up|connection (?:reset|refused|closed)|dns error|offline)\b/i;
const RATE_LIMIT_ERROR_PATTERN = /\b(rate[_ -]?limit|too many requests|resource[_ -]?exhausted|throttl|requests per (?:minute|day)|tokens per minute)\b/i;
const SERVER_ERROR_PATTERN = /\b(overload|overloaded|service unavailable|temporarily unavailable|upstream error|bad gateway|server error|try again later)\b/i;

let nextStartAt = 0;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeApiRetryPolicy(value: unknown): ApiRetryPolicy {
  const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fromNumber = (key: keyof ApiRetryPolicy, fallback: number, min: number, max: number) => {
    const raw = entry[key];
    return typeof raw === "number" && Number.isFinite(raw)
      ? clampNumber(raw, min, max)
      : fallback;
  };

  return {
    maxAttempts: Math.round(fromNumber("maxAttempts", DEFAULT_API_RETRY_POLICY.maxAttempts, 1, 8)),
    initialDelayMs: Math.round(fromNumber("initialDelayMs", DEFAULT_API_RETRY_POLICY.initialDelayMs, 0, 60_000)),
    maxDelayMs: Math.round(fromNumber("maxDelayMs", DEFAULT_API_RETRY_POLICY.maxDelayMs, 0, 300_000)),
    rateLimitIntervalMs: Math.round(fromNumber("rateLimitIntervalMs", DEFAULT_API_RETRY_POLICY.rateLimitIntervalMs, 0, 60_000)),
    jitterRatio: fromNumber("jitterRatio", DEFAULT_API_RETRY_POLICY.jitterRatio, 0, 1)
  };
}

export function apiErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function numericStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value.trim())) {
    const parsed = Number(value);
    return parsed >= 100 && parsed <= 599 ? parsed : null;
  }
  return null;
}

export function apiErrorStatus(error: unknown): number | null {
  if (error && typeof error === "object") {
    const entry = error as Record<string, unknown>;
    for (const candidate of [entry.status, entry.statusCode, entry.httpStatus]) {
      const status = numericStatus(candidate);
      if (status !== null) return status;
    }
    if (entry.response && typeof entry.response === "object") {
      const status = numericStatus((entry.response as Record<string, unknown>).status);
      if (status !== null) return status;
    }
  }
  return retryableStatusCode(apiErrorText(error));
}

export function retryableStatusCode(message: string): number | null {
  const matches = message.match(/\b(?:status|http|code|exit)?\s*[:=]?\s*(\d{3})\b/gi) ?? [];
  for (const match of matches) {
    const code = Number(match.match(/\d{3}/)?.[0]);
    if (code >= 400 && code <= 599) return code;
  }
  return null;
}

export function isRetryableApiError(error: unknown): boolean {
  return classifyLlmError(error).automaticRetry;
}

export function retryAfterDelayMs(error: unknown): number | null {
  if (error && typeof error === "object") {
    const entry = error as Record<string, unknown>;
    const response = entry.response && typeof entry.response === "object"
      ? entry.response as Record<string, unknown>
      : null;
    const headers = (response?.headers ?? entry.headers) as unknown;
    let headerValue: unknown;
    if (headers && typeof (headers as { get?: unknown }).get === "function") {
      headerValue = (headers as { get(name: string): unknown }).get("retry-after");
    } else if (headers && typeof headers === "object") {
      const record = headers as Record<string, unknown>;
      headerValue = record["retry-after"] ?? record["Retry-After"];
    }
    headerValue ??= entry.retryAfter ?? entry.retry_after;
    if (headerValue !== undefined && headerValue !== null) {
      const delay = parseRetryAfter(String(headerValue));
      if (delay !== null) return delay;
    }
  }

  const message = apiErrorText(error);
  const retryAfter = message.match(/retry-after\s*[:=]\s*([^\n,;]+)/i);
  if (!retryAfter) return null;

  return parseRetryAfter(retryAfter[1]);
}

function parseRetryAfter(raw: string): number | null {
  const value = raw.trim();
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function rateLimitRecovery(retryAfterMs: number | null): string {
  if (retryAfterMs === null) {
    return "Keating retries this automatically with exponential backoff. If it still fails, wait a moment or choose another model.";
  }
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `The provider asked Keating to wait about ${seconds} second${seconds === 1 ? "" : "s"}. Keating honors that delay automatically.`;
}

export function classifyLlmError(error: unknown): LlmErrorDetails {
  const message = apiErrorText(error);
  const statusCode = apiErrorStatus(error);
  const retryAfterMs = retryAfterDelayMs(error);
  const normalized = message.toLowerCase();

  if (/\b(abort(?:ed)?|cancelled|canceled)\b/i.test(normalized)) {
    return {
      category: "aborted", statusCode, retryAfterMs, automaticRetry: false,
      title: "Response stopped",
      description: "The request ended before the model finished responding.",
      recovery: "Retry the response when you are ready. Your conversation is still intact.",
    };
  }
  if (BILLING_ERROR_PATTERN.test(message) || statusCode === 402) {
    return {
      category: "billing", statusCode, retryAfterMs, automaticRetry: false,
      title: "Provider credits unavailable",
      description: "The model provider rejected this request because the account is out of credits or has reached a spending limit.",
      recovery: "Add credits in the provider account, or choose another configured model. Retrying before that will not help.",
    };
  }
  if (AUTH_ERROR_PATTERN.test(message) || statusCode === 401) {
    return {
      category: "auth", statusCode, retryAfterMs, automaticRetry: false,
      title: "Provider sign-in failed",
      description: "The selected provider rejected its API key or sign-in session.",
      recovery: "Re-enter the provider credentials. Keating can then retry the same turn without losing your prompt.",
    };
  }
  if (CONTEXT_ERROR_PATTERN.test(message)) {
    return {
      category: "context-length", statusCode, retryAfterMs, automaticRetry: false,
      title: "Conversation is too large for this model",
      description: "The prompt, attachments, tools, and conversation history exceed the selected model's context window.",
      recovery: "Start a focused chat, remove large attachments, or choose a model with a larger context window.",
    };
  }
  if (MODEL_ERROR_PATTERN.test(message) || statusCode === 404) {
    return {
      category: "model-unavailable", statusCode, retryAfterMs, automaticRetry: false,
      title: "Model is unavailable",
      description: "The provider could not find or currently serve the selected model.",
      recovery: "Choose another model, or check that the custom model ID and endpoint are correct.",
    };
  }
  if (SAFETY_ERROR_PATTERN.test(message)) {
    return {
      category: "safety", statusCode, retryAfterMs, automaticRetry: false,
      title: "Provider declined the request",
      description: "The model provider stopped this response because of its content or safety policy.",
      recovery: "Rephrase the request with the legitimate goal and necessary context. Repeated automatic retries will return the same result.",
    };
  }
  if (statusCode === 403 || /\b(forbidden|permission denied|not authorized)\b/i.test(message)) {
    return {
      category: "permission", statusCode, retryAfterMs, automaticRetry: false,
      title: "Model access is not allowed",
      description: "The credentials are valid, but they do not have access to this model or operation.",
      recovery: "Choose a model available to this account, or update the provider account permissions.",
    };
  }
  if (RATE_LIMIT_ERROR_PATTERN.test(message) || statusCode === 429) {
    return {
      category: "rate-limit", statusCode, retryAfterMs, automaticRetry: true,
      title: "Provider is rate limiting requests",
      description: "Too many requests or tokens reached the provider at once. This is usually temporary.",
      recovery: rateLimitRecovery(retryAfterMs),
    };
  }
  if (TIMEOUT_ERROR_PATTERN.test(message) || statusCode === 408 || statusCode === 504) {
    return {
      category: "timeout", statusCode, retryAfterMs, automaticRetry: true,
      title: "The model took too long to respond",
      description: "The request timed out before a complete response arrived.",
      recovery: "Keating retries timeouts automatically before showing this message. You can retry again or choose another model.",
    };
  }
  if (NETWORK_ERROR_PATTERN.test(message) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return {
      category: "network", statusCode, retryAfterMs, automaticRetry: true,
      title: "Could not reach the model provider",
      description: "The browser lost its connection or could not reach the provider endpoint.",
      recovery: "Check your connection, VPN, proxy, or local model server. Keating will retry short network interruptions automatically.",
    };
  }
  if (SERVER_ERROR_PATTERN.test(message) || (statusCode !== null && (statusCode >= 500 || statusCode === 409 || statusCode === 425))) {
    return {
      category: "server", statusCode, retryAfterMs, automaticRetry: true,
      title: "Model provider is temporarily unavailable",
      description: "The provider or an upstream gateway could not complete the request.",
      recovery: "Keating retries temporary provider failures automatically. If the outage continues, choose another model.",
    };
  }
  if (statusCode === 400 || statusCode === 422 || /\b(bad request|invalid argument|invalid request|unprocessable)\b/i.test(message)) {
    return {
      category: "invalid-request", statusCode, retryAfterMs, automaticRetry: false,
      title: "Provider could not process the request",
      description: "The selected model rejected the request shape, an attachment, or a tool definition.",
      recovery: "Remove the newest attachment or tool-dependent step, or choose another model. Automatic retries would send the same invalid request.",
    };
  }

  return {
    category: "unknown", statusCode, retryAfterMs,
    automaticRetry: statusCode !== null && RETRYABLE_STATUS_CODES.has(statusCode),
    title: "Request failed",
    description: "Keating received an error it could not safely classify.",
    recovery: "Retry once. If it fails again, show raw errors in settings and use the details to check the provider, model, tool, or endpoint.",
  };
}

export function retryDelayMs(attemptIndex: number, error: unknown, policy: ApiRetryPolicy): number {
  const retryAfter = retryAfterDelayMs(error);
  const exponential = policy.initialDelayMs * 2 ** attemptIndex;
  const base = retryAfter ?? exponential;
  const capped = policy.maxDelayMs === 0 ? base : Math.min(base, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio * Math.random();
  return Math.round(capped + jitter);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForApiTurn(policy: ApiRetryPolicy): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextStartAt - now);
  nextStartAt = Math.max(now, nextStartAt) + policy.rateLimitIntervalMs;
  await sleep(waitMs);
}

export async function withApiRetry<T>(
  operation: () => Promise<T> | T,
  policy: ApiRetryPolicy = DEFAULT_API_RETRY_POLICY,
): Promise<T> {
  const attempts = Math.max(1, Math.round(policy.maxAttempts));
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await waitForApiTurn(policy);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !isRetryableApiError(error)) throw error;
      await sleep(retryDelayMs(attempt, error, policy));
    }
  }

  throw lastError;
}
