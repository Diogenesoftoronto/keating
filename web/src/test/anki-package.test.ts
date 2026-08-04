import { describe, expect, it } from "bun:test";

import { ankiHtmlToText, buildAnkiPackage, buildAnkiTsv, mergeAnkiDeck, parseAnkiPackage, parseAnkiText } from "../keating/anki-package";
import type { FlashcardDeck } from "../keating/storage";

const NOW = Date.UTC(2026, 7, 3, 12);

function sampleDeck(): FlashcardDeck {
	return {
		id: "deck-1",
		topic: "Calculus",
		slug: "calculus",
		title: "Calculus::Derivatives",
		description: "Rates of change",
		cards: [
			{ id: "c1", front: "What is a derivative?", back: "An instantaneous rate of change.", tags: ["calculus", "core"], srs: { ease: 2.35, intervalDays: 6, reps: 2, lapses: 1, dueAt: NOW + 2 * 86_400_000, lastReviewedAt: NOW - 4 * 86_400_000, lastRating: 2 }, createdAt: NOW - 10, updatedAt: NOW - 5 },
			{ id: "c2", front: "State the power rule.", back: "d/dx x^n = nx^(n-1)", srs: { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt: NOW, lastReviewedAt: 0, lastRating: null }, createdAt: NOW, updatedAt: NOW },
		],
		createdAt: NOW - 10,
		updatedAt: NOW,
	};
}

describe("Anki package portability", () => {
	it("round-trips decks, tags, and scheduling through a native APKG", async () => {
		const bytes = await buildAnkiPackage([sampleDeck()], NOW);
		const imported = await parseAnkiPackage(bytes, NOW);

		expect(imported.collectionFormat).toBe("collection.anki21");
		expect(imported.cardCount).toBe(2);
		expect(imported.decks[0].title).toBe("Calculus::Derivatives");
		expect(imported.decks[0].cards[0]).toMatchObject({ front: "What is a derivative?", back: "An instantaneous rate of change.", tags: ["calculus", "core"] });
		expect(imported.decks[0].cards[0].srs).toMatchObject({ ease: 2.35, intervalDays: 6, reps: 2, lapses: 1 });
		expect(imported.decks[0].anki?.deckId).toBeNumber();
		expect(imported.decks[0].cards[0].anki?.noteGuid).toBe("keating-c1");

		const secondBytes = await buildAnkiPackage(imported.decks, NOW + 5_000);
		const secondImport = await parseAnkiPackage(secondBytes, NOW + 5_000);
		expect(secondImport.decks[0].anki).toEqual(imported.decks[0].anki);
		expect(secondImport.decks[0].cards.map((card) => card.anki)).toEqual(imported.decks[0].cards.map((card) => card.anki));
	});

	it("turns Anki HTML and cloze notes into inert review text", () => {
		expect(ankiHtmlToText('<div>Rate &amp; change</div><img src="x" alt="diagram">[sound:a.mp3]')).toBe("Rate & change\ndiagram");
		const parsed = parseAnkiText('Front\tBack\tTags\n"<b>Question</b>"\t"Safe <i>answer</i>"\tcore', "cards.tsv", NOW);
		expect(parsed.decks[0].cards[0]).toMatchObject({ front: "Question", back: "Safe answer", tags: ["core"] });
	});

	it("imports CSV quoting and provides a simple TSV fallback export", () => {
		const parsed = parseAnkiText('Front,Back,Tags\n"Comma, question","Line one\nline two","one two"', "cards.csv", NOW);
		expect(parsed.cardCount).toBe(1);
		expect(parsed.decks[0].cards[0].front).toBe("Comma, question");
		expect(buildAnkiTsv(parsed.decks)).toContain("Front\tBack\tTags\tDeck");
	});

	it("merges repeat imports without overwriting newer local review state", () => {
		const existing = sampleDeck();
		const incoming = sampleDeck();
		incoming.cards[0] = { ...incoming.cards[0], back: "Older source answer", updatedAt: NOW - 100 };
		incoming.cards.push({ ...incoming.cards[1], id: "c3", front: "New question", updatedAt: NOW + 1 });
		const merged = mergeAnkiDeck(existing, incoming);
		expect(merged).toMatchObject({ added: 1, updated: 0, unchanged: 2 });
		expect(merged.deck.cards.find((card) => card.id === "c1")?.back).toBe("An instantaneous rate of change.");
	});
});
