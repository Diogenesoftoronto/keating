import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ChatOnboarding, ONBOARDING_STEPS } from "./ChatOnboarding";

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

/** Step indices, so a reordered flow moves the stories with it. */
const stepIndex = (id: string) => ONBOARDING_STEPS.findIndex((step) => step.id === id);

export const Welcome: Story = {
	args: { initialStep: stepIndex("welcome") },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("heading", { name: "Keating teaches by asking." })).toBeVisible();
	},
};

export const ModelAccess: Story = {
	args: { initialStep: stepIndex("access") },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("radio", { name: /Use Keating/ })).toBeChecked();
	},
};

export const AboutYou: Story = {
	args: { initialStep: stepIndex("identity") },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByLabelText("What should Keating call you?"), "Sam");
		await expect(canvas.getByRole("button", { name: "Skip this" })).toBeEnabled();
	},
};

export const HowToTeachYou: Story = {
	args: { initialStep: stepIndex("teaching") },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("combobox", { name: "Socratic intensity" })).toBeVisible();
	},
};

export const Accessibility: Story = {
	args: { initialStep: stepIndex("accessibility") },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Reduce motion")).toBeVisible();
		// Toggle renders a real checkbox; one per accessibility preference, all reachable.
		await expect(canvas.getAllByRole("checkbox")).toHaveLength(6);
	},
};

export const Finish: Story = {
	args: { initialStep: stepIndex("finish"), onStartTour: fn() },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Show me around first" }));
		await expect(args.onStartTour).toHaveBeenCalledTimes(1);
		await expect(args.onComplete).toHaveBeenCalledTimes(1);
	},
};

export const KeatingAccount: Story = {
	args: { initialStep: stepIndex("access") },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(args.onUseKeating).toHaveBeenCalledTimes(1);
		await expect(canvas.getByRole("heading", { name: "Make yourself at home." })).toBeVisible();
	},
};

export const BringYourOwnKey: Story = {
	args: { initialStep: stepIndex("access") },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("radio", { name: /Bring your own key/ }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(args.onUseKeating).not.toHaveBeenCalled();
		await expect(canvas.getByRole("heading", { name: "Connect your model." })).toBeVisible();
	},
};

export const StartingPoint: Story = {
	args: { initialStep: stepIndex("learning") },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByLabelText("What would you like to understand?"), "I know a little Python. Help me understand recursion.");
		await expect(canvas.getByRole("button", { name: "Next" })).toBeVisible();
	},
};

export const OpeningAccount: Story = {
	args: { initialStep: stepIndex("access"), onConnectAccount: fn(() => new Promise<void>(() => {})) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Connect or create an account" }));
		await expect(canvas.getByRole("button", { name: "Opening…" })).toBeDisabled();
		await expect(canvas.getByRole("button", { name: "Go straight to chat" })).toBeEnabled();
	},
};

export const AccountError: Story = {
	args: { initialStep: stepIndex("access"), onConnectAccount: fn(async () => { throw new Error("Account service unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Connect or create an account" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("That setup couldn’t open.");
	},
};

export const ModelError: Story = {
	args: { initialStep: stepIndex("access"), onChooseModel: fn(async () => { throw new Error("Model setup unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("radio", { name: /Bring your own key/ }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("button", { name: "Choose a model and provider" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("That setup couldn’t open.");
	},
};

export const KeatingSelectionError: Story = {
	args: { initialStep: stepIndex("access"), onUseKeating: fn(async () => { throw new Error("Model selection unavailable"); }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("Keating’s model couldn’t be selected.");
		await expect(canvas.getByRole("button", { name: "Go straight to chat" })).toBeEnabled();
	},
};

export const Mobile: Story = {
	args: { initialStep: stepIndex("identity") },
	decorators: [(Story) => <div style={{ width: "min(100%, 390px)", marginInline: "auto" }}><Story /></div>],
};
