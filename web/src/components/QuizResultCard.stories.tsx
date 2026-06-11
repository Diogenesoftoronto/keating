import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { QuizResultCard } from "./QuizResultCard";
import type { Quiz } from "../keating/core";
import type { QuizResult } from "./QuizRenderer";
import type { StoredQuizResult } from "./QuizResultCard";

const baseQuiz: Quiz = {
	topic: "Photosynthesis",
	slug: "photosynthesis",
	generatedAt: new Date().toISOString(),
	totalPoints: 4,
	questions: [
		{
			id: "q1",
			type: "multiple_choice",
			level: "recall",
			question: "Where do the light-dependent reactions of photosynthesis occur?",
			options: ["Stroma", "Thylakoid membrane", "Cytoplasm", "Mitochondrial matrix"],
			correctAnswer: "Thylakoid membrane",
			explanation: "The thylakoid membrane contains chlorophyll and is where light energy is converted into chemical energy.",
		},
		{
			id: "q2",
			type: "true_false",
			level: "comprehension",
			question: "The Calvin cycle requires light directly to function.",
			correctAnswer: "False",
			explanation: "The Calvin cycle is light-independent; it uses ATP and NADPH produced by the light reactions.",
		},
		{
			id: "q3",
			type: "fill_in",
			level: "application",
			question: "The pigment primarily responsible for capturing light energy is ________.",
			correctAnswer: "chlorophyll",
			explanation: "Chlorophyll absorbs red and blue light most efficiently.",
		},
		{
			id: "q4",
			type: "multiple_choice",
			level: "analysis",
			question: "Which gas is released as a byproduct of photosynthesis?",
			options: ["Carbon dioxide", "Oxygen", "Nitrogen", "Methane"],
			correctAnswer: "Oxygen",
			explanation: "Oxygen is released when water is split during the light-dependent reactions.",
		},
	],
	review: {
		status: "passed",
		issues: [],
		duplicatesRemoved: 0,
		maxQuestionChars: 120,
		maxAnswerChars: 80,
		maxExplanationChars: 150,
		maxRubricChars: 0,
		maxOptionChars: 60,
		limits: {
			questionChars: 180,
			answerChars: 220,
			explanationChars: 220,
			rubricChars: 120,
			optionChars: 140,
		},
	},
};

function makeResult(answers: Record<string, string>, overrides?: Partial<QuizResult>): QuizResult {
	return {
		answers,
		score: 0,
		weightedScore: 0,
		timing: { totalMs: 145_000, perQuestionMs: { q1: 30_000, q2: 25_000, q3: 50_000, q4: 40_000 } },
		confidence: { q1: 85, q2: 60, q3: 70, q4: 90 },
		partialCredits: {},
		flagged: ["q3"],
		...overrides,
	};
}

function stored(answers: Record<string, string>, overrides?: Partial<QuizResult>): StoredQuizResult {
	return {
		id: "qr-1",
		timestamp: Date.now() - 3600_000,
		quiz: baseQuiz,
		result: makeResult(answers, overrides),
	};
}

const meta = {
	title: "Quiz/QuizResultCard",
	component: QuizResultCard,
	args: {
		data: stored({ q1: "Thylakoid membrane", q2: "False", q3: "chlorophyl", q4: "Oxygen" }),
		onReview: fn(),
	},
} satisfies Meta<typeof QuizResultCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PerfectScore: Story = {
	args: {
		data: stored({ q1: "Thylakoid membrane", q2: "False", q3: "chlorophyll", q4: "Oxygen" }, { score: 4, weightedScore: 3.8 }),
	},
};

export const LowScore: Story = {
	args: {
		data: stored(
			{ q1: "Stroma", q2: "True", q3: "melanin", q4: "Carbon dioxide" },
			{ score: 0, weightedScore: 0.2 }
		),
	},
};

export const MixedWithPartialCredit: Story = {
	args: {
		data: stored(
			{ q1: "Thylakoid membrane", q2: "False", q3: "chlorophyl", q4: "Oxygen" },
			{ partialCredits: { q3: 0.75 } }
		),
	},
};

export const WithTimingOnly: Story = {
	args: {
		data: {
			...stored({ q1: "Thylakoid membrane", q2: "False", q3: "chlorophyll", q4: "Oxygen" }),
			result: {
				...makeResult({ q1: "Thylakoid membrane", q2: "False", q3: "chlorophyll", q4: "Oxygen" }),
				flagged: [],
			},
		},
	},
};

export const WithoutReviewAction: Story = {
	args: {
		data: stored({ q1: "Thylakoid membrane", q2: "False", q3: "chlorophyll", q4: "Oxygen" }),
		onReview: undefined,
	},
};

export const LongTopicTitle: Story = {
	args: {
		data: {
			...stored({ q1: "Thylakoid membrane", q2: "False", q3: "chlorophyll", q4: "Oxygen" }),
			quiz: {
				...baseQuiz,
				topic: "The Biochemical Mechanisms of Photosynthesis in C4 Plants Under Stress Conditions",
			},
		},
	},
};
