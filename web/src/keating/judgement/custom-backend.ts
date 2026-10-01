/** User-supplied TypeSafe credentials are relayed transiently through our server. */
import {
  createSystemOneCaller, judgementRequestProblem,
  type JudgementOutcome, type JudgementTier,
} from "@keating/learner-contracts";

export const CUSTOM_JUDGEMENT_ENDPOINT = "/api/judgement/typesafe";

export interface CustomJudgementBackendOptions {
  readonly model: string;
  readonly apiKey: string;
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

const failed = (code: "backend-unavailable" | "request-invalid" | "cancelled" | "backend-timeout"): JudgementOutcome =>
  ({ ok: false, error: { code, retryable: code === "backend-unavailable" } });

/** Model and key are copied once; settings changes cannot redirect an active call. */
export function createCustomJudgementBackend(options: CustomJudgementBackendOptions): JudgementTier | null {
  const model = options.model.trim();
  const apiKey = options.apiKey.trim();
  if (!model || model.length > 200 || /[\r\n]/u.test(model) || !apiKey || /[\r\n]/u.test(apiKey)) return null;
  const fetchRequest = options.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init));
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? options.timeoutMs! : 30_000;
  const key = Object.freeze({ backend: "system-one" as const, model, calibrationSha256: null });
  const systemOne = createSystemOneCaller({ endpoint: CUSTOM_JUDGEMENT_ENDPOINT, model, apiKey,
    requireResolvedModel: true, calibrationSha256: null,
    retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    fetch: (url, init) => fetchRequest(url, { ...init, redirect: "error", credentials: "omit" }),
  });
  return {
    key, isAvailable: () => true,
    call: async (request, signal) => {
      try { if (judgementRequestProblem(request) !== null) return failed("request-invalid"); }
      catch { return failed("request-invalid"); }
      if (signal?.aborted) return failed("cancelled");
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel = () => {};
      const stopped = new Promise<JudgementOutcome>((resolve) => {
        cancel = () => { controller.abort(); resolve(failed("cancelled")); };
        signal?.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => { controller.abort(); resolve(failed("backend-timeout")); }, timeoutMs);
      });
      try {
        return await Promise.race([
          systemOne(request, controller.signal).catch(() => failed("backend-unavailable")), stopped,
        ]);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}
