import type { JudgementBackendKey, JudgementCaller, JudgementErrorCode, JudgementOutcome, JudgementResponse } from "@keating/learner-contracts";
import type { WebJudgementRuntime } from "./runtime";
import { beginJudgementDiagnostic, finishJudgementDiagnostic, markDiagnosticOperation, unmarkDiagnosticOperation, noteJudgementDispatch, noteJudgementReason, noteJudgementAnswer, type JudgementDiagnosticContext } from "./diagnostics";

const alias = (model: string) => !model.trim() || model === "judgement" || model.endsWith("-latest");
const same = (a: JudgementBackendKey, b: JudgementBackendKey) => a.backend === b.backend
  && a.model === b.model && a.calibrationSha256 === b.calibrationSha256;
const failure = (code: JudgementErrorCode): JudgementOutcome => ({ ok: false, error: { code, retryable: false } });

/** Explicit human review only. Uncalibrated answers remain estimates, never router decisions.
 * Each operation snapshots privacy settings and pins every tier to its first concrete identity.
 */
export function createJudgementOperationCaller(options: {
  runtime: WebJudgementRuntime;
  accept: (response: JudgementResponse) => boolean;
  timeoutMs?: number;
  diagnostics?: JudgementDiagnosticContext;
}): JudgementCaller {
  const { settings, policy } = options.runtime;
  const tiers = settings.backend === "off" ? [] : policy.tiers.filter(tier =>
    (tier.key.backend === "local" || settings.backend === "hosted")
    && (!policy.pinnedBackend || same(tier.key, policy.pinnedBackend)));
  const pins = new Map<number, JudgementBackendKey>();
  return async (request, signal) => {
    const diagnostic = beginJudgementDiagnostic(request, options.diagnostics);
    if (signal?.aborted) { const result = failure("cancelled"); finishJudgementDiagnostic(diagnostic, result); return result; }
    markDiagnosticOperation(request);
    const controller = new AbortController();
    let stop!: () => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<JudgementOutcome>(resolve => {
      stop = () => { controller.abort(); resolve(failure("cancelled")); };
      signal?.addEventListener("abort", stop, { once: true });
      timer = setTimeout(() => { controller.abort(); resolve(failure("backend-timeout")); },
        Math.min(120_000, Math.max(1, options.timeoutMs ?? 30_000)));
    });
    try {
      const result = await Promise.race([interrupted, (async (): Promise<JudgementOutcome> => {
        let last = failure("backend-unavailable");
        if (!tiers.length) noteJudgementReason(diagnostic, settings.backend === "off" ? "Judgement is off; no model called." : "No backend matches the operation pin.");
        for (const [index, tier] of tiers.entries()) {
          if (controller.signal.aborted) return failure("cancelled");
          try {
            if (tier.isAvailable && !await tier.isAvailable()) { noteJudgementReason(diagnostic, `${tier.key.backend} unavailable; checking next permitted backend.`); continue; }
            if (controller.signal.aborted) return failure("cancelled");
            noteJudgementDispatch(diagnostic, tier.key, index === 0 ? "First permitted backend." : "Fallback permitted by independent judgement settings.");
            const outcome = await tier.call(request, controller.signal);
            if (controller.signal.aborted) return failure("cancelled");
            if (!outcome.ok) { noteJudgementReason(diagnostic, `${tier.key.backend}: ${outcome.error.code}`); last = outcome; continue; }
            const actual = outcome.response.backend;
            const pinned = pins.get(index);
            if (alias(actual.model) || actual.backend !== tier.key.backend
              || actual.calibrationSha256 !== tier.key.calibrationSha256
              || (!alias(tier.key.model) && actual.model !== tier.key.model)
              || (pinned && !same(actual, pinned))) return failure("response-malformed");
            pins.set(index, Object.freeze({ ...actual }));
            noteJudgementAnswer(diagnostic, outcome.response);
            if (options.accept(outcome.response)) return outcome;
            noteJudgementReason(diagnostic, "Caller declined the answer; checking next permitted backend.");
            last = failure("response-malformed");
          } catch { last = failure("backend-unavailable"); }
        }
        return last;
      })()]);
      finishJudgementDiagnostic(diagnostic, result, !result.ok && result.error.code !== "cancelled" && result.error.code !== "backend-timeout");
      return result;
    } finally {
      unmarkDiagnosticOperation(request);
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  };
}
