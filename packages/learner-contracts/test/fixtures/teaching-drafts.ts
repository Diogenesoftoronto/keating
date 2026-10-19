/** Deterministic, explicitly authored judge outcomes for draft-loop contract tests. */
import type { TeachingPolicyTurn } from "../../src/judgement/teaching-policy-types.js";
import type { JudgementAnswer, JudgementCaller, JudgementRequest } from "../../src/judgement/contracts.js";

export const teachingDraftTurn: TeachingPolicyTurn = {
  learnerMessage: "Explain division.", conversation: [], learnerEvidence: [], availableTools: [],
  toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general",
};

export function teachingDraftAnswers(
  request: JudgementRequest,
  override: Record<string, string | number> = {},
): Record<string, JudgementAnswer> {
  return Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === "choice") {
      const choice = typeof override[id] === "string" ? override[id] as string
        : id === "draft_standard" ? "concise"
          : id === "draft_reasoning" ? "low"
            : Object.keys(question.criteria)[0]!;
      return [id, { type: "choice", choice, confidence: 0.99,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === choice ? 1 : 0])) }];
    }
    return [id, { type: "noul", noul: typeof override[id] === "number" ? override[id]
      : id.startsWith("quality_") ? 0.99 : 0.01 }];
  }));
}

/** Tests choose each outcome explicitly; defaults model a fully positive review. */
export function makeTeachingDraftJudge(
  mutate: (request: JudgementRequest) => Record<string, string | number> = () => ({}),
): JudgementCaller {
  return async (request) => ({ ok: true, response: {
    answers: teachingDraftAnswers(request, mutate(request)),
    backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
    usage: { inputTokens: 10, outputTokens: 2 },
  } });
}
