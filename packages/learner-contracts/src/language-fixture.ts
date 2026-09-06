import type { UiLanguageRound } from "./ui.js";

export const LANGUAGE_PRACTICE_ROUNDS_FIXTURE: UiLanguageRound[] = [
  { id: "greeting", kind: "translation", prompt: "Say it in Spanish", text: "Good morning", acceptedAnswers: ["Buenos días"], hint: "A greeting for the start of the day." },
  { id: "coffee", kind: "word-order", prompt: "Build: I want a coffee", tokens: [{ id: "coffee", label: "café" }, { id: "a", label: "un" }, { id: "want", label: "Quiero" }], correctOrder: ["want", "a", "coffee"] },
  { id: "hello", kind: "listening", prompt: "Type what you hear", text: "Hola", acceptedAnswers: ["Hola"], referenceAudioUrl: "/audio/language/es-hola.mp3", audioCreditUrl: "/audio/language/README.md" },
  { id: "thanks", kind: "pronunciation", prompt: "Listen. Say it. Compare.", text: "Gracias", referenceAudioUrl: "/audio/language/es-gracias.mp3", audioCreditUrl: "/audio/language/README.md" },
];
