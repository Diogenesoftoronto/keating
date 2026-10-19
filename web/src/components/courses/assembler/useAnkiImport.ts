/**
 * Anki file import for the assembler: reads the chosen file, tracks the decks
 * it produced, and reports a one-line notice. The caller supplies, per read,
 * where newly read deck ids and read failures go (`AnkiReadHandlers`), which
 * lets selection and error state be declared after this hook.
 */
import { useRef, useState } from "react";
import { readAnkiFile } from "../../../courses/course-anki";
import type { FlashcardDeck } from "../../../keating/flashcard-types";

export interface AnkiReadHandlers {
  onDecksRead(deckIds: readonly string[]): void;
  onError(message: string): void;
}

export function useAnkiImport() {
  const [ankiNotice, setAnkiNotice] = useState("");
  const [ankiDecks, setAnkiDecks] = useState<FlashcardDeck[]>([]);
  const [ankiFileName, setAnkiFileName] = useState("");
  const [ankiReading, setAnkiReading] = useState(false);
  const [keepAnkiDecks, setKeepAnkiDecks] = useState(true);
  const ankiInputRef = useRef<HTMLInputElement>(null);

  const readAnki = (file: File, { onDecksRead, onError }: AnkiReadHandlers) => {
    setAnkiReading(true);
    onError("");
    setAnkiNotice("");
    void readAnkiFile(file)
      .then((result) => {
        setAnkiDecks(result.decks);
        setAnkiFileName(result.fileName);
        onDecksRead(result.decks.map((deck) => deck.id));
        setAnkiNotice(
          [
            `${result.cardCount} card${result.cardCount === 1 ? "" : "s"} ready from ${result.fileName}.`,
            ...result.warnings,
          ].join(" "),
        );
      })
      .catch((cause) =>
        onError(
          cause instanceof Error
            ? cause.message
            : "That Anki file could not be read.",
        ),
      )
      .finally(() => setAnkiReading(false));
  };

  return {
    ankiDecks,
    ankiFileName,
    ankiNotice,
    ankiReading,
    keepAnkiDecks,
    setKeepAnkiDecks,
    clearAnkiNotice: () => setAnkiNotice(""),
    ankiInputRef,
    readAnki,
  };
}
