import {
  DEFAULT_API_RETRY_POLICY,
  sanitizeApiRetryPolicy,
  type ApiRetryPolicy,
} from "../../shared/api-retry-policy.js";

export { DEFAULT_API_RETRY_POLICY, sanitizeApiRetryPolicy, type ApiRetryPolicy };

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

let nextStartAt = 0;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function retryableStatusCode(message: string): number | null {
  const matches = message.match(/\b(?:status|http|code|exit)?\s*[:=]?\s*(\d{3})\b/gi) ?? [];
  for (const match of matches) {
    const code = Number(match.match(/\d{3}/)?.[0]);
    if (RETRYABLE_STATUS_CODES.has(code) || NON_RETRYABLE_STATUS_CODES.has(code)) return code;
  }
  return null;
}

export function isRetryableApiError(error: unknown): boolean {
  const message = errorText(error);
  const normalized = message.toLowerCase();
  const status = retryableStatusCode(message);
  if (status !== null) return RETRYABLE_STATUS_CODES.has(status);

  if (/\b(api[_ -]?key|unauthorized|authentication|permission denied|forbidden|invalid argument|bad request)\b/i.test(message)) {
    return false;
  }

  return /\b(rate limit|rate_limit|too many requests|resource_exhausted|quota|throttl|overload|unavailable|timeout|timed out|econnreset|econnrefused|socket hang up|network error|temporarily unavailable|try again later)\b/i.test(normalized);
}

export function retryAfterDelayMs(error: unknown): number | null {
  const message = errorText(error);
  const retryAfter = message.match(/retry-after\s*[:=]\s*([^\n,;]+)/i);
  if (!retryAfter) return null;

  const value = retryAfter[1].trim();
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
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
