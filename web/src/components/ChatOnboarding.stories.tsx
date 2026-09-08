import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ChatOnboarding } from "./ChatOnboarding";

const meta = {
	title: "Chat/Onboarding",
	component: ChatOnboarding,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => <div style={{ padding: "1rem", minHeight: "100dvh", boxSizing: "border-box" }}><Story /></div>,
	],
	args: {
		onUseKeating: fn(),
		onConnectAccount: fn(),
		onChooseModel: fn(),
		onComplete: fn(),
		onSkip: fn(),
	},
} satisfies Meta<typeof ChatOnboarding>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("radio", { name: /Use Keating/ })).toBeChecked();
	},
};

export const KeatingAccount: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(args.onUseKeating).toHaveBeenCalledTimes(1);
		await expect(canvas.getByRole("heading", { name: "Make yourself at home." })).toBeVisible();
	},
};

export const BringYourOwnKey: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("radio", { name: /Bring your own key/ }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(args.onUseKeating).not.toHaveBeenCalled();
		await expect(canvas.getByRole("heading", { name: "Connect your model." })).toBeVisible();
	},
};

export const StartingPoint: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.type(canvas.getByRole("textbox", { name: /Your starting point/ }), "I know a little Python. Help me understand recursion.");
		await expect(canvas.getByRole("button", { name: "Start chatting" })).toBeVisible();
	},
};

export const OpeningAccount: Story = {
	args: { onConnectAccount: fn(() => new Promise<void>(() => {})) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Connect or create an account" }));
		await expect(canvas.getByRole("button", { name: "Opening…" })).toBeDisabled();
		await expect(canvas.getByRole("button", { name: "Go straight to chat" })).toBeEnabled();
	},
};

export const AccountError: Story = {
	args: { onConnectAccount: fn(async () => { throw new Error("Account service unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Connect or create an account" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("That setup couldn’t open.");
	},
};

export const ModelError: Story = {
	args: { onChooseModel: fn(async () => { throw new Error("Model setup unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("radio", { name: /Bring your own key/ }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Choose a model and provider" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("That setup couldn’t open.");
	},
};

export const KeatingSelectionError: Story = {
	args: { onUseKeating: fn(async () => { throw new Error("Model selection unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("Keating’s model couldn’t be selected.");
		await expect(canvas.getByRole("button", { name: "Go straight to chat" })).toBeEnabled();
	},
};

export const Mobile: Story = {
	decorators: [(Story) => <div style={{ width: "min(100%, 390px)", marginInline: "auto" }}><Story /></div>],
};
