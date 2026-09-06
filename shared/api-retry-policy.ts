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
  jitterRatio: 0.2,
};

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
    jitterRatio: fromNumber("jitterRatio", DEFAULT_API_RETRY_POLICY.jitterRatio, 0, 1),
  };
}
