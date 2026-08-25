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
		await userEvent.click(canvas.getByRole("button", { name: "Open waitlist form" }));
		await expect(args.onJoin).toHaveBeenCalledTimes(1);
	},
};

export const OpeningSurvey: Story = {
	args: { state: "loading" },
};

export const SurveyUnavailable: Story = {
	args: { state: "survey_unavailable" },
};

export const Mobile: Story = {
	parameters: {
		layout: "fullscreen",
		viewport: { defaultViewport: "mobile1" },
	},
};
