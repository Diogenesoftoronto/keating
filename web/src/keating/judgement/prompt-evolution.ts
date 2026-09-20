import type { JudgementBackendKey, JudgementOutcome, JudgementRequest, JudgementTier } from "@keating/learner-contracts";
import { evaluatePromptRubric, projectPromptRubric, type PromptEvaluationReview } from "../../../../shared/pedagogy/prompt-judgement";
import { evaluatePrompt, type PromptEvaluationResult } from "../core";
import { createJudgementOperationCaller } from "./operation";
import { markDiagnosticOperation, unmarkDiagnosticOperation } from "./diagnostics";
import type { WebJudgementRuntime } from "./runtime";

const same = (a: JudgementBackendKey, b: JudgementBackendKey) => a.backend === b.backend
  && a.model === b.model && a.calibrationSha256 === b.calibrationSha256;

/** Baseline alone can choose fallback. All subsequent scores use the same concrete tier and rubric. */
export function createBrowserPromptEvolutionEvaluator(runtime: WebJudgementRuntime, signal: AbortSignal) {
  const settings = Object.freeze({ ...runtime.settings });
  const calibration = structuredClone(runtime.policy.calibration);
  const evaluations: Array<{ prompt: string; review: PromptEvaluationReview; scoring: PromptEvaluationResult;
    attempts: Array<{ tier: number; request: JudgementRequest; outcome: JudgementOutcome }> }> = [];
  let source: "heuristic" | "proxy" | null = null;
  let backend: JudgementBackendKey | null = null;
  let selected = -1;
  let currentPrompt = "";
  let attempts: typeof evaluations[number]["attempts"] = [];
  let questionDigests: Record<string, string> | null = null;
  let reason: "cancelled" | "judgement-abstained" | "identity-changed" | "rubric-changed" | null = null;
  const tiers: JudgementTier[] = runtime.policy.tiers.map((tier, index) => {
    const call = tier.call;
    const isAvailable = tier.isAvailable;
    return { key: Object.freeze({ ...tier.key }), isAvailable, call: async (request, abort) => {
      const target = attempts;
      const retainedRequest = structuredClone(request);
      const dispatchedRequest = structuredClone(request);
      let outcome: JudgementOutcome;
      markDiagnosticOperation(dispatchedRequest);
      try { outcome = await call(dispatchedRequest, abort); }
      catch { outcome = { ok: false, error: { code: "backend-unavailable", retryable: false } }; }
      finally { unmarkDiagnosticOperation(dispatchedRequest); }
      if (!abort?.aborted) target.push({ tier: index, request: retainedRequest, outcome: structuredClone(outcome) });
      if (outcome.ok && backend && !same(backend, outcome.response.backend)) reason = "identity-changed";
      return structuredClone(outcome);
    } };
  });
  const operation = (activeTiers: readonly JudgementTier[], pin?: JudgementBackendKey) => createJudgementOperationCaller({
    runtime: { settings, policy: { tiers: activeTiers, calibration, ...(pin ? { pinnedBackend: pin } : {}) } },
    accept: response => projectPromptRubric(currentPrompt, response) !== null,
    diagnostics: { origin: "prompt-evolution", application: "Proposal comparison only; source prompt unchanged" },
  });
  let caller = operation(tiers, runtime.policy.pinnedBackend ? { ...runtime.policy.pinnedBackend } : undefined);
  return {
    evaluate: async (prompt: string): Promise<PromptEvaluationResult> => {
      signal.throwIfAborted();
      currentPrompt = prompt;
      attempts = [];
      const review = await evaluatePromptRubric(prompt, source === "heuristic" || settings.backend === "off" ? null : caller, signal);
      const scoring = review.source === "proxy" ? { score: review.score, objectives: review.objectives, feedback: review.feedback } : evaluatePrompt(prompt);
      evaluations.push(structuredClone({ prompt, review, scoring, attempts }));
      if (signal.aborted || review.judgement.reason === "cancelled") { reason = "cancelled"; throw new Error("prompt_evolution_cancelled"); }
      if (source === null) {
        source = review.source;
        if (source === "proxy") {
          backend = Object.freeze({ ...review.judgement.backend! });
          selected = [...attempts].reverse().find(attempt => attempt.outcome.ok && same(backend!, attempt.outcome.response.backend)
            && projectPromptRubric(prompt, attempt.outcome.response) !== null)?.tier ?? -1;
          if (selected < 0) { reason = "judgement-abstained"; throw new Error("prompt_evolution_judgement_abstained"); }
          // Selection questions necessarily change with exact prompt spans. Pin the six score definitions;
          // retain every selection question/digest with each raw request instead of pretending it is unchanged.
          questionDigests = Object.fromEntries(Object.entries(review.judgement.questionDigests).filter(([key]) => key.startsWith("score:")));
          caller = operation([{ ...tiers[selected]!, key: backend }], backend);
        }
      } else if (source === "proxy") {
        if (review.source !== "proxy" || !review.judgement.backend) reason ??= "judgement-abstained";
        else if (!same(backend!, review.judgement.backend)) reason = "identity-changed";
        else if (Object.entries(questionDigests!).some(([key, digest]) => review.judgement.questionDigests[key] !== digest)) reason = "rubric-changed";
        if (reason) throw new Error(`prompt_evolution_${reason}`);
      }
      return structuredClone(scoring);
    },
    receipt: () => structuredClone({ schemaVersion: 1, operation: "prompt_evolution", source, backend,
      scorer: source === "proxy" ? "prompt-rubric-v1" : "browser-keyword-baseline-v1", questionDigests,
      calibration: "uncalibrated", humanLearning: "unmeasured", aborted: signal.aborted || reason !== null,
      reason: signal.aborted ? "cancelled" : reason, evaluations }),
  };
}
