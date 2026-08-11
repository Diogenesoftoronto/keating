import {
  initialSrsState,
  isContractId,
  isContractTimestamp,
  validateFlashcardDeck,
  validatePortableLearnerData,
  type Flashcard,
  type FlashcardDeck,
  type PortableLearnerData,
} from "@keating/learner-contracts";

/**
 * Deck authoring is deliberately a pure transformation. The repository owns
 * transactionality; callers can calculate one complete next snapshot and only
 * publish it after SQLite commits it.
 */

export interface CreateDeckInput {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
}

export interface AddDeckCardInput {
  id: string;
  front: string;
  back: string;
  tags: string[];
}

export interface CreateDeckWithCardsInput extends CreateDeckInput {
  cards: AddDeckCardInput[];
}

export interface EditDeckCardInput {
  front: string;
  back: string;
  tags: string[];
}

function requireSource(data: PortableLearnerData): void {
  if (!validatePortableLearnerData(data)) throw new Error("Cannot mutate invalid portable learner data.");
}

function requireTimestamp(value: string): void {
  if (!isContractTimestamp(value)) throw new Error("Deck mutation requires a canonical UTC timestamp.");
}

function requireResult(data: PortableLearnerData): PortableLearnerData {
  if (!validatePortableLearnerData(data)) throw new Error("Deck mutation would create invalid portable learner data.");
  return data;
}

function requireNewerThan(updatedAt: string, previous: string, operation: string): void {
  const relation = Date.parse(updatedAt) - Date.parse(previous);
  if (relation < 0) throw new Error(`${operation} is stale relative to the deck revision.`);
  if (relation === 0) throw new Error(`${operation} conflicts with the existing deck revision.`);
}

function sameJson(left: unknown, right: unknown): boolean {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (!value || typeof value !== "object") return JSON.stringify(value);
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  };
  return stable(left) === stable(right);
}

function cloneCard(card: Flashcard): Flashcard {
  return structuredClone(card);
}

function findDeck(data: PortableLearnerData, deckId: string): FlashcardDeck {
  const deck = data.decks.find((candidate) => candidate.id === deckId);
  if (!deck) throw new Error(`Deck ${deckId} does not exist.`);
  return deck;
}

function replaceDeck(data: PortableLearnerData, deck: FlashcardDeck, generatedAt: string): PortableLearnerData {
  return requireResult({
    ...data,
    generatedAt,
    decks: data.decks.map((candidate) => candidate.id === deck.id ? deck : structuredClone(candidate)),
  });
}

function changedDeck(deck: FlashcardDeck, updatedAt: string, cards: Flashcard[] = deck.cards): FlashcardDeck {
  const next: FlashcardDeck = {
    ...deck,
    updatedAt,
    cards,
  };
  if (!validateFlashcardDeck(next)) throw new Error("Deck mutation produced an invalid deck.");
  return next;
}

/**
 * Creates a fresh deck at a caller-supplied stable id. Retrying the exact
 * create is a no-op; the same id with any divergent source fails closed.
 */
export function createDeck(data: PortableLearnerData, input: CreateDeckInput): PortableLearnerData {
  requireSource(data);
  requireTimestamp(input.createdAt);
  if (!isContractId(input.id)) throw new Error("Deck creation requires a contract-valid id.");
  const deck: FlashcardDeck = {
    id: input.id,
    title: input.title,
    topic: input.topic,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    cards: [],
  };
  if (!validateFlashcardDeck(deck)) throw new Error("Deck creation input is invalid.");
  const existing = data.decks.find((candidate) => candidate.id === input.id);
  if (existing) {
    if (sameJson(existing, deck)) return data;
    throw new Error(`Deck identity conflict for ${input.id}.`);
  }
  return requireResult({ ...data, generatedAt: input.createdAt, decks: [...data.decks, deck] });
}

/**
 * Creates a complete learner-authored deck in one repository mutation. The
 * deck and every fresh card share the transaction timestamp, so no partially
 * created empty deck can escape if a card is invalid or persistence fails.
 */
export function createDeckWithCards(
  data: PortableLearnerData,
  input: CreateDeckWithCardsInput,
): PortableLearnerData {
  requireSource(data);
  requireTimestamp(input.createdAt);
  if (!isContractId(input.id)) throw new Error("Deck creation requires a contract-valid id.");
  const deck: FlashcardDeck = {
    id: input.id,
    title: input.title,
    topic: input.topic,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    cards: input.cards.map((card) => ({
      id: card.id,
      front: card.front,
      back: card.back,
      tags: structuredClone(card.tags),
      srs: initialSrsState(input.createdAt),
    })),
  };
  if (!validateFlashcardDeck(deck)) throw new Error("Deck creation input is invalid.");
  const existing = data.decks.find((candidate) => candidate.id === input.id);
  if (existing) {
    if (sameJson(existing, deck)) return data;
    throw new Error(`Deck identity conflict for ${input.id}.`);
  }
  return requireResult({ ...data, generatedAt: input.createdAt, decks: [...data.decks, deck] });
}

/**
 * Renames a deck. A retry is recognized by the matching post-condition and
 * revision timestamp; another writer at the same or a newer revision cannot
 * be overwritten silently.
 */
export function renameDeck(
  data: PortableLearnerData,
  deckId: string,
  title: string,
  updatedAt: string,
): PortableLearnerData {
  requireSource(data);
  requireTimestamp(updatedAt);
  const deck = findDeck(data, deckId);
  if (deck.title === title) return data;
  requireNewerThan(updatedAt, deck.updatedAt, "Deck rename");
  return replaceDeck(data, changedDeck({ ...deck, title }, updatedAt, deck.cards.map(cloneCard)), updatedAt);
}

/** Adds one fresh card with canonical immediately-due SRS state. */
export function addDeckCard(
  data: PortableLearnerData,
  deckId: string,
  input: AddDeckCardInput,
  updatedAt: string,
): PortableLearnerData {
  requireSource(data);
  requireTimestamp(updatedAt);
  if (!isContractId(input.id)) throw new Error("Card creation requires a contract-valid id.");
  const deck = findDeck(data, deckId);
  const card: Flashcard = {
    id: input.id,
    front: input.front,
    back: input.back,
    tags: structuredClone(input.tags),
    srs: initialSrsState(updatedAt),
  };
  const existing = deck.cards.find((candidate) => candidate.id === input.id);
  if (existing) {
    if (deck.updatedAt === updatedAt && sameJson(existing, card)) return data;
    throw new Error(`Card identity conflict for ${input.id}.`);
  }
  // Validate the full deck shape, rather than duplicating contract limits here.
  if (!validateFlashcardDeck({ ...deck, cards: [...deck.cards, card], updatedAt })) {
    throw new Error("Card creation input is invalid.");
  }
  requireNewerThan(updatedAt, deck.updatedAt, "Card creation");
  const nextCards = [...deck.cards.map(cloneCard), card];
  return replaceDeck(data, changedDeck(deck, updatedAt, nextCards), updatedAt);
}

/** Edits only learner-authored card content; review state remains immutable evidence. */
export function editDeckCard(
  data: PortableLearnerData,
  deckId: string,
  cardId: string,
  input: EditDeckCardInput,
  updatedAt: string,
): PortableLearnerData {
  requireSource(data);
  requireTimestamp(updatedAt);
  const deck = findDeck(data, deckId);
  const current = deck.cards.find((candidate) => candidate.id === cardId);
  if (!current) throw new Error(`Card ${cardId} does not exist in deck ${deckId}.`);
  const desired = {
    ...current,
    front: input.front,
    back: input.back,
    tags: structuredClone(input.tags),
  };
  if (!validateFlashcardDeck({ ...deck, cards: deck.cards.map((candidate) => candidate.id === cardId ? desired : candidate) })) {
    throw new Error("Card edit input is invalid.");
  }
  if (sameJson(current, desired)) return data;
  requireNewerThan(updatedAt, deck.updatedAt, "Card edit");
  const nextCards = deck.cards.map((candidate) => candidate.id === cardId ? desired : cloneCard(candidate));
  return replaceDeck(data, changedDeck(deck, updatedAt, nextCards), updatedAt);
}

/**
 * Removes one card and its now-dangling review history in the same immutable
 * result. A matching post-delete revision makes a retry a no-op; a missing
 * card under any other revision fails closed.
 */
export function deleteDeckCard(
  data: PortableLearnerData,
  deckId: string,
  cardId: string,
  updatedAt: string,
): PortableLearnerData {
  requireSource(data);
  requireTimestamp(updatedAt);
  const deck = findDeck(data, deckId);
  const current = deck.cards.find((candidate) => candidate.id === cardId);
  if (!current) {
    if (deck.updatedAt === updatedAt && !data.cardReviews.some((review) => review.deckId === deckId && review.cardId === cardId)) return data;
    throw new Error(`Card ${cardId} does not exist in deck ${deckId}.`);
  }
  requireNewerThan(updatedAt, deck.updatedAt, "Card deletion");
  const nextDeck = changedDeck(deck, updatedAt, deck.cards.filter((candidate) => candidate.id !== cardId).map(cloneCard));
  return requireResult({
    ...data,
    generatedAt: updatedAt,
    decks: data.decks.map((candidate) => candidate.id === deckId ? nextDeck : structuredClone(candidate)),
    cardReviews: data.cardReviews.filter((review) => review.deckId !== deckId || review.cardId !== cardId).map((review) => structuredClone(review)),
  });
}
