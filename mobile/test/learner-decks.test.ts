import { describe, expect, test } from "bun:test";
import {
  applyReview,
  initialSrsState,
  validatePortableLearnerData,
  type PortableLearnerData,
} from "@keating/learner-contracts";
import {
  addDeckCard,
  createDeck,
  createDeckWithCards,
  deleteDeckCard,
  editDeckCard,
  renameDeck,
} from "../src/lib/learner-decks";

const CREATED = "2026-08-01T00:00:00.000Z";
const NOW = "2026-08-10T12:00:00.000Z";
const LATER = "2026-08-11T12:00:00.000Z";

function source(overrides: Partial<PortableLearnerData> = {}): PortableLearnerData {
  return {
    generatedAt: CREATED,
    sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [],
    decks: [{
      id: "deck-1", title: "Biology", topic: "Biology", createdAt: CREATED, updatedAt: CREATED,
      cards: [{ id: "card-1", front: "Cell", back: "Unit", tags: ["intro"], srs: initialSrsState(CREATED) }],
    }],
    cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
    ...overrides,
  };
}

describe("portable deck authoring mutations", () => {
  test("creates a contract-valid empty deck exactly once without changing its input", () => {
    const data = source();
    const before = structuredClone(data);
    const input = { id: "deck-new", title: "Linear algebra", topic: "Math", createdAt: NOW };
    const created = createDeck(data, input);
    expect(created).not.toBe(data);
    expect(created.decks.at(-1)).toEqual({ ...input, updatedAt: NOW, cards: [] });
    expect(createDeck(created, input)).toBe(created);
    expect(() => createDeck(created, { ...input, title: "Other" })).toThrow("identity conflict");
    expect(data).toEqual(before);
    expect(validatePortableLearnerData(created)).toBe(true);
  });

  test("creates a complete immediately-due deck atomically at one transaction timestamp", () => {
    const data = source();
    const input = {
      id: "deck-atomic",
      title: "Linear algebra",
      topic: "Matrices",
      createdAt: NOW,
      cards: [
        { id: "card-matrix", front: "What is a matrix?", back: "A rectangular array.", tags: ["definitions"] },
        { id: "card-rank", front: "What is rank?", back: "The dimension of the image.", tags: [] },
      ],
    };
    const created = createDeckWithCards(data, input);
    expect(created.decks.at(-1)?.cards).toEqual(input.cards.map((card) => ({ ...card, srs: initialSrsState(NOW) })));
    expect(createDeckWithCards(created, input)).toBe(created);
    expect(() => createDeckWithCards(data, { ...input, cards: [...input.cards, { ...input.cards[0] }] })).toThrow("invalid");
    expect(() => createDeckWithCards(created, { ...input, title: "Other" })).toThrow("identity conflict");
    expect(validatePortableLearnerData(created)).toBe(true);
  });

  test("renames exactly once, preserves cards, and rejects stale or concurrent writes", () => {
    const data = source();
    const renamed = renameDeck(data, "deck-1", "Cells", NOW);
    expect(renamed.decks[0]).toMatchObject({ title: "Cells", updatedAt: NOW, cards: data.decks[0]?.cards });
    expect(renameDeck(renamed, "deck-1", "Cells", LATER)).toBe(renamed);
    expect(() => renameDeck(renamed, "deck-1", "Different", NOW)).toThrow("conflicts");
    expect(() => renameDeck(renamed, "deck-1", "Different", CREATED)).toThrow("stale");
    expect(validatePortableLearnerData(renamed)).toBe(true);
  });

  test("adds a fresh immediately-due SRS card and recognizes only its exact retry", () => {
    const data = source();
    const input = { id: "card-new", front: "Matrix", back: "Rows and columns", tags: ["math"] };
    const added = addDeckCard(data, "deck-1", input, NOW);
    const card = added.decks[0]?.cards.find((candidate) => candidate.id === input.id);
    expect(card?.srs).toEqual(initialSrsState(NOW));
    expect(added.decks[0]?.updatedAt).toBe(NOW);
    expect(addDeckCard(added, "deck-1", input, NOW)).toBe(added);
    expect(() => addDeckCard(added, "deck-1", { ...input, back: "Changed" }, NOW)).toThrow("identity conflict");
    expect(() => addDeckCard(added, "deck-1", { ...input, id: "card-late" }, CREATED)).toThrow("stale");
    expect(validatePortableLearnerData(added)).toBe(true);
  });

  test("edits authored fields without corrupting reviewed SRS evidence", () => {
    const reviewedSrs = applyReview(initialSrsState(CREATED), 3, NOW).next;
    const data = source({
      generatedAt: NOW,
      decks: [{
        id: "deck-1", title: "Biology", topic: "Biology", createdAt: CREATED, updatedAt: NOW,
        cards: [{ id: "card-1", front: "Cell", back: "Unit", tags: ["intro"], srs: reviewedSrs }],
      }],
      cardReviews: [{
        id: "review-1", deckId: "deck-1", cardId: "card-1", rating: 3, appliedIntervalDays: 1,
        easeAfter: reviewedSrs.ease, previousIntervalDays: 0, nextDueAt: reviewedSrs.dueAt,
        repetitionsAfter: 1, lapsesAfter: 0, isLapse: false, createdAt: NOW,
      }],
    });
    const edited = editDeckCard(data, "deck-1", "card-1", { front: "What is a cell?", back: "Life's basic unit", tags: ["biology", "core"] }, LATER);
    expect(edited.decks[0]?.cards[0]).toMatchObject({ front: "What is a cell?", back: "Life's basic unit", tags: ["biology", "core"], srs: reviewedSrs });
    expect(editDeckCard(edited, "deck-1", "card-1", { front: "What is a cell?", back: "Life's basic unit", tags: ["biology", "core"] }, NOW)).toBe(edited);
    expect(() => editDeckCard(edited, "deck-1", "card-1", { front: "Other", back: "Life's basic unit", tags: ["biology", "core"] }, LATER)).toThrow("conflicts");
    expect(validatePortableLearnerData(edited)).toBe(true);
  });

  test("deletes a card and its dependent reviews atomically, with an exact retry only", () => {
    const reviewedSrs = applyReview(initialSrsState(CREATED), 2, NOW).next;
    const data = source({
      generatedAt: NOW,
      decks: [{
        id: "deck-1", title: "Biology", topic: "Biology", createdAt: CREATED, updatedAt: NOW,
        cards: [{ id: "card-1", front: "Cell", back: "Unit", tags: [], srs: reviewedSrs }, { id: "card-keep", front: "DNA", back: "Code", tags: [], srs: initialSrsState(CREATED) }],
      }],
      cardReviews: [{
        id: "review-delete", deckId: "deck-1", cardId: "card-1", rating: 2, appliedIntervalDays: 1,
        easeAfter: reviewedSrs.ease, previousIntervalDays: 0, nextDueAt: reviewedSrs.dueAt,
        repetitionsAfter: 1, lapsesAfter: 0, isLapse: false, createdAt: NOW,
      }],
    });
    const deleted = deleteDeckCard(data, "deck-1", "card-1", LATER);
    expect(deleted.decks[0]?.cards.map((card) => card.id)).toEqual(["card-keep"]);
    expect(deleted.cardReviews).toEqual([]);
    expect(deleteDeckCard(deleted, "deck-1", "card-1", LATER)).toBe(deleted);
    expect(() => deleteDeckCard(deleted, "deck-1", "card-1", NOW)).toThrow("does not exist");
    expect(validatePortableLearnerData(deleted)).toBe(true);
  });

  test("fails closed before any write for invalid source, input, or target", () => {
    const data = source();
    const before = structuredClone(data);
    expect(() => createDeck(data, { id: "bad id", title: "x", topic: "x", createdAt: NOW })).toThrow("contract-valid id");
    expect(() => addDeckCard(data, "deck-1", { id: "card-2", front: "", back: "x", tags: [] }, "not-a-time")).toThrow("canonical UTC");
    expect(() => editDeckCard(data, "deck-1", "missing", { front: "x", back: "y", tags: [] }, NOW)).toThrow("does not exist");
    expect(() => deleteDeckCard(data, "missing", "card-1", NOW)).toThrow("does not exist");
    expect(data).toEqual(before);
  });
});
