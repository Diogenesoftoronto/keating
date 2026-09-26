import { describe, expect, test } from "bun:test";
import { describeAnkiImport, importAnkiForOnboarding, type OnboardingDeckStore } from "../keating/onboarding-anki-import";
import { mergeProposals } from "../components/ChatOnboarding";
import type { Flashcard, FlashcardDeck } from "../keating/flashcard-types";

const SRS = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt: 0, lastReviewedAt: 0, lastRating: null };

function card(id: string, tags: string[] = []): Flashcard {
	return { id, front: `front ${id}`, back: `back ${id}`, tags, srs: { ...SRS }, createdAt: 0, updatedAt: 0 };
}

function deck(title: string, cards: Flashcard[]): FlashcardDeck {
	return { id: `deck-${title}`, topic: title, slug: title.toLowerCase(), title, cards, createdAt: 0, updatedAt: 0 };
}

/** An in-memory stand-in for deck storage, so the whole path runs without IndexedDB. */
function memoryStore(seed: FlashcardDeck[] = []): OnboardingDeckStore & { saved: FlashcardDeck[] } {
	const decks = new Map(seed.map(entry => [entry.id, entry]));
	const saved: FlashcardDeck[] = [];
	return {
		saved,
		async getDeck(id) { return decks.get(id) ?? null; },
		async saveDeck(entry) { decks.set(entry.id, entry); saved.push(entry); return entry; },
	};
}

/** A tab-separated Anki text export, which `parseAnkiText` reads without a zip. */
const TEXT_EXPORT = "What is an aldehyde?\tA carbonyl with a terminal hydrogen\nWhat is a ketone?\tA carbonyl between two carbons\n";

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

describe("importAnkiForOnboarding", () => {
	test("puts the cards in the SRS and the names on the review card", async () => {
		const store = memoryStore();
		const result = await importAnkiForOnboarding(
			{ name: "Organic Chemistry.txt", bytes: bytes(TEXT_EXPORT) },
			{ store, now: 1_700_000_000_000 },
		);

		// The cards really landed — an import that only proposed interests would
		// have silently dropped the learner's collection.
		expect(store.saved.length).toBe(result.deckCount);
		expect(result.cardsAdded).toBe(2);
		expect(result.proposals.some(proposal => proposal.value === "Organic Chemistry")).toBe(true);
	});

	test("every interest is a proposal, never an applied value", async () => {
		const result = await importAnkiForOnboarding(
			{ name: "Organic Chemistry.txt", bytes: bytes(TEXT_EXPORT) },
			{ store: memoryStore() },
		);
		for (const proposal of result.proposals) {
			expect(proposal.field).toBe("interests");
			expect(proposal.source).toBe("anki-import");
			// Deck names are lifted, not scored, so there is no confidence to report.
			expect(proposal.confidence).toBeNull();
			expect(proposal.evidence.length).toBeGreaterThan(0);
		}
	});

	test("re-importing the same collection updates rather than duplicates", async () => {
		const store = memoryStore();
		const file = { name: "Organic Chemistry.txt", bytes: bytes(TEXT_EXPORT) };
		await importAnkiForOnboarding(file, { store, now: 1 });
		const second = await importAnkiForOnboarding(file, { store, now: 1 });
		expect(second.cardsAdded).toBe(0);
		expect(second.cardsUpdated + second.cardsUnchanged).toBe(2);
	});

	test("an unreadable file reports the parser's own words", async () => {
		await expect(importAnkiForOnboarding(
			{ name: "empty.apkg", bytes: new Uint8Array(0) },
			{ store: memoryStore() },
		)).rejects.toThrow(/empty/iu);
	});

	test("describeAnkiImport counts every card, not just the new ones", () => {
		expect(describeAnkiImport({
			deckCount: 1, cardsAdded: 0, cardsUpdated: 3, cardsUnchanged: 7,
			warnings: [], proposals: [],
		})).toContain("10 cards");
	});
});

describe("mergeProposals", () => {
	const spoken = Object.freeze({ field: "interests" as const, value: "Organic Chemistry", evidence: "I study organic chem", confidence: 0.8, source: "conversation" as const });
	const imported = Object.freeze({ field: "interests" as const, value: "organic chemistry", evidence: 'Imported Anki deck "organic chemistry"', confidence: null, source: "anki-import" as const });
	const other = Object.freeze({ field: "interests" as const, value: "Pharmacology", evidence: "Imported", confidence: null, source: "anki-import" as const });

	test("an interest the learner already stated is not proposed twice", () => {
		const merged = mergeProposals([spoken], [imported, other]);
		expect(merged.map(proposal => proposal.value)).toEqual(["Organic Chemistry", "Pharmacology"]);
	});

	test("imports onto an empty card keep their own order", () => {
		expect(mergeProposals(null, [other, imported]).map(proposal => proposal.value)).toEqual(["Pharmacology", "organic chemistry"]);
	});

	test("duplicates inside one import collapse", () => {
		expect(mergeProposals(null, [imported, imported]).length).toBe(1);
	});
});
