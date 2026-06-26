import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { QuizRenderer } from "./QuizRenderer";
import type { Quiz } from "../keating/core";

const review = {
	status: "passed" as const,
	issues: [],
	duplicatesRemoved: 0,
	maxQuestionChars: 180,
	maxAnswerChars: 220,
	maxExplanationChars: 220,
	maxRubricChars: 140,
	maxOptionChars: 120,
	limits: {
		questionChars: 180,
		answerChars: 220,
		explanationChars: 220,
		rubricChars: 140,
		optionChars: 120,
	},
};

const fullMiniQuiz: Quiz = {
	topic: "Packaging Python CLIs with Guix",
	slug: "guix-python-cli-packaging",
	generatedAt: new Date().toISOString(),
	totalPoints: 8,
	review,
	adaptiveRules: [
		{ level: "recall", threshold: 0.9 },
		{ level: "application", threshold: 0.75 },
	],
	questions: [
		{
			id: "q1-runtime-dep",
			type: "multiple_choice",
			level: "recall",
			question: "A Python CLI imports `requests` at runtime. Which Guix input slot should carry it?",
			options: ["native-inputs", "inputs", "propagated-inputs", "check-inputs"],
			correctAnswer: "propagated-inputs",
			explanation:
				"Python imports are runtime dependencies, and propagated-inputs makes them available to downstream users of the package.",
			timeLimit: 45,
			reframes: {
				"plain language": "Where should a Python library go if the installed CLI imports it when users run the program?",
				"concrete example": "If `mycli` does `import requests`, which input slot ensures users can run `mycli` after installing it?",
			},
		},
		{
			id: "q2-build-tools",
			type: "multi_select",
			level: "comprehension",
			question: "Select every dependency that normally belongs in `native-inputs` for this package.",
			options: ["pytest", "pkg-config", "requests", "setuptools-scm", "openssl"],
			correctAnswer: "pytest, pkg-config, setuptools-scm",
			correctAnswers: ["pytest", "pkg-config", "setuptools-scm"],
			explanation:
				"native-inputs is for tools used by the build/check environment, not libraries imported or linked by the final program.",
		},
		{
			id: "q3-fill-blanks",
			type: "fill_in",
			level: "application",
			question:
				"Fill the slots: `pytest` goes in ___, `requests` goes in ___, and a linked C library goes in ___.",
			blanks: [
				{ placeholder: "slot", hint: "test tool" },
				{ placeholder: "slot", hint: "Python import" },
				{ placeholder: "slot", hint: "linked library" },
			],
			correctAnswer: "native-inputs | propagated-inputs | inputs",
			correctAnswers: ["native-inputs", "propagated-inputs", "inputs"],
			explanation:
				"Tests and build tools are native inputs, Python runtime imports are propagated, and linked libraries are regular inputs.",
		},
		{
			id: "q4-short-answer",
			type: "short_answer",
			level: "analysis",
			question:
				"Explain why putting a Python runtime import only in `native-inputs` can pass tests but still produce a broken installed package.",
			correctAnswer:
				"native-inputs is available during build/check only, so the package can test successfully while the installed CLI later cannot import the runtime library.",
			explanation:
				"The failure appears after installation because native-inputs are not part of the runtime closure exposed to users.",
			rubric:
				"Full credit: mentions build/check availability, runtime absence, and the installed CLI import failure.",
		},
		{
			id: "q5-true-false",
			type: "true_false",
			level: "comprehension",
			question: "`inputs` is always wrong for libraries linked into this package during build.",
			correctAnswer: "False",
			explanation:
				"Linked libraries are a normal use of inputs; the package needs them available for linking and in its runtime closure.",
		},
		{
			id: "q6-slider",
			type: "slider",
			level: "application",
			question:
				"Confidence check: if a dependency is used only by the test suite, how likely is `native-inputs` to be correct?",
			min: 0,
			max: 100,
			step: 5,
			correctAnswer: "95",
			explanation:
				"Test-only tools are the canonical native-inputs case, so a high confidence answer is appropriate.",
		},
		{
			id: "q7-dropdown",
			type: "dropdown",
			level: "recall",
			question: "Pick the best slot for `libcrypto` when the package links against it.",
			options: ["native-inputs", "inputs", "propagated-inputs"],
			correctAnswer: "inputs",
			explanation:
				"A linked library needed by this package belongs in inputs unless there is a specific propagation reason.",
		},
		{
			id: "q8-transfer",
			type: "transfer",
			level: "transfer",
			question:
				"Now transfer the rule: a Rust CLI uses `pkg-config` at build time and dynamically links `zlib`. Where do they go, and why?",
			correctAnswer:
				"`pkg-config` goes in native-inputs because it is a build tool; `zlib` goes in inputs because the package links against it.",
			explanation:
				"The same build-time versus linked-runtime distinction applies outside Python.",
			rubric:
				"Full credit: assigns both dependencies and justifies each with build-tool versus linked-library reasoning.",
		},
		{
			id: "q9-fallback-runtime",
			type: "multiple_choice",
			level: "recall",
			fallbackFor: "recall",
			question: "Fallback: Which phrase best describes `propagated-inputs`?",
			options: [
				"Tools used only during check",
				"Dependencies exposed to users/downstream packages",
				"Source files copied into the package",
			],
			correctAnswer: "Dependencies exposed to users/downstream packages",
			explanation:
				"Propagation makes a dependency visible to consumers of the package, which is often needed for language-level imports.",
		},
	],
};

const meta = {
	title: "Quiz/QuizRenderer",
	component: QuizRenderer,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className="w-[min(58rem,calc(100vw-2rem))]">
				<Story />
			</div>
		),
	],
	args: {
		quiz: fullMiniQuiz,
		topicStats: {
			count: 24,
			avgScore: 4.9,
			avgWeightedScore: 4.2,
			topQuartile: 7,
		},
		onSubmit: fn(),
	},
} satisfies Meta<typeof QuizRenderer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const FullMiniApplication: Story = {};

export const FastTimedQuestion: Story = {
	args: {
		quiz: {
			...fullMiniQuiz,
			topic: "Timed Recall Drill",
			slug: "timed-recall-drill",
			totalPoints: 1,
			adaptiveRules: undefined,
			questions: [
				{
					...fullMiniQuiz.questions[0],
					id: "timed-single",
					timeLimit: 10,
				},
			],
		},
	},
};

export const ClosedQuestionFeedback: Story = {
	args: {
		quiz: {
			...fullMiniQuiz,
			topic: "Closed Question Feedback",
			slug: "closed-question-feedback",
			totalPoints: 4,
			adaptiveRules: undefined,
			questions: [
				fullMiniQuiz.questions[0],
				fullMiniQuiz.questions[1],
				fullMiniQuiz.questions[5],
				fullMiniQuiz.questions[6],
			],
		},
		topicStats: null,
	},
};

export const NoBenchmarkData: Story = {
	args: {
		topicStats: null,
	},
};
