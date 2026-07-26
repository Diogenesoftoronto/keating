import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { MermaidRenderer } from "./MermaidRenderer";

const storyFrameClass = css({
	width: "min(42rem, calc(100vw - 2rem))",
	border: "1px solid var(--border)",
	borderRadius: "0.75rem",
	backgroundColor: "var(--background)",
	padding: "1rem",
});

const wideLearningFlow = `flowchart LR
    question["Learner question"] --> diagnose{"What kind of help?"}
    diagnose -->|New concept| explain["Focused explanation"]
    diagnose -->|Unclear step| example["Worked example"]
    diagnose -->|Ready to test| check["OpenUI question"]
    explain --> model["Build a mental model"]
    example --> model
    model --> transfer["Apply it in a new context"]
    check --> feedback{"Answer evidence"}
    feedback -->|Confident| transfer
    feedback -->|Partial| example
    feedback -->|Confused| explain
    transfer --> reflect["Summarize what changed"]`;

const meta = {
	title: "Learning/MermaidRenderer",
	component: MermaidRenderer,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className={storyFrameClass}>
				<Story />
			</div>
		),
	],
	args: {
		content: wideLearningFlow,
	},
} satisfies Meta<typeof MermaidRenderer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ExpandableWideDiagram: Story = {};
