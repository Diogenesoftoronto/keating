import { learningIntelligenceAccount, learningIntelligenceEnabled, requestAccountLearningExtraction, subscribeLearningIntelligence } from "./account";

import { MAX_RESPONSE_BYTES, validRequest, validateEnvelope, type ExtractionRequest, type ExtractionOutcome } from "../../../../packages/learner-contracts/src/learning-extraction-contract.js";
export type { ExtractionField, ExtractionRequest, ExtractionAnswer, ExtractionOutcome } from "../../../../packages/learner-contracts/src/learning-extraction-contract.js";

type Failure = Extract<ExtractionOutcome, { ok: false }>;
const fail = (error: Failure["error"]): Failure => ({ ok: false, error });

async function boundedBody(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw new Error("invalid-response");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid-response");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => {}); throw new Error("invalid-response"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { reader.releaseLock(); }
}

interface ProviderOptions {
  account?: typeof learningIntelligenceAccount;
  enabled?: typeof learningIntelligenceEnabled;
  request?: typeof requestAccountLearningExtraction;
  subscribe?: typeof subscribeLearningIntelligence;
  /** Tests may shorten the deadline; never permit a caller to increase the cap. */
  timeoutMs?: number;
}
/** Injectable transport for deterministic tests; production retains account-owned DPoP. */
export function createLearningExtractionProvider(options: ProviderOptions = {}) {
  const account = options.account ?? learningIntelligenceAccount, enabled = options.enabled ?? learningIntelligenceEnabled;
  const dispatch = options.request ?? requestAccountLearningExtraction;
  const subscribe = options.subscribe ?? subscribeLearningIntelligence;
  const timeoutMs = Math.min(8_000, Math.max(1, Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 8_000));
  return async (request: ExtractionRequest, scope: string, signal?: AbortSignal, current?: () => boolean): Promise<ExtractionOutcome> => {
    const guard = (): Failure | null => {
      if (signal?.aborted || current && !current()) return fail("cancelled");
      if (!enabled()) return fail("unavailable");
      const state = account();
      return !state.configured ? fail("unavailable") : !state.authorized || !scope || state.scope !== scope ? fail("unauthorized") : null;
    };
    const initial = guard();
    if (initial) return initial;
    if (!validRequest(request)) return fail("invalid-response");
    // Snapshot before awaiting refresh; caller mutation cannot alter verified spans.
    const payload: ExtractionRequest = JSON.parse(JSON.stringify(request));
    const controller = new AbortController();
    let finish!: (result: Failure) => void;
    const stopped = new Promise<Failure>(resolve => { finish = result => { controller.abort(); resolve(result); }; });
    const onAbort = () => finish(fail("cancelled"));
    const unsubscribe = subscribe(() => { const changed = guard(); if (changed) finish(changed); });
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => finish(fail("timeout")), timeoutMs);
    try {
      return await Promise.race([stopped, (async (): Promise<ExtractionOutcome> => {
        try {
          const before = guard(); if (before) return before;
          const response = await dispatch(JSON.stringify(payload), scope, controller.signal, () => !controller.signal.aborted && guard() === null);
          const after = guard(); if (after) return after;
          if (!response.ok) return fail(response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 402 ? "credit"
            : response.status === 429 ? "rate-limited" : response.status === 404 || response.status === 503 ? "unavailable" : "provider");
          let body: unknown;
          try { body = await boundedBody(response); } catch { return guard() ?? fail("invalid-response"); }
          return guard() ?? validateEnvelope(body, payload);
        } catch { return guard() ?? (controller.signal.aborted ? fail("cancelled") : fail("provider")); }
      })()]);
    } finally { clearTimeout(timer); unsubscribe(); signal?.removeEventListener("abort", onAbort); }
  };
}
export const requestLearningExtraction = createLearningExtractionProvider();
