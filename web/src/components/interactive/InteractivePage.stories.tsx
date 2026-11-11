import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { INTERACTIVE_PAGE_LIMITS } from "../../keating/interactive-page/protocol";
import { InteractivePage, InteractivePageFallback } from "./InteractivePage";
import { GRADIENT_DESCENT_EXPLORER, LEARNING_RATE_EXERCISE } from "./interactive-page-samples";

const meta = {
	title: "Chat/InteractivePage",
	component: InteractivePage,
	parameters: { layout: "padded" },
	decorators: [(Story) => <div style={{ maxWidth: 760, margin: "0 auto" }}><Story /></div>],
	args: { ...GRADIENT_DESCENT_EXPLORER, onShare: fn(() => true) },
} satisfies Meta<typeof InteractivePage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A manipulable explorer: learning-rate and start sliders, stepping, state saved across reloads. */
export const GradientDescentExplorer: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const frame = await waitFor(() => canvas.getByTitle(GRADIENT_DESCENT_EXPLORER.title), { timeout: INTERACTIVE_PAGE_LIMITS.readyTimeoutMs });
		await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
		await waitFor(() => expect(canvas.getByRole("button", { name: "Open full screen" })).toBeVisible(), { timeout: INTERACTIVE_PAGE_LIMITS.readyTimeoutMs });
	},
};

/** A short exercise that calls `keating.share` with a score when the learner checks it. */
export const LearningRateExercise: Story = {
	args: { ...LEARNING_RATE_EXERCISE },
};

/** The same explorer at phone width: no horizontal page scroll. */
export const PhoneWidth: Story = {
	decorators: [(Story) => <div style={{ width: 360 }}><Story /></div>],
};

export const EarlierTurn: Story = {
	args: { ...LEARNING_RATE_EXERCISE, disabled: true },
};

export const Oversize: Story = {
	args: { html: `<p>${"x".repeat(INTERACTIVE_PAGE_LIMITS.maxHtmlBytes)}</p>` },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent("too large");
		await expect(canvas.getByRole("alert")).toHaveTextContent(GRADIENT_DESCENT_EXPLORER.description.slice(0, 40));
		await expect(canvas.getByRole("button", { name: "Reload" })).toBeVisible();
	},
};

export const Invalid: Story = {
	args: { html: "   " },
};

export const Blocked: Story = {
	render: (args) => <InteractivePageFallback status="blocked" title={args.title} description={args.description} onReload={fn()} />,
};

export const Crashed: Story = {
	render: (args) => <InteractivePageFallback status="crashed" title={args.title} description={args.description} message="ReferenceError: plot is not defined" onReload={fn()} />,
};
