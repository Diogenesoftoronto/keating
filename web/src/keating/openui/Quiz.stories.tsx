import type { Meta, StoryObj } from "@storybook/react-vite";
import type { QuizQuestionGrade } from "../core";
import type { UiActionReceipt, UiDocument, UiDocumentNode } from "@keating/learner-contracts";
import { expect, userEvent, within } from "storybook/test";
import { css } from "../../../styled-system/css";
import { QuizGradesContext } from "../../components/quiz-grades-context";
import { SharedUiDocumentRenderer } from "./shared-renderer";

const frameClass = css({ width: "min(48rem, calc(100vw - 2rem))", paddingBlock: "1rem" });

const quiz: Extract<UiDocumentNode, { type: "quiz" }> = {
	type: "quiz",
	id: "cache-check",
	title: "Cache check",
	questions: [
		{ id: "mechanism", header: "Mechanism", kind: "multiple_choice", prompt: "Why can a repeated DNS lookup be faster?", choices: [{ id: "reuse", label: "A cached record is reused until its TTL expires" }, { id: "skip", label: "The second request skips DNS entirely" }], correctAnswer: "reuse", explanation: "The resolver reuses an unexpired record." },
		{ id: "ttl", header: "TTL tradeoff", kind: "true_false", prompt: "A short TTL always improves correctness.", choices: [{ id: "true", label: "True" }, { id: "false", label: "False" }], correctAnswer: "false", explanation: "It trades query volume for staleness bounds." },
		{ id: "cloze", header: "Fill in the middle", kind: "fill_in", prompt: "A resolver keeps an answer for ___ seconds, after which the record is ___ and must be fetched again.", blanks: [{ placeholder: "duration", hint: "the field that bounds reuse" }, { placeholder: "state", hint: "what the record becomes" }], correctAnswers: ["TTL", "stale"], explanation: "The TTL bounds reuse; past it the record is stale." },
		{ id: "records", header: "Record types", kind: "multi_select", prompt: "Which records map a name to an address?", choices: [{ id: "a", label: "A" }, { id: "aaaa", label: "AAAA" }, { id: "ns", label: "NS" }], correctAnswers: ["a", "aaaa"], explanation: "NS delegates; A and AAAA address." },
		{ id: "staleness", header: "Explain staleness", kind: "short_answer", prompt: "Explain how a valid cache hit can still be wrong.", correctAnswer: "The source changed before the TTL expired.", explanation: "Validity is about the TTL, not about the truth at the source." },
		{ id: "transfer", header: "Transfer", kind: "transfer", prompt: "Where else does this same staleness bound appear in systems you use?", correctAnswer: "Any read-through cache with a fixed expiry.", explanation: "The structure transfers to any TTL-bounded cache." },
		{ id: "referral", header: "Referral traffic", kind: "multiple_choice", prompt: "During a warm cache hit, which packets disappear?", choices: [{ id: "upstream", label: "The upstream referral chain" }, { id: "client", label: "The client's own query" }], correctAnswer: "upstream", explanation: "The client still asks; the resolver just answers locally." },
	],
};

/** Short limits so the countdown, the warning colour, and auto-advance are all watchable. */
const timedQuiz: Extract<UiDocumentNode, { type: "quiz" }> = {
	...quiz,
	id: "timed-check",
	title: "Timed cache check",
	questions: quiz.questions.slice(0, 3).map((question, index) => ({ ...question, timeLimit: index === 0 ? 15 : 8 })),
};

/** The two kinds that assign items to buckets, and so drag naturally. */
const dragQuiz: Extract<UiDocumentNode, { type: "quiz" }> = {
	type: "quiz",
	id: "drag-check",
	title: "Sort what you know",
	questions: [
		{
			id: "classify",
			header: "Classification",
			kind: "classification",
			prompt: "Put each record where it belongs.",
			items: ["A", "AAAA", "NS", "CNAME", "MX"],
			choices: [
				{ id: "address", label: "Maps a name to an address" },
				{ id: "delegation", label: "Delegates a zone" },
				{ id: "alias", label: "Points at another name" },
			],
			correctMatches: ["address", "address", "delegation", "alias", "alias"],
		},
		{
			id: "match",
			header: "Matching",
			kind: "matching",
			prompt: "Match each actor to what it holds.",
			items: ["Stub resolver", "Recursive resolver", "Authoritative server"],
			choices: [
				{ id: "cache", label: "A cache of recent answers" },
				{ id: "truth", label: "The zone's actual records" },
				{ id: "nothing", label: "No records of its own" },
			],
			uniqueMatches: true,
			correctMatches: ["nothing", "cache", "truth"],
		},
		{
			id: "sequence",
			header: "Ordering",
			kind: "ordering",
			prompt: "Put a cold lookup in the order it actually happens.",
			items: ["Stub resolver asks the recursive resolver", "Recursive resolver asks a root server", "Root refers it to the TLD server", "TLD refers it to the authoritative server", "Authoritative server returns the record"],
			correctAnswers: ["Stub resolver asks the recursive resolver", "Recursive resolver asks a root server", "Root refers it to the TLD server", "TLD refers it to the authoritative server", "Authoritative server returns the record"],
			explanation: "Each step narrows the delegation by one level.",
		},
		{
			id: "classify-reasons",
			header: "Classification with reasons",
			kind: "classification",
			prompt: "Sort these failures, and say how you would tell them apart.",
			items: ["NXDOMAIN", "SERVFAIL", "Stale answer"],
			choices: [
				{ id: "absent", label: "The name does not exist" },
				{ id: "broken", label: "The lookup itself failed" },
				{ id: "wrong", label: "The answer is valid but untrue" },
			],
			requireReasons: true,
			reasonLabel: "How would you tell?",
		},
	],
};

function documentOf(nodes: UiDocumentNode[]): UiDocument {
	return {
		schemaVersion: 1,
		id: "storybook-quiz",
		revision: 0,
		lifecycle: "ready",
		retention: "workspace",
		supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
		nodes,
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
}

const completion: UiActionReceipt = {
	schemaVersion: 1,
	action: {
		schemaVersion: 1,
		type: "complete-quiz",
		documentId: "storybook-quiz",
		documentRevision: 0,
		nodeId: "cache-check",
		resultId: "cache-check-result",
		answers: [
			{ questionId: "mechanism", answer: "reuse" },
			{ questionId: "ttl", answer: "true" },
			{ questionId: "cloze", answer: "TTL,stale" },
			{ questionId: "records", answer: "a,aaaa" },
			{ questionId: "staleness", answer: "The record was cached before the source changed, so it is still within its TTL but no longer true." },
			{ questionId: "transfer", answer: "Browser HTTP caches with a max-age." },
			{ questionId: "referral", answer: "upstream" },
		],
		score: 4,
		partialCreditPoints: 4,
		partialCredits: { mechanism: 1, ttl: 0, cloze: 1, records: 1, referral: 1 },
		timing: { totalMs: 184_000, perQuestionMs: { mechanism: 21_000, ttl: 45_000, cloze: 33_000, records: 18_000, staleness: 41_000, transfer: 22_000, referral: 4_000 } },
		flaggedQuestionIds: ["ttl"],
		pendingGradeQuestionIds: ["staleness", "transfer"],
		skippedQuestionIds: [],
		timedOutQuestionIds: ["ttl"],
		idempotencyKey: "storybook-complete",
	},
	actionFingerprint: "storybook-fingerprint",
	state: "completed",
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-09-01T00:00:00.000Z",
};

function StoryFrame({ receipts, grades, timed, drag }: { receipts?: UiActionReceipt[]; grades?: Record<string, QuizQuestionGrade[]>; timed?: boolean; drag?: boolean }) {
	return <QuizGradesContext.Provider value={{ grades: grades ?? {}, applyGrades: () => {} }}>
		<div className={frameClass}>
			<SharedUiDocumentRenderer document={documentOf([drag ? dragQuiz : timed ? timedQuiz : quiz])} receipts={receipts ?? []} onAction={() => true} />
		</div>
	</QuizGradesContext.Provider>;
}

const meta = {
	title: "Learning/Quiz",
	component: StoryFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StoryFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The stepper. One question at a time, with Back, Skip, Flag for review, and
 * Next; arrow keys move between questions without stealing them from inputs.
 * Walk to the end to reach the review step.
 */
export const Stepper: Story = { args: {} };

/**
 * Question 2 is the cloze: the inputs sit inside the sentence where the gaps
 * are, not stacked underneath it. Enter jumps to the next blank.
 */
export const FillInTheMiddle: Story = {
	args: {},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(canvas.findByLabelText(/the field that bounds reuse/i)).resolves.toBeTruthy();
	},
};

/**
 * 15 seconds on the first question, 8 on the rest. The countdown turns red at
 * five seconds and auto-advances at zero — advancing, never submitting, so one
 * slow question cannot cost the learner the rest of the quiz. The elapsed clock
 * runs alongside it, and both land in `timing` on the submission.
 */
export const Timed: Story = { args: { timed: true } };

/**
 * Drag an item from the bank into a bucket, or between buckets. Every chip also
 * carries a labelled select — that is the interaction of record, since pointer
 * dragging is unusable by keyboard and awkward on touch; the drag is the
 * shortcut on top of it.
 *
 * Question 2 is one-to-one: dropping an item on an occupied bucket evicts what
 * was there rather than letting the same choice sit in two places. Question 3
 * is an ordering — drag the rows, or move them with the per-row arrows, which
 * is the path that works by keyboard. Question 4 asks for a reason, which
 * appears on a chip only once it has been placed.
 */
export const DragAndDrop: Story = { args: { drag: true } };

/**
 * Submitted, with the teacher's verdicts not yet in. The two open-ended answers
 * sit at "grading…" and are excluded from the score rather than counted wrong.
 */
export const AwaitingGrading: Story = {
	args: { receipts: [completion] },
};

/**
 * The same card after `grade_quiz` lands. The pending rows resolve in place,
 * partial credit lands at half a point, and the teacher's notes appear below.
 */
export const Graded: Story = {
	args: {
		receipts: [completion],
		grades: {
			"cache-check-result": [
				{ questionId: "staleness", verdict: "correct", note: "Exactly right — you separated validity from truth." },
				{ questionId: "transfer", verdict: "partial", note: "Right family, but max-age is the TTL. What is the prior here?" },
			],
		},
	},
};
