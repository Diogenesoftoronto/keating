/**
 * Anki import as onboarding sees it.
 *
 * Two things happen to an imported collection, and they are deliberately
 * separate. The cards go into the learner's SRS through the same merge path the
 * rest of the app uses, so an import during onboarding is no different from an
 * import from the deck page — existing scheduling survives, nothing is
 * duplicated. The deck and tag *names* go somewhere else entirely: onto the
 * review card as interest proposals, where the learner decides whether months of
 * drilling organic chemistry means they want Keating to know they study it.
 *
 * The store is a seam rather than a direct `keatingStorage` import so the whole
 * path is testable without IndexedDB.
 */
import type { ProfileProposal } from "@keating/learner-contracts";
import { mergeAnkiDeck, parseAnkiPackage, parseAnkiText, type AnkiImportResult } from "./anki-package";
import { ankiInterestProposals } from "./anki-interests";
import type { FlashcardDeck } from "./flashcard-types";

/** The slice of deck storage an import needs, and nothing else. */
export interface OnboardingDeckStore {
	getDeck(id: string): Promise<FlashcardDeck | null>;
	saveDeck(deck: FlashcardDeck): Promise<unknown>;
}

export interface OnboardingAnkiImport {
	readonly deckCount: number;
	readonly cardsAdded: number;
	readonly cardsUpdated: number;
	readonly cardsUnchanged: number;
	/** Parser warnings, surfaced rather than swallowed: an import that dropped media should say so. */
	readonly warnings: readonly string[];
	/** Interest candidates for the review card. Never applied here. */
	readonly proposals: readonly ProfileProposal[];
}

/** A file the learner picked, read into memory. `File` is not needed to test this. */
export interface ImportedFile {
	readonly name: string;
	readonly bytes: Uint8Array;
}

function decode(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

/**
 * Read an `.apkg` (or a text/CSV export), merge it into the SRS, and mine the
 * deck and tag names for interests.
 *
 * Throws with the parser's own message when the file is not a collection, so
 * the caller can show it verbatim — "This Anki package is empty." is a better
 * error than anything a wrapper would invent.
 */
export async function importAnkiForOnboarding(
	file: ImportedFile,
	options: { readonly store: OnboardingDeckStore; readonly now?: number; readonly limit?: number },
): Promise<OnboardingAnkiImport> {
	const lower = file.name.toLowerCase();
	const imported: AnkiImportResult = lower.endsWith(".apkg")
		? await parseAnkiPackage(file.bytes, options.now)
		: parseAnkiText(decode(file.bytes), file.name, options.now);

	let added = 0;
	let updated = 0;
	let unchanged = 0;
	for (const incoming of imported.decks) {
		const existing = await options.store.getDeck(incoming.id);
		const merged = mergeAnkiDeck(existing, incoming);
		await options.store.saveDeck(merged.deck);
		added += merged.added;
		updated += merged.updated;
		unchanged += merged.unchanged;
	}

	return Object.freeze({
		deckCount: imported.decks.length,
		cardsAdded: added,
		cardsUpdated: updated,
		cardsUnchanged: unchanged,
		warnings: Object.freeze([...imported.warnings]),
		// Mined from what was in the file, not from what the merge decided to
		// keep: a deck the learner already had still says what they study.
		proposals: ankiInterestProposals(imported.decks, { limit: options.limit }),
	});
}

/** One sentence a learner can read, rather than four counters. */
export function describeAnkiImport(result: OnboardingAnkiImport): string {
	const total = result.cardsAdded + result.cardsUpdated + result.cardsUnchanged;
	const decks = `${result.deckCount} deck${result.deckCount === 1 ? "" : "s"}`;
	const cards = `${total} card${total === 1 ? "" : "s"}`;
	if (result.cardsUpdated === 0 && result.cardsUnchanged === 0) return `Imported ${cards} across ${decks}.`;
	return `Imported ${cards} across ${decks} · ${result.cardsAdded} new, ${result.cardsUpdated} updated, ${result.cardsUnchanged} already up to date.`;
}
