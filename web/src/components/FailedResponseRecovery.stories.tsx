import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { css } from "../../styled-system/css";
import { FailedResponseRecovery } from "./FailedResponseRecovery";

const meta = {
	title: "Chat/FailedResponseRecovery",
	component: FailedResponseRecovery,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className={css({ width: "min(42rem, calc(100vw - 2rem))" })}>
				<Story />
			</div>
		),
	],
	args: {
		recovery: "The provider stopped before completing this turn. Retry the same prompt to continue.",
		onRetry: fn(async () => {}),
	},
} satisfies Meta<typeof FailedResponseRecovery>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RetrySamePrompt: Story = {};
