/** A review proposal, never an automatic learner-state or tutor-policy mutation. */
import { turnAnalysisQuestions, type LearnerNeed, type ResponseFit, type TutorMove } from "./assessment.js";
import { questionDigest, type ChoiceAnswer, type JudgementResponse } from "./contracts.js";
import { decodeAnswer } from "./wire.js";
import { resolveThresholds, type CalibrationTable } from "./projections.js";

export type TeachingAdjustment = "give-room-to-reason" | "explain-next-step" | "clarify-the-goal";
export type TeachingAdjustmentProposal =
  | { status: "unavailable"; reason: "invalid-review" | "uncertain-review" | "no-adjustment" | "conflicting-review" }
  | {
    status: "review-required";
    adjustment: TeachingAdjustment;
    source: "proxy";
    calibration: "matched" | "uncalibrated" | "below-threshold";
    backend: JudgementResponse["backend"];
    questions: ReturnType<typeof turnAnalysisQuestions>;
    answers: { move: ChoiceAnswer; need: ChoiceAnswer; fit: ChoiceAnswer };
    summary: { move: TutorMove; need: LearnerNeed; fit: ResponseFit };
  };

/**
 * Compose a direction only from compatible review dimensions. Raw distributions
 * remain available to a person accepting or rejecting it. A threshold match does
 * not grant permission to send a message, change a grade, or persist a policy.
 */
export function proposeTeachingAdjustment(
  response: JudgementResponse,
  calibration: CalibrationTable = { entries: {} },
): TeachingAdjustmentProposal {
  const questions = turnAnalysisQuestions();
  const move = decodeAnswer(questions.move, response.answers.move);
  const need = decodeAnswer(questions.need, response.answers.need);
  const fit = decodeAnswer(questions.fit, response.answers.fit);
  const backend = response.backend;
  if (move?.type !== "choice" || need?.type !== "choice" || fit?.type !== "choice"
    || !backend || typeof backend.model !== "string" || !backend.model.trim() || /(?:latest|^judgement$|^auto$|^default$)/iu.test(backend.model)) {
    return { status: "unavailable", reason: "invalid-review" };
  }
  if ([move, need, fit].some(answer => answer.confidence === 0 || Object.values(answer.probabilities).filter(p => p === answer.probabilities[answer.choice]).length !== 1)) {
    return { status: "unavailable", reason: "uncertain-review" };
  }
  if (need.choice === "unknown" || need.choice === "mixed" || fit.choice === "unknown" || move.choice === "other") {
    return { status: "unavailable", reason: "uncertain-review" };
  }
  if (fit.choice === "appropriate") return { status: "unavailable", reason: "no-adjustment" };
  let adjustment: TeachingAdjustment | undefined;
  if (fit.choice === "overhelp" && need.choice === "room_to_reason") adjustment = "give-room-to-reason";
  if (fit.choice === "underhelp" && need.choice === "explanation_needed") adjustment = "explain-next-step";
  if (fit.choice === "misdirected" && need.choice === "clarification_needed") adjustment = "clarify-the-goal";
  if (!adjustment) return { status: "unavailable", reason: "conflicting-review" };
  const answers = { move, need, fit };
  let status: "matched" | "uncalibrated" | "below-threshold" = "matched";
  for (const id of ["move", "need", "fit"] as const) {
    const thresholds = resolveThresholds(calibration, backend, questionDigest(questions[id]));
    if (!thresholds || !Number.isFinite(thresholds.actAtOrAbove) || !Number.isFinite(thresholds.deferBelow)
      || thresholds.deferBelow < 0 || thresholds.actAtOrAbove > 1 || thresholds.deferBelow > thresholds.actAtOrAbove) { status = "uncalibrated"; break; }
    if (answers[id].confidence < thresholds.actAtOrAbove) status = "below-threshold";
  }
  return structuredClone({ status: "review-required", adjustment, source: "proxy", calibration: status,
    backend, questions, answers, summary: { move: move.choice as TutorMove, need: need.choice as LearnerNeed, fit: fit.choice as ResponseFit } });
}

/** Code-owned direction for the teacher model, not learner-facing canned prose. */
export function teachingAdjustmentInstruction(adjustment: TeachingAdjustment): string {
  switch (adjustment) {
    case "give-room-to-reason": return "Give the learner room to reason. Offer one focused question or minimal hint, then let them attempt the next step; do not reveal the full solution.";
    case "explain-next-step": return "Explain the next necessary step clearly and directly, grounded in the learner's question and work. Do not withhold the explanation they need; check their understanding afterward.";
    case "clarify-the-goal": return "Clarify what the learner is asking or where their reasoning diverged before choosing a new explanation. Ask one focused clarification rather than continuing an unrelated approach.";
  }
}
