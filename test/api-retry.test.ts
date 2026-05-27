import { expect, test } from "bun:test";

import {
  DEFAULT_API_RETRY_POLICY,
  isRetryableApiError,
  retryAfterDelayMs,
  retryDelayMs,
  sanitizeApiRetryPolicy,
} from "../src/core/api-retry.js";

test("ALWAYS: retry classifier accepts provider-agnostic transient failures", () => {
  expect(isRetryableApiError("HTTP 429: Too Many Requests")).toBe(true);
  expect(isRetryableApiError("Google API error: RESOURCE_EXHAUSTED quota exceeded")).toBe(true);
  expect(isRetryableApiError("Anthropic API error (503): overloaded")).toBe(true);
  expect(isRetryableApiError("OpenAI request failed: socket hang up")).toBe(true);
});

test("ALWAYS: retry classifier rejects auth and request-shape failures", () => {
  expect(isRetryableApiError("HTTP 401: invalid API key")).toBe(false);
  expect(isRetryableApiError("HTTP 403: permission denied")).toBe(false);
  expect(isRetryableApiError("HTTP 400: invalid argument")).toBe(false);
  expect(isRetryableApiError("HTTP 422: bad schema")).toBe(false);
});

test("ALWAYS: retry delay honors numeric Retry-After and caps long waits", () => {
  const policy = { ...DEFAULT_API_RETRY_POLICY, maxDelayMs: 5_000, jitterRatio: 0 };
  expect(retryAfterDelayMs("HTTP 429 retry-after: 2")).toBe(2_000);
  expect(retryDelayMs(0, "HTTP 429 retry-after: 20", policy)).toBe(5_000);
});

test("ALWAYS: retry policy sanitizer clamps unsafe values", () => {
  const policy = sanitizeApiRetryPolicy({
    maxAttempts: 100,
    initialDelayMs: -10,
    maxDelayMs: 999_999,
    rateLimitIntervalMs: -1,
    jitterRatio: 2,
  });

  expect(policy.maxAttempts).toBe(8);
  expect(policy.initialDelayMs).toBe(0);
  expect(policy.maxDelayMs).toBe(300_000);
  expect(policy.rateLimitIntervalMs).toBe(0);
  expect(policy.jitterRatio).toBe(1);
});
