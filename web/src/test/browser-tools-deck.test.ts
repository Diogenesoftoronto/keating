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

	test("rejects underspecified card drafts", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		const tools = await createKeatingTools({
			getDeckBySlug: async () => null,
			saveDeck: async () => {
				throw new Error("should not save invalid deck");
			},
		} as any);
		const deckTool = tools.find((tool) => tool.name === "deck");
		expect(deckTool).toBeDefined();

		const result = await deckTool!.execute("tool-call-2", {
			topic: "DNS",
			cards: [{ front: "Q?", back: "A." }],
		});

		const text = result.content
			.filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
			.map((entry) => entry.text)
			.join("\n");

		expect(text).toContain("No template fallback exists.");
		expect(text).toContain("at least 2");
	});
});
