import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
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
				metadata={{ id: "storybook-linked-dns-study-plans", lifecycle: "workspace", revision: 0 }}
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

export const DetailedTwoLevelsWithPlanLinks: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const followUp = await canvas.findByRole("link", {
			name: /continue with: dns observability lab/i,
		});
		const prerequisite = await canvas.findByRole("link", {
			name: /prerequisite: dns resolution: mechanism and reasoning/i,
		});

		await expect(followUp).toHaveAttribute("href", "#study-plan-dns-observability-lab");
		await expect(prerequisite).toHaveAttribute("href", "#study-plan-dns-resolution-core");
		await expect(
			canvasElement.querySelector("#study-plan-dns-observability-lab"),
		).not.toBeNull();
	},
};
