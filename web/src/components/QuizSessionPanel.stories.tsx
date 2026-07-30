import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { css } from "../../styled-system/css";
import type { Quiz } from "../keating/core";
import { QuizSessionPanel } from "./QuizSessionPanel";

const quiz: Quiz = {
	topic: "Dependency placement when the package name is unusually long",
	slug: "mobile-dependency-placement",
	generatedAt: new Date().toISOString(),
	totalPoints: 2,
	review: {
		status: "passed",
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
	},
	questions: [
		{
			id: "mobile-choice",
			type: "multiple_choice",
			level: "application",
			question: "Which package input keeps a Python runtime import available after installation on a fresh machine?",
			options: ["native-inputs", "inputs", "propagated-inputs"],
			correctAnswer: "propagated-inputs",
			explanation: "Runtime imports must remain available to the installed program.",
		},
		{
			id: "mobile-transfer",
			type: "transfer",
			level: "transfer",
			question: "Explain how you would place a build-only tool and a dynamically linked library.",
			correctAnswer: "The build tool belongs in native-inputs and the linked library belongs in inputs.",
			explanation: "The distinction follows when each dependency is needed.",
		},
	],
};

const meta = {
	title: "Quiz/QuizSessionPanel",
	component: QuizSessionPanel,
	parameters: {
		layout: "fullscreen",
		viewport: { defaultViewport: "mobile1" },
	},
	decorators: [
		(Story) => (
			<div className={css({ minHeight: "100dvh", padding: "0.375rem", background: "var(--background)" })}>
				<Story />
			</div>
		),
	],
	args: {
		quiz,
		onSubmit: fn(),
		onDismiss: fn(),
	},
} satisfies Meta<typeof QuizSessionPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MobileStart: Story = {};

export const MobileQuestion: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole("button", { name: "Start Quiz" }));
		const choice = await canvas.findByRole("button", { name: "native-inputs" });
		choice.focus();
		await userEvent.keyboard("{Enter}");
		await expect(choice).toHaveAttribute("aria-pressed", "true");
	},
};
