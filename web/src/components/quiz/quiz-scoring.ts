/**
 * Pure quiz scoring: per-question partial credit, correctness, open-ended
 * detection, and the aggregate score/partial-credit/answered summary.
 */
import { levenshtein } from "@keating/learner-contracts";
import type { QuizQuestion } from "../../keating/core";

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, "")
		.split(/\s+/)
		.filter(Boolean);
}

function ngrams(tokens: string[], n: number): string[] {
	if (tokens.length < n) return [];
	const grams: string[] = [];
	for (let i = 0; i <= tokens.length - n; i++) {
		grams.push(tokens.slice(i, i + n).join(" "));
	}
	return grams;
}

// Fraction of the reference's n-grams that appear in the answer. Bigrams reward
// phrasing/word-order overlap, which single-token overlap misses.
function ngramRecall(answerTokens: string[], referenceTokens: string[], n: number): number {
	const reference = ngrams(referenceTokens, n);
	if (reference.length === 0) return 0;
	const answer = new Set(ngrams(answerTokens, n));
	const matched = reference.filter((g) => answer.has(g)).length;
	return matched / reference.length;
}

export function questionCredit(q: QuizQuestion, rawAnswer: string): number {
	if (!rawAnswer.trim()) return 0;
	if (q.type === "slider") {
		const ans = parseFloat(rawAnswer);
		const correct = parseFloat(q.correctAnswer);
		if (Number.isNaN(ans) || Number.isNaN(correct)) return 0;
		const range = (q.max ?? 100) - (q.min ?? 0);
		const tolerance = Math.max((q.step ?? 1) / 2, range * 0.05);
		const diff = Math.abs(ans - correct);
		return diff <= tolerance ? 1 : Math.max(0, 1 - diff / (range || 1));
	}
	if (q.type === "multi_select" && q.correctAnswers) {
		const selected = rawAnswer.split(",").map((s) => s.trim()).filter(Boolean);
		const correctSet = new Set(q.correctAnswers);
		let selectedCorrect = 0;
		let selectedWrong = 0;
		for (const s of selected) {
			if (correctSet.has(s)) selectedCorrect++;
			else selectedWrong++;
		}
		const score = selectedCorrect / correctSet.size - selectedWrong / (q.options?.length || 1);
		return Math.max(0, score);
	}
	if (q.type === "fill_in" && q.blanks && q.blanks.length > 0) {
		// Multi-blank fill_in: answers are pipe-separated, correctAnswers array expected
		const userAnswers = rawAnswer.split("|").map((s) => s.trim());
		const correctAnswers = q.correctAnswers ?? [q.correctAnswer];
		let correct = 0;
		for (let i = 0; i < Math.min(userAnswers.length, correctAnswers.length); i++) {
			if (userAnswers[i].toLowerCase() === correctAnswers[i].trim().toLowerCase()) correct++;
		}
		return correct / correctAnswers.length;
	}
	if (q.type === "true_false" || q.type === "multiple_choice" || q.type === "dropdown") {
		return rawAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase() ? 1 : 0;
	}
	// Open-ended: partial credit via Levenshtein + keyword/n-gram overlap. There's
	// no single correct string here, so we take the most generous of several
	// signals; the model gives the authoritative judgment in chat.
	const a = rawAnswer.trim().toLowerCase();
	const c = q.correctAnswer.trim().toLowerCase();
	if (a === c) return 1;
	const dist = levenshtein(a, c);
	const len = Math.max(a.length, c.length);
	const editScore = Math.max(0, 1 - dist / (len || 1));
	const aTokens = tokenize(a);
	const cTokens = tokenize(c);
	const aTokenSet = new Set(aTokens);
	const overlap = cTokens.filter((t) => aTokenSet.has(t)).length;
	const keywordScore = cTokens.length ? overlap / cTokens.length : 0;
	// Phrase overlap: matching consecutive word pairs is a stronger signal that
	// the learner expressed the same idea, not just reused isolated words.
	const bigramScore = ngramRecall(aTokens, cTokens, 2);
	return Math.max(editScore, keywordScore * 0.9, bigramScore);
}

// Open-ended answers can't be graded by string equality — there's no single
// "correct" string. The model does the authoritative grading in chat; locally
// we accept anything close enough on the partial-credit heuristic so the
// displayed score isn't misleadingly strict.
const OPEN_ENDED_CREDIT_THRESHOLD = 0.6;
export function isOpenEnded(q: QuizQuestion): boolean {
	if (q.type === "short_answer" || q.type === "transfer") return true;
	// Single-blank fill_in is free text; multi-blank fill_in is graded per blank.
	if (q.type === "fill_in" && !(q.blanks && q.blanks.length > 0)) return true;
	return false;
}

export function isCorrect(q: QuizQuestion, rawAnswer: string): boolean {
	if (q.type === "multi_select" && q.correctAnswers) {
		const selected = new Set(rawAnswer.split(",").map((s) => s.trim()).filter(Boolean));
		return (
			q.correctAnswers.length === selected.size &&
			q.correctAnswers.every((c) => selected.has(c))
		);
	}
	if (q.type === "fill_in" && q.blanks && q.blanks.length > 0) {
		const userAnswers = rawAnswer.split("|").map((s) => s.trim());
		const correctAnswers = q.correctAnswers ?? [q.correctAnswer];
		if (userAnswers.length !== correctAnswers.length) return false;
		return userAnswers.every((a, i) => a.toLowerCase() === correctAnswers[i].trim().toLowerCase());
	}
	if (isOpenEnded(q)) {
		return questionCredit(q, rawAnswer) >= OPEN_ENDED_CREDIT_THRESHOLD;
	}
	return rawAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
}


export interface QuizScoreSummary {
	/** Credit in [0, 1] per scorable (non-open-ended) question id. */
	partialCredits: Record<string, number>;
	/** Number of scorable questions answered correctly. */
	rawScore: number;
	/** Sum of partial credits; within [0, scorable.length]. */
	partialCreditPoints: number;
	/** Rounded objective percentage; 0 when nothing is scorable. */
	percent: number;
}

/** Scores the scorable questions against the learner's answers. */
export function summarizeQuizScores(
	scorable: QuizQuestion[],
	answers: Record<string, string>,
): QuizScoreSummary {
	const partialCredits: Record<string, number> = {};
	let rawScore = 0;
	let partialCreditPoints = 0;
	for (const question of scorable) {
		const answer = answers[question.id] || "";
		const credit = questionCredit(question, answer);
		partialCredits[question.id] = credit;
		partialCreditPoints += credit;
		if (isCorrect(question, answer)) rawScore++;
	}
	const percent = scorable.length > 0 ? Math.round((rawScore / scorable.length) * 100) : 0;
	return { partialCredits, rawScore, partialCreditPoints, percent };
}

/** How many of the questions have a non-blank answer. */
export function countAnswered(questions: QuizQuestion[], answers: Record<string, string>): number {
	return questions.filter((question) => (answers[question.id] || "").trim().length > 0).length;
}

/** Headline and detail text for the completion mark. */
export function completionSummary(input: {
	totalScored: number;
	rawScore: number;
	pendingReviewCount: number;
}): { title: string; detail: string } {
	const { totalScored, rawScore, pendingReviewCount } = input;
	return {
		title: totalScored === 0 ? "Ready for review" : rawScore === totalScored ? "Clean sweep" : "Round complete",
		detail: totalScored > 0
			? `${rawScore} of ${totalScored} correct${pendingReviewCount ? ` · ${pendingReviewCount} awaiting review` : ""}`
			: "Your teacher will review your answers.",
	};
}
