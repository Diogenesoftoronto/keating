import { describe, expect, test } from "bun:test";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
	(globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}

describe("deck tool", () => {
	test("is registered and emits an inline deck payload", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		let savedDeck: any = null;
		const storage = {
			getDeckBySlug: async () => null,
			saveDeck: async (deck: Record<string, unknown>) => {
				savedDeck = {
					...deck,
					id: "deck-1",
					createdAt: 1,
					updatedAt: 2,
				};
				return savedDeck;
			},
		} as any;

		const tools = await createKeatingTools(storage);
		const deckTool = tools.find((tool) => tool.name === "deck");
		expect(deckTool).toBeDefined();

		const result = await deckTool!.execute("tool-call-1", {
			topic: "DNS",
			title: "DNS retrieval deck",
			cards: [
				{ front: "What does a recursive resolver do?", back: "It performs the iterative lookups on the learner's behalf." },
				{ front: "What does the TLD server return?", back: "A referral to the authoritative nameserver for the domain." },
			],
		});

		const text = result.content
			.filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
			.map((entry) => entry.text)
			.join("\n");

		expect(text).toContain("Created deck **DNS retrieval deck** with 2 cards.");
		expect(text).toContain("<keating-deck json=");
		expect(savedDeck).not.toBeNull();
		const cards = (savedDeck?.cards as Array<Record<string, unknown>>) ?? [];
		expect(cards).toHaveLength(2);
		expect(cards[0]?.srs).toMatchObject({
			ease: 2.5,
			intervalDays: 0,
			reps: 0,
			lapses: 0,
			lastReviewedAt: 0,
			lastRating: null,
		});
	});

	test("surfaces underspecified card drafts as tool failures", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		const tools = await createKeatingTools({
			getDeckBySlug: async () => null,
			saveDeck: async () => {
				throw new Error("should not save invalid deck");
			},
		} as any);
		const deckTool = tools.find((tool) => tool.name === "deck");
		expect(deckTool).toBeDefined();

		await expect(
			deckTool!.execute("tool-call-2", {
				topic: "DNS",
				cards: [{ front: "Q?", back: "A." }],
			}),
		).rejects.toThrow("Author at least 2 cards");
	});

	test("grades pending free-text diagnostic checks by exact question", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		const graded: Array<{ id: string; score: number; misconception?: string }> = [];
		const tools = await createKeatingTools({
			getQuestionChecks: async () => [{
				id: "check-1",
				topic: "DNS",
				question: "Why does a recursive resolver cache answers?",
				answer: "It makes DNS faster.",
				grading: "pending",
				createdAt: 1,
			}],
			gradeQuestionCheck: async (id: string, grade: { score: number; misconception?: string }) => {
				graded.push({ id, ...grade });
				return null;
			},
		} as any);
		const tool = tools.find((candidate) => candidate.name === "grade_question_checks");
		expect(tool).toBeDefined();

		const result = await tool!.execute("tool-call-3", {
			topic: "DNS",
			results: [{
				question: "Why does a recursive resolver cache answers?",
				verdict: "partial",
				misconception: "Treats caching as only a speed feature.",
			}],
		});
		const text = result.content
			.filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
			.map((entry) => entry.text)
			.join("\n");

		expect(text).toContain("Recorded 1 graded diagnostic check");
		expect(graded).toEqual([{
			id: "check-1",
			score: 0.5,
			misconception: "Treats caching as only a speed feature.",
		}]);
	});
});
