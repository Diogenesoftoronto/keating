import { expect, test } from "bun:test";
import { ankiInterestCandidates, ankiInterestProposals } from "../keating/anki-interests";
import type { FlashcardDeck, Flashcard } from "../keating/flashcard-types";
import { acceptedProfilePatch } from "@keating/learner-contracts";

const card = (id: string, tags: string[] = []): Flashcard => ({
  id, front: `q-${id}`, back: `a-${id}`, tags,
  srs: { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0 } as never,
  createdAt: 1, updatedAt: 1,
});

const deck = (title: string, cards: Flashcard[]): FlashcardDeck => ({
  id: `d-${title}`, topic: title.split("::").at(-1)!, slug: `s-${title}`, title,
  cards, createdAt: 1, updatedAt: 1,
});

test("every segment of a hierarchical deck name becomes a candidate", () => {
  const found = ankiInterestCandidates([deck("Organic Chemistry::Reactions", [card("1"), card("2")])]);
  expect(found.map(c => c.label)).toEqual(["Organic Chemistry", "Reactions"]);
  for (const candidate of found) {
    expect(candidate.cardCount).toBe(2);
    expect(candidate.evidence).toBe('Imported Anki deck "Organic Chemistry::Reactions"');
  }
});

test("card tags contribute, hierarchically, and pool with deck names rather than duplicating", () => {
  const found = ankiInterestCandidates([
    deck("Biology", [card("1", ["Biology::Genetics"]), card("2", ["Genetics"])]),
  ]);
  const labels = found.map(c => c.label);
  expect(labels).toContain("Genetics");
  // "Biology" appears as both a deck name and a tag: one candidate, combined weight.
  expect(labels.filter(l => l.toLowerCase() === "biology")).toHaveLength(1);
  expect(found.find(c => c.label === "Biology")!.cardCount).toBe(3);
});

test("scheduler vocabulary, numbering and stray punctuation are not subjects", () => {
  const found = ankiInterestCandidates([
    deck("Default", [card("1", ["marked", "leech", "2024", "chapter 3", "!!", "ok"])]),
  ]);
  expect(found).toEqual([]);
});

test("underscores and dashes read as words", () => {
  const found = ankiInterestCandidates([deck("organic_chemistry", [card("1", ["cell-biology"])])]);
  expect(found.map(c => c.label).sort()).toEqual(["cell biology", "organic chemistry"]);
});

test("stronger signal sorts first, with a stable alphabetical tiebreak", () => {
  const found = ankiInterestCandidates([
    deck("Physics", [card("1"), card("2"), card("3")]),
    deck("Zoology", [card("4")]),
    deck("Astronomy", [card("5")]),
  ]);
  expect(found.map(c => c.label)).toEqual(["Physics", "Astronomy", "Zoology"]);
});

test("proposals are capped, labelled as imports, and still require an accept", () => {
  const decks = Array.from({ length: 12 }, (_, index) => deck(`Subject${String.fromCharCode(65 + index)}`, [card(`c${index}`)]));
  const proposals = ankiInterestProposals(decks, { limit: 3 });
  expect(proposals).toHaveLength(3);
  for (const proposal of proposals) {
    expect(proposal.field).toBe("interests");
    expect(proposal.source).toBe("anki-import");
    expect(proposal.evidence.length).toBeGreaterThanOrEqual(3);
  }
  // Mined but not accepted: nothing lands.
  expect(acceptedProfilePatch([])).toEqual({});
  expect(acceptedProfilePatch(proposals).interests).toHaveLength(3);
});

test("an empty or cardless collection proposes nothing", () => {
  expect(ankiInterestCandidates([])).toEqual([]);
  expect(ankiInterestProposals([deck("Default", [])])).toEqual([]);
});
