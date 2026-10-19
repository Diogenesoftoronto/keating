import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { initialSrsState, validatePortableLearnerData, type PortableLearnerData } from "@keating/learner-contracts";
import { createDeck, createDeckWithCards } from "../src/lib/learner-decks";
import { stableRelatedId } from "../src/lib/learner-repository/ids";

const NOW = "2026-08-10T12:00:00.000Z";

function source(): PortableLearnerData {
  return {
    generatedAt: NOW,
    sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [],
    cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
  };
}

// Pre-extraction algorithm, expressed independently to pin persisted identities.
function previousRelatedId(prefix: string, parts: string[]): string {
  const raw = [prefix, parts.join(".")].join(".");
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw)) return raw;
  const hash = Array.from(raw).reduce((value, character) =>
    Math.imul(value ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0, 2166136261);
  const suffix = hash.toString(16).padStart(8, "0");
  return raw.substring(0, 110).replace(/[^A-Za-z0-9._-]/g, "-") + "." + suffix;
}

const text = fc.string({ maxLength: 30 });
const title = fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value.trim().length > 0);
const arbitraryPart = fc.oneof(fc.string({ maxLength: 250 }), fc.constantFrom("😀", "é", "a/b", "bad id", "漢字"));

function outcome(action: () => PortableLearnerData): unknown {
  try { return action(); } catch (error) { return (error as Error).message; }
}

describe("mobile local dedupe properties", () => {
  test("related IDs retain the exact legacy output for arbitrary strings and lengths", () => {
    fc.assert(fc.property(arbitraryPart, fc.array(arbitraryPart, { maxLength: 5 }), (prefix, parts) => {
      expect(stableRelatedId(prefix, ...parts)).toBe(previousRelatedId(prefix, parts));
    }), { numRuns: 400 });
  });

  test("empty deck creation paths have identical results and errors", () => {
    fc.assert(fc.property(text, text, text, (id, title, topic) => {
      const input = { id, title, topic, createdAt: NOW };
      expect(outcome(() => createDeck(source(), input)))
        .toEqual(outcome(() => createDeckWithCards(source(), { ...input, cards: [] })));
    }), { numRuns: 200 });
  });

  test("complete deck creation is valid, atomic, retryable, and isolates authored tags", () => {
    fc.assert(fc.property(title, title, fc.array(title, { maxLength: 5 }), (deckTitle, front, tags) => {
      const data = source();
      const before = structuredClone(data);
      const input = {
        id: "deck-new", title: deckTitle, topic: "topic", createdAt: NOW,
        cards: [{ id: "card-new", front, back: "answer", tags }],
      };
      const result = createDeckWithCards(data, input);
      expect(validatePortableLearnerData(result)).toBe(true);
      expect(result.decks[0]?.cards[0]).toEqual({ ...input.cards[0], srs: initialSrsState(NOW) });
      expect(createDeckWithCards(result, input)).toBe(result);
      expect(() => createDeckWithCards(result, { ...input, title: deckTitle + " changed" })).toThrow("identity conflict");
      const originalTags = [...tags];
      tags.push("later");
      expect(result.decks[0]?.cards[0]?.tags).toEqual(originalTags);
      expect(data).toEqual(before);
    }), { numRuns: 150 });
  });
});
