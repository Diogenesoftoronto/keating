import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { css } from "../../styled-system/css";
import { RetryResponseButton } from "./RetryResponseButton";

const meta = {
	title: "Chat/RetryResponseButton",
	component: RetryResponseButton,
	decorators: [
		(Story) => (
			<div className={css({ padding: "1.5rem", backgroundColor: "var(--background)", color: "var(--foreground)" })}>
				<Story />
			</div>
		),
	],
	args: {
		onRetry: fn(async () => {}),
	},
} satisfies Meta<typeof RetryResponseButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const Retrying: Story = {
	args: { loading: true },
};
