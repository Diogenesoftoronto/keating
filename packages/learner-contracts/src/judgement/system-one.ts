/**
 * The hosted judgement backend (Jev), built on an injected fetch.
 *
 * Injecting fetch keeps this file dependency-free and testable offline, and it
 * is also what lets the same code sit behind a gateway on the web (where a key
 * must never reach the bundle) and behind a direct key on desktop or CLI.
 */
import {
  type JudgementCaller,
  type JudgementError,
  type JudgementOutcome,
  type JudgementRequest,
  judgementRequestProblem,
} from "./contracts.js";
import {
  DEFAULT_SYSTEM_ONE_MODEL,
  SYSTEM_ONE_ENDPOINT,
  decodeSystemOneResponse,
  encodeSystemOneRequest,
  errorForStatus,
} from "./wire.js";

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface SystemOneRetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_SYSTEM_ONE_RETRY: SystemOneRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
};

export interface SystemOneCallerOptions {
  readonly fetch: FetchLike;
  /**
   * Direct credential. Must stay server-side: on the hosted web app this is
   * left undefined and `endpoint` points at a gateway that holds the key.
   */
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
  /** Gateway alias sent on the wire; model remains the expected scorer identity. */
  readonly requestModel?: string;
  /** Require a concrete returned model for experiment and calibration provenance. */
  readonly requireResolvedModel?: boolean;
  /**
   * Pin of the calibration this deployment was fitted with. Left null the
   * backend is uncalibrated, and the router will abstain rather than apply
   * thresholds that were never fitted for it.
   */
  readonly calibrationSha256?: string | null;
  readonly retry?: SystemOneRetryPolicy;
  /** Injected so retry backoff is instant under test. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function backoffDelay(attempt: number, policy: SystemOneRetryPolicy): number {
  const exponential = policy.initialDelayMs * 2 ** attempt;
  return Math.min(policy.maxDelayMs, exponential);
}

function failure(error: JudgementError): JudgementOutcome {
  return { ok: false, error };
}

/**
 * Build a `JudgementCaller` over the hosted API.
 *
 * Failures are returned rather than thrown, so a caller never has to wrap a
 * judgement in a try/catch to stay correct — an unavailable judge is an
 * ordinary abstention, not an exception.
 */
export function createSystemOneCaller(options: SystemOneCallerOptions): JudgementCaller {
  const endpoint = options.endpoint ?? SYSTEM_ONE_ENDPOINT;
  const model = options.model ?? DEFAULT_SYSTEM_ONE_MODEL;
  const retry = options.retry ?? DEFAULT_SYSTEM_ONE_RETRY;
  const sleep = options.sleep ?? defaultSleep;
  const calibrationSha256 = options.calibrationSha256 ?? null;

  return async function callSystemOne(
    request: JudgementRequest,
    signal?: AbortSignal,
  ): Promise<JudgementOutcome> {
    // Our own guardrails are checked before the wire, so an oversized batch
    // costs nothing and reports a code we authored rather than an upstream one.
    if (judgementRequestProblem(request) !== null) {
      return failure({ code: "request-invalid", retryable: false });
    }
    if (signal?.aborted) return failure({ code: "cancelled", retryable: false });

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    const body = JSON.stringify(encodeSystemOneRequest(request, options.requestModel ?? model));

    let lastError: JudgementError = { code: "backend-unavailable", retryable: true };
    for (let attempt = 0; attempt < Math.max(1, retry.maxAttempts); attempt += 1) {
      if (attempt > 0) {
        await sleep(backoffDelay(attempt - 1, retry));
        if (signal?.aborted) return failure({ code: "cancelled", retryable: false });
      }

      let response: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        response = await options.fetch(endpoint, { method: "POST", headers, body, signal });
      } catch {
        // Network-level failures carry no safe detail; treat as retryable and
        // never surface the thrown value, which can quote the request body.
        if (signal?.aborted) return failure({ code: "cancelled", retryable: false });
        lastError = { code: "backend-unavailable", retryable: true };
        continue;
      }

      if (!response.ok) {
        lastError = errorForStatus(response.status);
        if (!lastError.retryable) return failure(lastError);
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return failure({ code: "response-malformed", retryable: false });
      }

      const decoded = decodeSystemOneResponse(request, payload);
      if (decoded === null) return failure({ code: "response-malformed", retryable: false });
      const resolvedModel = decoded.model ?? model;
      if (options.requireResolvedModel && (!decoded.model || resolvedModel === "judgement"
        || resolvedModel.endsWith("-latest"))) {
        return failure({ code: "response-malformed", retryable: false });
      }
      return {
        ok: true,
        response: {
          answers: decoded.answers,
          backend: {
            backend: "system-one",
            model: resolvedModel,
            calibrationSha256: resolvedModel === model ? calibrationSha256 : null,
          },
          usage: decoded.usage,
        },
      };
    }
    return failure(lastError);
  };
}
