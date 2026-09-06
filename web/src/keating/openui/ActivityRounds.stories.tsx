import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UiDocument, UiDocumentNode } from "@keating/learner-contracts";
import { expect, userEvent, within } from "storybook/test";
import { SharedUiDocumentRenderer } from "./shared-renderer";

const deck: UiDocumentNode = { type: "deck", id: "recall-round", title: "Small ideas, big systems", topic: "systems", cards: [
	{ id: "cache", front: "What does a cache buy you?", back: "A faster answer, with a chance that it is out of date." },
	{ id: "expiry", front: "What does a short TTL trade away?", back: "Fewer stale answers, but more trips to the source." },
] };
const questions: UiDocumentNode = { type: "question-group", id: "quick-round", title: "Make the connection", questions: [
	{ id: "pick", prompt: "Which is worth caching?", choices: [{ id: "weather", label: "Yesterday's weather" }, { id: "balance", label: "Your current balance" }], hint: "Think about how often the answer changes." },
	{ id: "explain", prompt: "Where would you use a short TTL?", kind: "short_answer" },
] };
const quiz: UiDocumentNode = { type: "quiz", id: "quiz-round", title: "Cache sprint", timeLimit: 0, questions: [
	{ id: "ttl", kind: "multiple_choice", prompt: "What puts a limit on a cached answer?", choices: [{ id: "ttl", label: "Its time to live" }, { id: "size", label: "Its file size" }], correctAnswer: "ttl" },
	{ id: "fresh", kind: "true_false", prompt: "A cached answer is always current.", choices: [{ id: "true", label: "True" }, { id: "false", label: "False" }], correctAnswer: "false" },
] };

function Round({ kind, failFirst = false }: { kind: "deck" | "questions" | "quiz"; failFirst?: boolean }) {
	const [attempts, setAttempts] = useState(0);
	const node = kind === "deck" ? deck : kind === "questions" ? questions : quiz;
	const document: UiDocument = { schemaVersion: 1, id: `round-${kind}`, revision: 0, lifecycle: "ready", supportedSurfaces: ["web"], nodes: [node], createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z" };
	return <div style={{ width: "min(36rem, calc(100vw - 2rem))", margin: "1rem auto" }}>
		<SharedUiDocumentRenderer document={document} onAction={() => { setAttempts((value) => value + 1); return !failFirst || attempts > 0; }} />
	</div>;
}
const meta = { title: "Learning/Activity rounds", component: Round, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Round>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Flashcards: Story = { args: { kind: "deck" } };
export const QuickQuestions: Story = { args: { kind: "questions" } };
export const Quiz: Story = { args: { kind: "quiz" } };
export const QuickQuestionsSaveRecovery: Story = {
	args: { kind: "questions", failFirst: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole("textbox")).toBeNull();
		await userEvent.click(canvas.getByRole("radio", { name: "Yesterday's weather" }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.type(canvas.getByRole("textbox", { name: "Your answer" }), "A live train departure board.");
		await userEvent.click(canvas.getByRole("button", { name: "Finish check" }));
		await expect(canvas.getByRole("textbox")).toBeDisabled();
		await expect(canvas.getByRole("button", { name: "Previous question" })).toBeDisabled();
		await userEvent.click(canvas.getByRole("button", { name: "Retry save answers" }));
		await expect(canvas.getByText("Answers saved.")).toBeVisible();
	},
};
export const FlashcardSaveRecovery: Story = {
	args: { kind: "deck", failFirst: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Reveal answer" }));
		await userEvent.click(canvas.getByRole("button", { name: "Good" }));
		await userEvent.click(canvas.getByRole("button", { name: "Reveal answer" }));
		await userEvent.click(canvas.getByRole("button", { name: "Easy" }));
		await expect(canvas.getByRole("button", { name: "Retry save deck" })).toBeEnabled();
		await userEvent.click(canvas.getByRole("button", { name: "Retry save deck" }));
		await expect(canvas.getByText("Session complete. 2 cards reviewed.")).toBeVisible();
	},
};
export const QuizSaveRecovery: Story = {
	args: { kind: "quiz", failFirst: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("radio", { name: "Its time to live" }));
		await userEvent.click(canvas.getByRole("button", { name: "Next" }));
		await userEvent.click(canvas.getByRole("radio", { name: "False" }));
		await userEvent.click(canvas.getByRole("button", { name: "Review" }));
		await userEvent.click(canvas.getByRole("button", { name: "Submit quiz" }));
		await expect(canvas.getByRole("button", { name: "Retry save quiz" })).toBeEnabled();
		await userEvent.click(canvas.getByRole("button", { name: "Retry save quiz" }));
		await expect(canvas.getByText("Round complete")).toBeVisible();
		await expect(canvas.getByText("2 of 2 scored")).toBeVisible();
	},
};
