/**
 * Conversational profile intake.
 *
 * The form asks eight screens of questions; this asks four open ones and reads
 * the answers. Both are doors to the same `DeclaredLearnerProfile` — this one
 * is not a replacement, and the learner picks which to walk through.
 *
 * Nothing here writes. Extraction produces proposals, the review card decides,
 * and only then does anything reach the profile.
 */
import {
	ALL_EXTRACTABLE_PROFILE_FIELDS,
	extractProfileFields,
	profileProposalFrom,
	type ExtractableProfileField,
	type ProfileProposal,
	type ProfileProposalSource,
} from "@keating/learner-contracts";
import { createWebJudgementRuntime } from "./judgement/runtime";
import { createJudgementOperationCaller } from "./judgement/operation";

/** One open question and the fields its answer is expected to carry. */
export interface IntakePrompt {
	readonly id: string;
	readonly ask: string;
	/** Shown under the question as an example, never as a required shape. */
	readonly hint: string;
	/** Asked of this answer only, so an answer about pace is not mined for age. */
	readonly fields: readonly ExtractableProfileField[];
	/** Lifted verbatim rather than classified; free text is never put to a vote. */
	readonly verbatim?: "preferredName" | "goalText";
}

/**
 * Four questions, in the order a person would actually ask them. Each one is
 * answerable in a sentence and skippable, because an intake that must be
 * completed is just a form with a chat bubble around it.
 */
export const INTAKE_PROMPTS: readonly IntakePrompt[] = Object.freeze([
	Object.freeze({
		id: "name",
		ask: "What should I call you?",
		hint: "A first name or a nickname — whatever you would like to be called.",
		fields: Object.freeze([] as readonly ExtractableProfileField[]),
		verbatim: "preferredName",
	}),
	Object.freeze({
		id: "goal",
		ask: "What are you hoping to understand?",
		hint: "One subject is plenty. “Why enzymes speed reactions up” beats “chemistry”.",
		fields: Object.freeze(["motivation", "educationStage"] as readonly ExtractableProfileField[]),
		verbatim: "goalText",
	}),
	Object.freeze({
		id: "teaching",
		ask: "When something finally clicked for you, what made it click?",
		hint: "Being walked through it, being asked about it, seeing it drawn — whatever it was.",
		fields: Object.freeze(["socraticIntensity", "hintLevel", "depth"] as readonly ExtractableProfileField[]),
	}),
	Object.freeze({
		id: "tone",
		ask: "And how should I talk to you when you get something wrong?",
		hint: "Straight about it, gently, or somewhere in between.",
		fields: Object.freeze(["tone", "ageBand"] as readonly ExtractableProfileField[]),
	}),
] as readonly IntakePrompt[]);

/** The learner's answer to one prompt, before anything has been read out of it. */
export interface IntakeAnswer {
	readonly promptId: string;
	readonly text: string;
	readonly source: ProfileProposalSource;
}

const prompt = (id: string): IntakePrompt | undefined => INTAKE_PROMPTS.find(entry => entry.id === id);

/**
 * Free-text answers, lifted exactly as written.
 *
 * A blank answer yields nothing at all rather than `""`: unanswered and
 * declined are different facts, and only the learner may say "prefer not to
 * say". Silence must never be recorded as a refusal.
 */
export function verbatimIntakeFields(answers: readonly IntakeAnswer[]): { preferredName?: string; goalText?: string } {
	const lifted: { preferredName?: string; goalText?: string } = {};
	for (const answer of answers) {
		const key = prompt(answer.promptId)?.verbatim;
		const text = answer.text.trim();
		if (!key || !text) continue;
		lifted[key] = text;
	}
	return lifted;
}

export interface IntakeExtraction {
	readonly proposals: readonly ProfileProposal[];
	/** True when every field abstained, which is a result to report, not an error. */
	readonly abstainedEntirely: boolean;
}

/**
 * Read proposals out of the answers.
 *
 * An unavailable or uncalibrated backend abstains rather than throwing, so the
 * worst case is an intake that proposes nothing and a learner who fills the
 * form instead — never a thrown error part-way through onboarding.
 */
export async function extractIntakeProposals(
	answers: readonly IntakeAnswer[],
	options: { readonly call?: Parameters<typeof extractProfileFields>[2]; readonly signal?: AbortSignal } = {},
): Promise<IntakeExtraction> {
	const call = options.call ?? createJudgementOperationCaller({
		runtime: createWebJudgementRuntime(),
		// Onboarding never acts on an answer; it only offers it for review.
		accept: () => true,
	});
	const proposals: ProfileProposal[] = [];
	let asked = 0;
	for (const answer of answers) {
		const fields = prompt(answer.promptId)?.fields ?? ALL_EXTRACTABLE_PROFILE_FIELDS;
		if (fields.length === 0 || !answer.text.trim()) continue;
		asked += 1;
		const decisions = await extractProfileFields(answer.text, fields, call, { signal: options.signal });
		for (const decision of decisions) {
			const proposal = profileProposalFrom(decision, answer.source);
			// A field answered twice keeps the later answer, which is the one the
			// learner most recently stood behind.
			if (!proposal) continue;
			const existing = proposals.findIndex(entry => entry.field === proposal.field);
			if (existing >= 0) proposals.splice(existing, 1);
			proposals.push(proposal);
		}
	}
	return Object.freeze({ proposals: Object.freeze(proposals), abstainedEntirely: asked > 0 && proposals.length === 0 });
}
