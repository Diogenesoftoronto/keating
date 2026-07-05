import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
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
		await userEvent.click(canvas.getByRole("button", { name: /reveal/i }));
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
