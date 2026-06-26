import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { QuestionRenderer } from "./QuestionRenderer";

const meta = {
	title: "Questions/QuestionRenderer",
	component: QuestionRenderer,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className="w-[min(72rem,calc(100vw-2rem))]">
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
