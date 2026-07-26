import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../../styled-system/css";
import { keatingOpenUIStudyPlanExampleProgram } from "./library";
import { KeatingOpenUIRenderer } from "./renderer";

const storyFrameClass = css({
	width: "min(58rem, calc(100vw - 2rem))",
	paddingBlock: "1rem",
});

function DetailedStudyPlanStory() {
	return (
		<div className={storyFrameClass}>
			<KeatingOpenUIRenderer
				program={keatingOpenUIStudyPlanExampleProgram}
				metadata={{ id: "storybook-dns-learning-path", lifecycle: "workspace", revision: 0 }}
			/>
		</div>
	);
}

const meta = {
	title: "Learning/NestedStudyPlan",
	component: DetailedStudyPlanStory,
	parameters: {
		layout: "centered",
	},
} satisfies Meta<typeof DetailedStudyPlanStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DetailedWithDependencies: Story = {};
