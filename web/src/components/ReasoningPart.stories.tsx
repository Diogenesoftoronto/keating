import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { css } from "../../styled-system/css";
import { ReasoningPart } from "./AssistantChatPanel";

const meta = {
	title: "Chat/Reasoning",
	component: ReasoningPart,
	decorators: [
		(Story) => (
			<div
				className={css({
					maxWidth: "42rem",
					padding: "1rem",
					backgroundColor: "var(--background)",
					color: "var(--foreground)",
				})}
			>
				<Story />
			</div>
		),
	],
	args: {
		text: "The learner asked about a runtime behavior, so inspect the relevant source before drawing a conclusion.",
		show: true,
		defaultOpen: false,
	},
} satisfies Meta<typeof ReasoningPart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AvailableAndCollapsed: Story = {
	args: {
		status: { type: "running" },
	},
};

export const OpensOnRequest: Story = {
	args: {
		status: { type: "running" },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const label = await canvas.findByText("Reasoning");
		const summary = label.closest("summary");
		const disclosure = label.closest("details");

		await expect(summary).not.toBeNull();
		await expect(disclosure).not.toBeNull();
		await expect(disclosure).not.toHaveAttribute("open");

		await userEvent.click(summary!);
		await expect(disclosure).toHaveAttribute("open");
		await expect(canvas.getByText(/inspect the relevant source/i)).toBeVisible();
	},
};

export const StartsExpandedWhenEnabled: Story = {
	args: {
		status: { type: "running" },
		defaultOpen: true,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const label = await canvas.findByText("Reasoning");
		const disclosure = label.closest("details");

		await expect(disclosure).not.toBeNull();
		await expect(disclosure).toHaveAttribute("open");
		await expect(canvas.getByText(/inspect the relevant source/i)).toBeVisible();
	},
};
