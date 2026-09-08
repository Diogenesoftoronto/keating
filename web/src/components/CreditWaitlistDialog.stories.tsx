import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { css } from "../../styled-system/css";
import { NOTORGANIC_PACKS } from "../notorganic-provider/packs";
import {
	CreditWaitlistPanel,
	type CreditWaitlistPanelState,
} from "./CreditWaitlistDialog";

const meta = {
	title: "Pricing/CreditWaitlist",
	component: CreditWaitlistPanel,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className={css({ width: "min(28rem, calc(100vw - 2rem))" })}>
				<Story />
			</div>
		),
	],
	args: {
		pack: NOTORGANIC_PACKS[1],
		state: "prompt" satisfies CreditWaitlistPanelState,
		onJoin: fn(),
		onDismiss: fn(),
	},
} satisfies Meta<typeof CreditWaitlistPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Prompt: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole("textbox", { name: "Email address" }), "learner@example.com");
		await userEvent.click(canvas.getByRole("checkbox"));
		await userEvent.click(canvas.getByRole("button", { name: "Join the email waitlist" }));
		await expect(args.onJoin).toHaveBeenCalledTimes(1);
	},
};

export const SavingEmail: Story = {
	args: { state: "loading" },
};

export const SubmissionError: Story = {
	args: { state: "error" },
};

export const Mobile: Story = {
	parameters: {
		layout: "fullscreen",
		viewport: { defaultViewport: "mobile1" },
	},
};

export const Saved: Story = { args: { state: "success" } };
