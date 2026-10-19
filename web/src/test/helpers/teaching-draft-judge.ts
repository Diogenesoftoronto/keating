/** Deterministic, test-owned outcomes for private teaching draft reviews. */
import type { JudgementAnswer, JudgementBackendKey, JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";

export const DRAFT_GATE_JUDGE: JudgementBackendKey = {
	backend: "fixture",
	model: "fixture-judge-v1",
	calibrationSha256: null,
};

export interface DraftGateJudgeOptions {
	violation?: number;
	noMatch?: boolean;
	standard?: "concise" | "supported";
}

export function answerDraftGateReview(request: JudgementRequest, options: DraftGateJudgeOptions = {}): JudgementOutcome {
	const state = request.state as { reply?: { text: string } };
	const answers: Record<string, JudgementAnswer> = {};
	for (const [id, question] of Object.entries(request.questions)) {
		if (question.type === "choice") {
			const choice = id === "draft_reasoning" ? "high"
				: id === "draft_standard" ? options.standard ?? "concise"
					: options.noMatch ? "no_match" : Object.keys(question.criteria).find(key => key !== "no_match")!;
			answers[id] = {
				type: "choice",
				choice,
				confidence: 1,
				probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])),
			};
		} else if (question.type === "noul") {
			const violation = options.violation ?? (state.reply?.text.includes("REJECTED") ? 1 : 0);
			answers[id] = {
				type: "noul",
				noul: id.startsWith("quality_") ? 1 : state.reply ? (id === "identity_invented" ? violation : 0)
					: ["direct_answer_requested", "learning_task"].includes(id) ? 1 : 0,
			};
		}
	}
	return { ok: true, response: { backend: DRAFT_GATE_JUDGE, answers, usage: { inputTokens: 10, outputTokens: 1 } } };
}
