import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { NOTORGANIC_PACKS } from "../notorganic-provider/packs";
import { NotOrganicAccessPanel } from "./NotOrganicAccessPromptDialog";

const meta = {
	title: "Chat/KeatingAccount",
	component: NotOrganicAccessPanel,
	parameters: { layout: "fullscreen" },
	args: { onConnect: fn(), onDismiss: fn() },
} satisfies Meta<typeof NotOrganicAccessPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignUpOrSignIn: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("dialog", { name: "Use Keating’s model" })).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: "Sign up / Sign in" }));
		await expect(args.onConnect).toHaveBeenCalledTimes(1);
	},
};
export const Connecting: Story = { args: { loading: true }, play: async ({ canvasElement }) => {
	const canvas = within(canvasElement);
	await expect(canvas.getByRole("button", { name: "Connecting…" })).toBeDisabled();
	await expect(canvas.getByRole("button", { name: "Not now" })).toBeEnabled();
} };
export const ConnectionError: Story = { args: { error: "Sign-in could not open. Please try again." } };
export const Connected: Story = { args: { connected: true } };
export const Credits: Story = { args: { pack: NOTORGANIC_PACKS[1], connected: true, onCheckout: fn(), summary: "$12.00 available" } };
export const Mobile: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };
export const KeyboardDismissal: Story = { play: async ({ canvasElement, args }) => {
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole("button", { name: "Not now" }));
	await expect(args.onDismiss).toHaveBeenCalledTimes(1);
	await userEvent.keyboard("{Escape}");
	await expect(args.onDismiss).toHaveBeenCalledTimes(2);
} };
