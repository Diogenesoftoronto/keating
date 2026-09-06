import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { css } from "../../styled-system/css";
import { DeckSummary, FlashcardRenderer, initialSrsState } from "./FlashcardRenderer";
import type { FlashcardDeck } from "../keating/srs";

const storyWidthClass = css({ width: "min(42rem, calc(100vw - 2rem))" });
const compactStoryWidthClass = css({ width: "min(34rem, calc(100vw - 1rem))" });

const now = Date.now();

const deck: FlashcardDeck = {
	id: "deck-bayes-rule",
	topic: "Bayes rule",
	slug: "bayes-rule-flashcards",
	title: "Bayes rule flashcards",
	description: "Practice priors, evidence, likelihood, and posterior updates.",
	createdAt: now - 86_400_000,
	updatedAt: now,
	cards: [
		{
			id: "bayes-prior",
			front: "What is the prior in a Bayesian update?",
			back: "The prior is the belief before seeing the new evidence.",
			tags: ["definition", "prior"],
			srs: initialSrsState(now),
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "bayes-likelihood",
			front: "In plain language, what does likelihood measure?",
			back: "How expected the evidence is if a hypothesis were true.",
			tags: ["likelihood"],
			srs: { ...initialSrsState(now), reps: 1, intervalDays: 1, lastReviewedAt: now - 86_400_000, lastRating: 2 },
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "bayes-posterior",
			front: "What changes when evidence is strong but the prior is tiny?",
			back: "The posterior can rise substantially, but it may still remain modest because the starting base rate was low.",
			tags: ["posterior", "base-rate"],
			srs: { ...initialSrsState(now), reps: 3, intervalDays: 28, dueAt: now + 12 * 86_400_000, lastReviewedAt: now - 16 * 86_400_000, lastRating: 3 },
			createdAt: now,
			updatedAt: now,
		},
	],
};

const meta = {
	title: "Artifacts/Flashcards",
	component: FlashcardRenderer,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className={storyWidthClass}>
				<Story />
			</div>
		),
	],
	args: {
		deck,
		onReview: fn(),
		onComplete: fn(),
	},
} satisfies Meta<typeof FlashcardRenderer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReviewQueue: Story = {};

export const InteractiveReview: Story = {
	args: {
		autoFocusKeyboard: true,
	},
	parameters: {
		docs: {
			description: {
				story: "Click or press Space to flip, use 1-4 to grade, or swipe the revealed card in the canvas.",
			},
		},
	},
};

export const PhosphorArena: Story = {
	args: { defaultShaderPreset: "phosphor" },
};

export const SolarArena: Story = {
	args: { defaultShaderPreset: "solar" },
};

export const OrbitArena: Story = {
	args: { defaultShaderPreset: "orbit" },
};

export const PrismArena: Story = {
	args: { defaultShaderPreset: "prism" },
};

export const CurrentArena: Story = {
	args: { defaultShaderPreset: "current" },
};

export const ContourArena: Story = {
	args: { defaultShaderPreset: "contour" },
};

export const StillArena: Story = {
	args: { defaultShaderPreset: "still" },
};

export const DueSubset: Story = {
	args: {
		restrictToCardIds: ["bayes-prior", "bayes-likelihood"],
	},
};

export const CompactChatEmbed: Story = {
	decorators: [
		(Story) => (
			<div className={compactStoryWidthClass}>
				<Story />
			</div>
		),
	],
	args: {
		showMeta: false,
	},
};

export const CompactChatEmbedRevealed: Story = {
	decorators: CompactChatEmbed.decorators,
	args: CompactChatEmbed.args,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^reveal answer$/i }));
	},
};

export const Summary: Story = {
	render: () => (
		<DeckSummary
			deck={deck}
			now={now}
			onStart={fn()}
		/>
	),
};

export const MobileRoundComplete: Story = {
	args: { restrictToCardIds: ["bayes-prior"], defaultShaderPreset: "still" },
	parameters: { viewport: { defaultViewport: "mobile1" } },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^reveal answer$/i }));
		await userEvent.click(canvas.getByRole("button", { name: /^Good:/ }));
		await waitFor(() => expect(canvas.getByText("Clean sweep")).toBeTruthy());
		await expect(args.onReview).toHaveBeenCalledTimes(1);
		await expect(args.onComplete).toHaveBeenCalledWith({ reviewed: 1, lapses: 0 });
	},
};

export const TimedReveal: Story = {
	args: { restrictToCardIds: ["bayes-prior"], defaultShaderPreset: "still" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const setting = canvas.getByRole("combobox", { name: "Auto-reveal answer" });
		await expect(setting).toHaveTextContent("Off");
		await userEvent.click(setting);
		await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "5s" }));
		await expect(canvas.getByRole("button", { name: "Pause reveal timer" })).toBeEnabled();
		await waitFor(() => expect(canvas.getByRole("button", { name: /^Good:/ })).toBeEnabled(), { timeout: 7_000 });
		await expect(canvas.getByRole("status")).toHaveTextContent("Answer: The prior is the belief before seeing the new evidence.");
		await expect(args.onReview).not.toHaveBeenCalled();
		await expect(args.onComplete).not.toHaveBeenCalled();
	},
};

export const PausedReveal: Story = {
	args: { restrictToCardIds: ["bayes-prior"], defaultShaderPreset: "still" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox", { name: "Auto-reveal answer" }));
		await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "10s" }));
		await userEvent.click(canvas.getByRole("button", { name: "Pause reveal timer" }));
		await expect(canvas.getByRole("button", { name: "Resume reveal timer" })).toBeEnabled();
		await expect(canvas.queryByRole("button", { name: /^Good:/ })).not.toBeInTheDocument();
	},
};
