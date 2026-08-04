export type SrsRating = 0 | 1 | 2 | 3;

/** Canonical persisted and runtime SM-2 state for a Keating flashcard. */
export interface CardSrsState {
	ease: number;
	intervalDays: number;
	reps: number;
	lapses: number;
	dueAt: number;
	lastReviewedAt: number;
	lastRating: SrsRating | null;
}

/** Storage-facing compatibility name for the canonical card state. */
export type FlashcardSrsState = CardSrsState;

export interface Flashcard {
	id: string;
	front: string;
	back: string;
	tags?: string[];
	anki?: {
		noteGuid: string;
		noteId: number;
		cardId: number;
		deckId: number;
	};
	srs: CardSrsState;
	createdAt: number;
	updatedAt: number;
}

export interface FlashcardDeck {
	id: string;
	topic: string;
	slug: string;
	title: string;
	description?: string;
	anki?: { deckId: number };
	cards: Flashcard[];
	createdAt: number;
	updatedAt: number;
	sessionId?: string;
}
