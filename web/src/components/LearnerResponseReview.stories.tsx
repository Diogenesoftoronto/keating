import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import {
	createOpenUIActionLearnerResponse,
	createQuestionLearnerResponse,
} from "../keating/learner-response";
import { LearnerResponseReview } from "./LearnerResponseReview";

const frameClass = css({ width: "min(44rem, calc(100vw - 2rem))", paddingBlock: "1rem" });

const meta = {
	title: "Conversation/LearnerResponseReview",
	component: LearnerResponseReview,
	parameters: { layout: "centered" },
	decorators: [(Story) => <div className={frameClass}><Story /></div>],
} satisfies Meta<typeof LearnerResponseReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenUIQuestionResponse: Story = {
	args: {
		response: createQuestionLearnerResponse({
			topic: "DNS caching",
			source: "openui",
			answers: [{
				header: "Reasoning",
				question: "Why can a cached answer be fast and still become stale?",
				answer: "The resolver can reuse it immediately, but the source may change before the TTL reaches zero.",
				grading: "pending",
			}],
		}, { id: "storybook-question-response", submittedAt: "2026-08-25T14:00:00.000Z" }),
	},
};

export const OpenUIQuestionGroupResponse: Story = {
	args: {
		response: createQuestionLearnerResponse({
			topic: "Study strategy",
			source: "openui",
			answers: [
				{
					header: "Current habit",
					question: "What do you do after a missed recall?",
					answer: "I reconstruct the answer without notes, then schedule another attempt two days later.",
					grading: "pending",
				},
				{
					header: "Evidence",
					question: "What would show that the change helped?",
					answer: "I can explain the idea accurately after a longer delay and with fewer prompts.",
					grading: "pending",
				},
			],
		}, { id: "storybook-question-group-response", submittedAt: "2026-08-25T14:05:00.000Z" }),
	},
};

export const QuizCompletion: Story = {
	args: {
		response: createOpenUIActionLearnerResponse({
			kind: "legacy",
			type: "continue_conversation",
			humanFriendlyMessage: "Quiz completed.",
			params: { interaction: "quiz", topic: "DNS caching", score: 4, total: 5, flagged: ["ttl-transfer"] },
			formState: {},
			document: { id: "storybook-quiz", lifecycle: "resumable", revision: 0 },
		}, { id: "storybook-quiz-response", submittedAt: "2026-08-25T14:10:00.000Z" }),
	},
};

export const FlashcardCompletion: Story = {
	args: {
		response: createOpenUIActionLearnerResponse({
			kind: "legacy",
			type: "continue_conversation",
			humanFriendlyMessage: "Flashcard review completed.",
			params: { interaction: "flashcards", reviewed: 12, lapses: 3 },
			formState: {},
			document: { id: "storybook-flashcards", lifecycle: "resumable", revision: 0 },
		}, { id: "storybook-flashcard-response", submittedAt: "2026-08-25T14:15:00.000Z" }),
	},
};
