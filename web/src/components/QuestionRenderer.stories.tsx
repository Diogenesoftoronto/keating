import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { css } from "../../styled-system/css";
import {
	QuestionRenderer,
	type QuestionFormData,
} from "./QuestionRenderer";

const storyWidthClass = css({ width: "min(72rem, calc(100vw - 2rem))" });

const openQuestions: QuestionFormData = {
	topic: "Learning strategy",
	intro:
		"Use concrete evidence from your own study habits. These responses are reviewed by the tutor rather than scored automatically.",
	questions: [
		{
			header: "Current model",
			type: "text",
			question:
				"When you get an answer wrong during practice, what do you do next, and how do you decide when to revisit it?",
			allowText: true,
			hint: "Describe the steps you actually take, even if the process is informal.",
		},
		{
			header: "Next experiment",
			type: "text",
			question:
				"What is one change you could test this week, and what evidence would tell you whether it improved recall?",
			allowText: true,
			hint: "Name both the change and the observable result.",
		},
	],
};

const meta = {
	title: "Questions/QuestionRenderer",
	component: QuestionRenderer,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className={storyWidthClass}>
				<Story />
			</div>
		),
	],
	args: {
		onSubmit: fn(),
	},
} satisfies Meta<typeof QuestionRenderer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OpenTextQuestion: Story = {
	args: {
		data: {
			topic: "Conceptual understanding",
			questions: [
				{
					header: "Explain",
					type: "text",
					question:
						"Why can a program pass its build-time checks and still fail after installation?",
					allowText: true,
					hint: "Separate what is available during the build from what remains at runtime.",
				},
			],
		},
	},
};

export const OpenQuestions: Story = {
	args: {
		data: openQuestions,
	},
};

export const OpenQuestionsSubmitted: Story = {
	args: {
		data: openQuestions,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("textbox"),
			"I write down the failure mode, correct it from memory, then retry it two days later.",
		);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.type(
			await canvas.findByRole("textbox"),
			"I will schedule two delayed retrieval attempts and compare how much I can reconstruct without notes.",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Submit answers" }),
		);
		await expect(canvas.findByText("Submitted")).resolves.toBeTruthy();
	},
};

export const MatchingDependencies: Story = {
	args: {
		data: {
			questions: [
				{
					header: "Match deps",
					type: "matching",
					question:
						"Match each dependency to the Guix package input slot where it belongs.",
					items: [
						"requests: Python runtime import",
						"pytest: test tool used during check",
						"libcrypto: library linked while building",
					],
					choices: ["inputs", "native-inputs", "propagated-inputs"],
					correctMatches: ["propagated-inputs", "native-inputs", "inputs"],
					itemLabel: "Dependency",
					choiceLabel: "Input slot",
					uniqueMatches: true,
				},
			],
		},
	},
};

export const ClassificationDependencies: Story = {
	args: {
		data: {
			questions: [
				{
					header: "Three deps",
					type: "classification",
					question:
						"Place each dependency in the correct Guix package input slot and justify each choice briefly.",
					items: ["requests", "pytest", "libcrypto"],
					choices: ["inputs", "native-inputs", "propagated-inputs"],
					itemLabel: "Dependency",
					choiceLabel: "Slot",
					reasonLabel: "One-phrase reason",
					requireReasons: true,
				},
			],
		},
	},
};

export const ClassificationCases: Story = {
	args: {
		data: {
			intro: "Use the category that best matches what evidence would change your mind.",
			questions: [
				{
					header: "Evidence sort",
					type: "classification",
					question: "Sort each claim into the kind of evidence it needs next.",
					items: [
						"Students remember more after spaced review",
						"The CLI install path works on fresh machines",
						"The animation makes vector fields easier to explain",
						"The policy change improves benchmark transfer scores",
					],
					choices: ["experiment", "integration test", "user study", "benchmark"],
					itemLabel: "Claim",
					choiceLabel: "Evidence type",
					reasonLabel: "Why that evidence",
					requireReasons: true,
				},
			],
		},
	},
};

export const ClassificationWithoutReasons: Story = {
	args: {
		data: {
			questions: [
				{
					header: "Fast sort",
					type: "classification",
					question: "Assign each topic to the first review mode you would use.",
					items: ["limits", "closures", "blood pressure", "civil procedure"],
					choices: ["worked example", "flashcards", "concept map", "case comparison"],
					itemLabel: "Topic",
					choiceLabel: "Review mode",
					requireReasons: false,
				},
			],
		},
	},
};
