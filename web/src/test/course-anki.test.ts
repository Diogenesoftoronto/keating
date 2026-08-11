import { describe, expect, it } from "bun:test";
import {
  ankiDeckTag,
  chunkCourseCards,
  courseCardsFromAnkiDecks,
  mergeAnkiDeckChoices,
  readAnkiFile,
  summarizeAnkiImport,
  withDeckNameTags,
} from "../courses/course-anki";
import type { FlashcardDeck } from "../keating/flashcard-types";

const NOW = Date.UTC(2026, 7, 10, 12);

function deck(
  id = "deck-calculus",
  title = "Calculus::Derivatives",
): FlashcardDeck {
  return {
    id,
    topic: "Calculus",
    slug: "calculus-derivatives",
    title,
    cards: [
      {
        id: "source-card-1",
        front: "What is a derivative?",
        back: "An instantaneous rate of change.",
        tags: ["calculus"],
        anki: {
          noteGuid: "original-note-guid",
          noteId: 11,
          cardId: 22,
          deckId: 33,
        },
        srs: {
          ease: 2.5,
          intervalDays: 4,
          reps: 2,
          lapses: 0,
          dueAt: NOW,
          lastReviewedAt: NOW - 1_000,
          lastRating: 2,
        },
        createdAt: NOW - 2_000,
        updatedAt: NOW,
      },
    ],
    anki: { deckId: 33 },
    createdAt: NOW - 2_000,
    updatedAt: NOW,
  };
}

describe("course Anki imports", () => {
  it("reads text exports without persisting them", async () => {
    const imported = await readAnkiFile(
      new File(
        ["Front\tBack\tTags\nQuestion\tAnswer\tcore recall"],
        "review.tsv",
        { type: "text/tab-separated-values" },
      ),
    );

    expect(imported).toMatchObject({
      fileName: "review.tsv",
      cardCount: 1,
      format: "text",
    });
    expect(imported.decks[0]?.cards[0]).toMatchObject({
      front: "Question",
      back: "Answer",
      tags: ["core", "recall"],
    });
  });

  it("rejects files outside the documented import formats", async () => {
    await expect(
      readAnkiFile(new File(["not cards"], "notes.md")),
    ).rejects.toThrow(/\.apkg/);
  });

  it("adds the leaf deck name as a compact course tag", () => {
    expect(ankiDeckTag("Language::Spanish::Irregular verbs")).toBe(
      "irregular-verbs",
    );
    expect(withDeckNameTags([deck()])[0]?.cards[0]?.tags).toEqual([
      "calculus",
      "derivatives",
    ]);
  });

  it("uses stable source-derived IDs so changed Anki cards update in place", () => {
    const first = courseCardsFromAnkiDecks([deck()]);
    const changed = deck();
    changed.cards[0] = {
      ...changed.cards[0]!,
      back: "The local linear rate of change.",
    };

    const second = courseCardsFromAnkiDecks([changed], {
      existingCards: first.cards,
      capacity: 0,
    });

    expect(second.cards).toHaveLength(1);
    expect(second.cards[0]?.id).toBe(first.cards[0]?.id);
    expect(second.cards[0]?.back).toBe("The local linear rate of change.");
    expect(second.overflow).toBe(0);
  });

  it("deduplicates repeated content and reports the course ceiling", () => {
    const source = deck();
    source.cards.push({
      ...source.cards[0]!,
      id: "source-card-2",
      anki: {
        ...source.cards[0]!.anki!,
        cardId: 23,
        noteGuid: "second-note-guid",
      },
      front: "State the power rule.",
      back: "d/dx x^n = nx^(n-1)",
    });

    const selection = courseCardsFromAnkiDecks([source], {
      existingCards: [
        {
          front: "What is a derivative?",
          back: "An instantaneous rate of change.",
        },
      ],
      capacity: 0,
    });

    expect(selection).toMatchObject({
      cards: [],
      duplicates: 1,
      overflow: 1,
    });
    expect(
      summarizeAnkiImport(
        {
          fileName: "calculus.apkg",
          decks: [source],
          cardCount: 2,
          warnings: [],
          format: "collection.anki21",
        },
        selection,
      ),
    ).toContain("1 over the course card limit");
  });

  it("lets a newly imported version replace a saved deck choice", () => {
    const saved = deck();
    const imported = {
      ...deck(),
      cards: [{ ...deck().cards[0]!, back: "Updated answer" }],
    };

    const choices = mergeAnkiDeckChoices([saved], [imported]);

    expect(choices).toHaveLength(1);
    expect(choices[0]?.cards[0]?.back).toBe("Updated answer");
  });

  it("batches large imports below the course operation limit", () => {
    const cards = Array.from({ length: 1_201 }, (_, index) => index);
    expect(chunkCourseCards(cards).map((batch) => batch.length)).toEqual([
      500, 500, 201,
    ]);
  });
});
