import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { generateFlashCards, flashcardsToMarkdown, flashcardsToAnki, getMnemonic } from "../src/core/flashcards.js";
import { CANONICAL_TOPICS } from "./helpers.js";

// ─── generateFlashCards properties ──────────────────────────────────────────

test("ALWAYS: generateFlashCards produces at least 1 card (definition)", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      expect(deck.cards.length).toBeGreaterThanOrEqual(1);
    }
  ));
});

test("ALWAYS: card IDs are unique within a deck", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      const ids = deck.cards.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  ));
});

test("ALWAYS: front and back are non-empty", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      for (const card of deck.cards) {
        expect(card.front.length).toBeGreaterThan(0);
        expect(card.back.length).toBeGreaterThan(0);
      }
    }
  ));
});

test("ALWAYS: each card has a valid difficulty", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      const validDifficulties = ["easy", "medium", "hard"];
      for (const card of deck.cards) {
        expect(validDifficulties).toContain(card.difficulty);
      }
    }
  ));
});

test("ALWAYS: each card has a valid source", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      const validSources = ["definition", "intuition", "misconception", "example", "transfer"];
      for (const card of deck.cards) {
        expect(validSources).toContain(card.source);
      }
    }
  ));
});

test("ALWAYS: each card has at least one tag", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      for (const card of deck.cards) {
        expect(card.tags.length).toBeGreaterThanOrEqual(1);
      }
    }
  ));
});

// ─── flashcardsToAnki properties ────────────────────────────────────────────

test("ALWAYS: flashcardsToAnki has no tab characters in front/back content", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      const anki = flashcardsToAnki(deck);
      const lines = anki.split("\n");
      for (const line of lines) {
        const tabCount = (line.match(/\t/g) ?? []).length;
        expect(tabCount).toBe(1);
      }
    }
  ));
});

test("ALWAYS: flashcardsToAnki has one row per card", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      const anki = flashcardsToAnki(deck);
      const lines = anki.split("\n").filter(l => l.length > 0);
      expect(lines.length).toBe(deck.cards.length);
    }
  ));
});

// ─── flashcardsToMarkdown properties ─────────────────────────────────────────

test("ALWAYS: flashcardsToMarkdown is non-empty and contains card content", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const deck = generateFlashCards(topic);
      const md = flashcardsToMarkdown(deck);
      expect(md.length).toBeGreaterThan(50);
      expect(md.includes("Flash Cards")).toBe(true);
    }
  ));
});

// ─── getMnemonic properties ─────────────────────────────────────────────────

test("ALWAYS: getMnemonic returns non-empty for known topics with mnemonics", () => {
  expect(getMnemonic("derivative").length).toBeGreaterThan(0);
  expect(getMnemonic("entropy").length).toBeGreaterThan(0);
  expect(getMnemonic("bayes").length).toBeGreaterThan(0);
  expect(getMnemonic("recursion").length).toBeGreaterThan(0);
});

test("ALWAYS: getMnemonic returns empty string for unknown topics", () => {
  expect(getMnemonic("unknown-topic-xyz")).toBe("");
});
