import {
  parseAnkiPackage,
  parseAnkiText,
  type AnkiImportResult,
} from "../keating/anki-package";
import type { Flashcard, FlashcardDeck } from "../keating/flashcard-types";

/** Everything Anki exports that Keating can read. */
export const ANKI_FILE_ACCEPT = ".apkg,.txt,.tsv,.csv";

const MAX_COURSE_CARDS = 10_000;
const MAX_CARDS_PER_OPERATION = 500;

export interface AnkiFileImport {
  fileName: string;
  decks: FlashcardDeck[];
  cardCount: number;
  warnings: string[];
  format: AnkiImportResult["collectionFormat"];
}

export function isAnkiFileName(name: string): boolean {
  return /\.(apkg|txt|tsv|csv)$/i.test(name.trim());
}

/** Read a native package or a text export into decks, without saving anything. */
export async function readAnkiFile(file: File): Promise<AnkiFileImport> {
  if (!isAnkiFileName(file.name)) {
    throw new Error(
      "Choose an Anki .apkg export, or a .txt, .tsv, or .csv card file.",
    );
  }
  const result = file.name.toLowerCase().endsWith(".apkg")
    ? await parseAnkiPackage(new Uint8Array(await file.arrayBuffer()))
    : parseAnkiText(await file.text(), file.name);
  return {
    fileName: file.name,
    decks: result.decks,
    cardCount: result.cardCount,
    warnings: result.warnings,
    format: result.collectionFormat,
  };
}

/**
 * A course tag for an Anki deck. Anki nests decks with "::", and only the leaf
 * is worth carrying: "Spanish::Verbs::Irregular" becomes "irregular".
 */
export function ankiDeckTag(title: string): string {
  const leaf = title.split("::").pop() ?? title;
  return leaf
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Deck-name tags applied in place, for paths that hand whole decks onward. */
export function withDeckNameTags(
  decks: readonly FlashcardDeck[],
): FlashcardDeck[] {
  return decks.map((deck) => {
    const tag = ankiDeckTag(deck.title);
    if (!tag) return deck;
    return {
      ...deck,
      cards: deck.cards.map((card: Flashcard) => ({
        ...card,
        tags: [...new Set([...(card.tags ?? []), tag])].slice(0, 24),
      })),
    };
  });
}

/**
 * Combine persisted and newly imported decks without rendering the same Anki
 * deck twice. The freshly read file wins because it is the version the learner
 * explicitly chose for this course.
 */
export function mergeAnkiDeckChoices(
  saved: readonly FlashcardDeck[],
  imported: readonly FlashcardDeck[],
): FlashcardDeck[] {
  const choices = new Map(saved.map((deck) => [deck.id, deck]));
  for (const deck of imported) choices.set(deck.id, deck);
  return [...choices.values()];
}

export interface CourseCardDraft {
  id: string;
  front: string;
  back: string;
  tags: string[];
  lessonId?: string;
}

export interface CourseAnkiSelection {
  cards: CourseCardDraft[];
  /** Cards already in the course, or repeated inside the file. */
  duplicates: number;
  /** Cards dropped because the course is at its card ceiling. */
  overflow: number;
}

function fingerprint(front: string, back: string): string {
  return JSON.stringify([
    front.trim().toLowerCase(),
    back.trim().toLowerCase(),
  ]);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function importedCardId(deck: FlashcardDeck, card: Flashcard): string {
  const identity = card.anki?.noteGuid
    ? `note:${card.anki.noteGuid}:card:${card.anki.cardId}`
    : card.anki?.cardId !== undefined
      ? `deck:${card.anki.deckId}:card:${card.anki.cardId}`
      : `${deck.id}:${card.id}`;
  return `card_anki_${stableHash(identity)}`;
}

/**
 * Turn parsed Anki decks into course cards, skipping anything the course
 * already holds so a re-import never doubles the deck.
 */
export function courseCardsFromAnkiDecks(
  decks: readonly FlashcardDeck[],
  options: {
    existingCards?: readonly { id?: string; front: string; back: string }[];
    lessonId?: string;
    tagWithDeck?: boolean;
    capacity?: number;
  } = {},
): CourseAnkiSelection {
  const seen = new Set(
    (options.existingCards ?? []).map((card) =>
      fingerprint(card.front, card.back),
    ),
  );
  const existingIds = new Set(
    (options.existingCards ?? []).flatMap((card) =>
      card.id ? [card.id] : [],
    ),
  );
  const capacity = Math.max(
    0,
    options.capacity ?? MAX_COURSE_CARDS - (options.existingCards?.length ?? 0),
  );
  const cards: CourseCardDraft[] = [];
  let duplicates = 0;
  let overflow = 0;
  let newCards = 0;

  for (const deck of decks) {
    const deckTag = options.tagWithDeck === false ? "" : ankiDeckTag(deck.title);
    for (const card of deck.cards) {
      const front = card.front.trim().slice(0, 10_000);
      const back = card.back.trim().slice(0, 20_000);
      if (!front || !back) continue;
      const key = fingerprint(front, back);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      const id = importedCardId(deck, card);
      const updatesExistingCard = existingIds.has(id);
      if (!updatesExistingCard && newCards >= capacity) {
        overflow += 1;
        continue;
      }
      if (!updatesExistingCard) newCards += 1;
      seen.add(key);
      cards.push({
        id,
        front,
        back,
        tags: [
          ...new Set(
            [...(card.tags ?? []), ...(deckTag ? [deckTag] : [])]
              .map((tag) => tag.trim().slice(0, 64))
              .filter(Boolean),
          ),
        ].slice(0, 24),
        ...(options.lessonId ? { lessonId: options.lessonId } : {}),
      });
    }
  }

  return { cards, duplicates, overflow };
}

/** Course operations carry at most 2,000 cards; keep batches well under it. */
export function chunkCourseCards<T>(
  cards: readonly T[],
  size = MAX_CARDS_PER_OPERATION,
): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < cards.length; index += size) {
    batches.push(cards.slice(index, index + size));
  }
  return batches;
}

export function summarizeAnkiImport(
  file: AnkiFileImport,
  selection: CourseAnkiSelection,
): string {
  const parts = [
    `${selection.cards.length} card${selection.cards.length === 1 ? "" : "s"} ready`,
  ];
  if (selection.duplicates)
    parts.push(`${selection.duplicates} already in this course`);
  if (selection.overflow)
    parts.push(`${selection.overflow} over the course card limit`);
  if (file.decks.length > 1) parts.push(`${file.decks.length} decks`);
  return parts.join(" · ");
}
