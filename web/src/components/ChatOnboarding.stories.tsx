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
		onConnectAccount: fn(),
		onChooseModel: fn(),
		onComplete: fn(),
		onSkip: fn(),
	},
} satisfies Meta<typeof ChatOnboarding>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {};

export const ChooseModel: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(canvas.getByRole("heading", { name: "Choose your model." })).toBeVisible();
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
		await userEvent.click(canvas.getByRole("button", { name: "Connect or create an account" }));
		await expect(canvas.getByRole("button", { name: "Opening…" })).toBeDisabled();
		await expect(canvas.getByRole("button", { name: "Go straight to chat" })).toBeEnabled();
	},
};

export const AccountError: Story = {
	args: { onConnectAccount: fn(async () => { throw new Error("Account service unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Connect or create an account" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("That setup couldn’t open.");
	},
};

export const ModelError: Story = {
	args: { onChooseModel: fn(async () => { throw new Error("Model setup unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Choose a model" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("That setup couldn’t open.");
	},
};

export const Mobile: Story = {
	decorators: [(Story) => <div style={{ width: "min(100%, 390px)", marginInline: "auto" }}><Story /></div>],
};
