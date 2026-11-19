import { Button, EmptyState, Loading } from "../../../design-system/kit";
/**
 * Flashcard decks (saved and Anki-imported) with the Anki import control, the
 * "keep in review decks" opt-in, and the import notice.
 */
import { KeatingGlyph } from "../../../design-system/glyphs";
import type { RefObject } from "react";
import { css, cx } from "../../../../styled-system/css";
import { ANKI_FILE_ACCEPT } from "../../../courses/course-anki";
import type { FlashcardDeck } from "../../../keating/flashcard-types";
import { choiceClass } from "./styles";

export function DecksSection({
  deckChoices,
  ankiDecks,
  ankiFileName,
  ankiNotice,
  ankiReading,
  keepAnkiDecks,
  selectedDecks,
  ankiInputRef,
  onReadAnki,
  onKeepAnkiDecksChange,
  onToggleDeck,
}: {
  deckChoices: readonly FlashcardDeck[];
  ankiDecks: readonly FlashcardDeck[];
  ankiFileName: string;
  ankiNotice: string;
  ankiReading: boolean;
  keepAnkiDecks: boolean;
  selectedDecks: ReadonlySet<string>;
  ankiInputRef: RefObject<HTMLInputElement | null>;
  onReadAnki(file: File): void;
  onKeepAnkiDecksChange(value: boolean): void;
  onToggleDeck(deckId: string): void;
}) {
  return (
  <section
    className={css({
      mt: "1.25rem",
      borderTop: "1px solid var(--line-soft)",
      pt: "1rem",
    })}
  >
    <div
      className={css({
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "1rem",
      })}
    >
      <h3 data-glyph-host
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.45rem",
        })}
      >
        <KeatingGlyph name="layers" size={17} /> Flashcard decks
      </h3>
      <span
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontFamily: "var(--mono-display)",
          fontSize: "0.65rem",
          color: "var(--ink-soft)",
        })}
      >
        {deckChoices.length}
        <input
          ref={ankiInputRef}
          type="file"
          accept={ANKI_FILE_ACCEPT}
          className={css({ display: "none" })}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onReadAnki(file);
          }}
        />
        <Button variant="line" disabled={ankiReading} onClick={() => ankiInputRef.current?.click()}>
          <KeatingGlyph name="import" size={12} />
          {ankiReading ? <Loading size="inline" label="Reading…" /> : "Import Anki file"}
        </Button>
      </span>
    </div>
    {ankiFileName ? (
      <p
        className={css({
          mt: "0.5rem",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.6rem",
          fontSize: "0.74rem",
          color: "var(--ink-soft)",
        })}
      >
        <span>
          Read {ankiDecks.length} deck
          {ankiDecks.length === 1 ? "" : "s"} from {ankiFileName}
        </span>
        <label
          className={css({
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
          })}
        >
          <input
            type="checkbox"
            checked={keepAnkiDecks}
            onChange={(event) => onKeepAnkiDecksChange(event.target.checked)}
          />
          Keep them in my review decks too
        </label>
      </p>
    ) : null}
    {ankiNotice ? (
      <p
        role="status"
        className={css({
          mt: "0.35rem",
          fontSize: "0.74rem",
          color: "var(--ink-soft)",
        })}
      >
        {ankiNotice}
      </p>
    ) : null}
    {deckChoices.length ? (
      <div
        className={css({
          mt: "0.65rem",
          display: "grid",
          gap: "0.5rem",
          sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
        })}
      >
        {deckChoices.map((deck) => (
          <label
            key={deck.id}
            className={cx(choiceClass, css({ cursor: "pointer" }))}
          >
            <input
              type="checkbox"
              checked={selectedDecks.has(deck.id)}
              onChange={() => onToggleDeck(deck.id)}
            />
            <span>
              <strong
                className={css({
                  display: "block",
                  fontSize: "0.82rem",
                })}
              >
                {deck.title}
              </strong>
              <small className={css({ color: "var(--ink-soft)" })}>
                {deck.cards.length} card
                {deck.cards.length === 1 ? "" : "s"}
                {ankiDecks.some(
                  (candidate) => candidate.id === deck.id,
                )
                  ? ` · from ${ankiFileName}`
                  : ""}
              </small>
            </span>
          </label>
        ))}
      </div>
    ) : (
      <EmptyState className="cb-source-empty k-halftone" heading="No saved decks yet. You can add cards after opening the course." />
    )}
  </section>
  );
}
