/**
 * Flashcard decks (saved and Anki-imported) with the Anki import control, the
 * "keep in review decks" opt-in, and the import notice.
 */
import { Layers3, Upload } from "lucide-react";
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
      borderTop: "1px solid var(--ink)",
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
      <h3
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.45rem",
          fontFamily: "Georgia, serif",
          fontSize: "1.2rem",
        })}
      >
        <Layers3 size={17} /> Flashcard decks
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
        <button
          type="button"
          disabled={ankiReading}
          onClick={() => ankiInputRef.current?.click()}
          className={css({
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            border: "1px solid var(--ink)",
            px: "0.5rem",
            py: "0.3rem",
            fontSize: "0.68rem",
            fontWeight: 750,
            color: "var(--ink)",
            cursor: "pointer",
            _hover: { bg: "var(--course-wash, #ddebdd)" },
            _disabled: { opacity: 0.5 },
          })}
        >
          <Upload size={12} />
          {ankiReading ? "Reading…" : "Import Anki file"}
        </button>
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
      <p
        className={css({
          mt: "0.5rem",
          fontSize: "0.78rem",
          color: "var(--ink-soft)",
        })}
      >
        No saved decks yet. You can add cards after opening the
        course.
      </p>
    )}
  </section>
  );
}
