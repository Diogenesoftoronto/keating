/**
 * Interest signal from an imported Anki collection.
 *
 * What someone has been drilling for months is better evidence of what they
 * want to learn than what they type into a form on their first day. Deck names
 * are hierarchical (`Organic Chemistry::Reactions`), so every segment is a
 * candidate, and card tags carry the same signal at finer grain.
 *
 * This only ever produces proposals for the onboarding review card. An
 * imported deck named `Organic Chemistry` suggests an interest; it does not
 * silently become one.
 */
import type { ProfileProposal } from "@keating/learner-contracts";
import type { FlashcardDeck } from "./flashcard-types";

/**
 * Anki bookkeeping and scheduler vocabulary, not subjects. `Default` is the
 * deck every collection starts with, and the rest are tags Anki or its popular
 * add-ons apply for workflow reasons.
 */
const NOISE = new Set([
  "default", "marked", "leech", "suspended", "buried", "duplicate",
  "untagged", "misc", "miscellaneous", "other", "inbox", "todo", "new",
  "imported", "import", "temp", "test", "cards", "deck", "notes",
]);

const MIN_LABEL_LENGTH = 3;
const MAX_LABEL_LENGTH = 60;

export interface AnkiInterestCandidate {
  /** The label as written, with its original casing preserved. */
  readonly label: string;
  /** How many imported cards sit under this label. Higher is stronger signal. */
  readonly cardCount: number;
  /** Where it came from, for the review card to show. */
  readonly evidence: string;
}

function clean(value: string): string {
  return value.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/**
 * A label worth proposing: a real word, not a number, not scheduler vocabulary.
 * Purely digits (`2024`, `chapter 3`) name an ordering, not a subject.
 */
function usable(label: string): boolean {
  if (label.length < MIN_LABEL_LENGTH || label.length > MAX_LABEL_LENGTH) return false;
  if (NOISE.has(label.toLowerCase())) return false;
  if (!/\p{L}/u.test(label)) return false;
  return !/^(?:\p{L}+\s+)?\d+$/u.test(label);
}

/**
 * Rank candidate interests across imported decks.
 *
 * Deck-name segments and card tags are pooled: a subject that appears both as
 * a deck and as a tag is one candidate with the combined weight, not two.
 * Results are ordered by card count so the review card can show the strongest
 * signal first, with ties broken alphabetically for a stable render.
 */
export function ankiInterestCandidates(decks: readonly FlashcardDeck[]): readonly AnkiInterestCandidate[] {
  const pool = new Map<string, { label: string; cardCount: number; evidence: string }>();

  const add = (raw: string, cardCount: number, evidence: string) => {
    const label = clean(raw);
    if (!usable(label)) return;
    const key = label.toLowerCase();
    const existing = pool.get(key);
    if (existing) existing.cardCount += cardCount;
    else pool.set(key, { label, cardCount, evidence });
  };

  for (const deck of decks) {
    const cards = deck.cards?.length ?? 0;
    for (const segment of (deck.title ?? "").split("::")) {
      add(segment, cards, `Imported Anki deck "${deck.title}"`);
    }
    // Count each tag segment once per card, keeping the first casing seen.
    const tags = new Map<string, { label: string; count: number }>();
    for (const card of deck.cards ?? []) {
      for (const tag of card.tags ?? []) {
        for (const segment of tag.split("::")) {
          const label = clean(segment);
          if (!label) continue;
          const key = label.toLowerCase();
          const existing = tags.get(key);
          if (existing) existing.count += 1;
          else tags.set(key, { label, count: 1 });
        }
      }
    }
    for (const { label, count } of tags.values()) {
      add(label, count, `Tagged on ${count} imported card${count === 1 ? "" : "s"}`);
    }
  }

  return Object.freeze([...pool.values()]
    .sort((left, right) => right.cardCount - left.cardCount || left.label.localeCompare(right.label))
    .map(entry => Object.freeze({ label: entry.label, cardCount: entry.cardCount, evidence: entry.evidence })));
}

/**
 * Turn ranked candidates into review-card proposals.
 *
 * `limit` keeps a large collection from burying the card; a learner importing
 * forty decks should see the strongest handful, not forty checkboxes.
 */
export function ankiInterestProposals(
  decks: readonly FlashcardDeck[],
  options: { readonly limit?: number } = {},
): readonly ProfileProposal[] {
  const limit = Math.max(0, options.limit ?? 8);
  return Object.freeze(ankiInterestCandidates(decks).slice(0, limit).map(candidate => Object.freeze({
    field: "interests" as const,
    value: candidate.label,
    evidence: candidate.evidence,
    confidence: null,
    source: "anki-import" as const,
  })));
}
