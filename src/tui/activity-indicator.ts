import type { TerminalGlyphMode } from "./design-contract.js";

/** What Keating is doing right now, in the order a turn moves through it. */
export type ActivityPhase = "thinking" | "tool" | "responding";

const UNICODE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const ASCII_SPINNER = ["|", "/", "-", "\\"] as const;

const PHASE_LOADER: Readonly<Record<ActivityPhase, Readonly<Record<TerminalGlyphMode, readonly string[]>>>> = {
  thinking: {
    unicode: ["◜", "◠", "◝", "◞", "◡", "◟"],
    ascii: ["o", "O", "0", "O"],
  },
  tool: {
    unicode: ["▱▱▱", "▰▱▱", "▰▰▱", "▰▰▰", "▱▰▰", "▱▱▰"],
    ascii: ["[   ]", "[=  ]", "[== ]", "[===]", "[ ==]", "[  =]"],
  },
  responding: {
    unicode: ["▸  ", " ▸ ", "  ▸", " ▸ "],
    ascii: [">  ", " > ", "  >", " > "],
  },
};

const PHASE_PHRASES: Readonly<Record<ActivityPhase, readonly string[]>> = {
  thinking: [
    "Turning the question over",
    "Looking for the hinge",
    "Testing the first answer",
  ],
  tool: [
    "Checking the record",
    "Following the evidence",
    "Opening the source",
  ],
  responding: [
    "Putting it into words",
    "Laying out the next step",
    "Making the thinking visible",
  ],
};

/** One spinner step per ~80ms reads as motion without shredding the frame budget. */
export const SPINNER_INTERVAL_MS = 80;

export function spinnerFrame(frame: number, glyphMode: TerminalGlyphMode = "unicode"): string {
  const frames = glyphMode === "ascii" ? ASCII_SPINNER : UNICODE_SPINNER;
  return frames[Math.abs(Math.floor(frame)) % frames.length]!;
}

/** A distinct motion grammar makes the current phase legible without color. */
export function activityLoaderFrame(
  phase: ActivityPhase,
  frame: number,
  glyphMode: TerminalGlyphMode = "unicode",
): string {
  const frames = PHASE_LOADER[phase][glyphMode];
  return frames[Math.abs(Math.floor(frame)) % frames.length]!;
}

/** Copy changes slowly enough to be read; it never flickers at spinner speed. */
export function activityPhrase(phase: ActivityPhase, elapsedMs: number): string {
  const phrases = PHASE_PHRASES[phase];
  const phraseIndex = Math.floor(Math.max(0, elapsedMs) / 4_500) % phrases.length;
  return phrases[phraseIndex]!;
}

/** Whole seconds below a minute, then `m:ss` — long turns stay readable. */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

const PHASE_LABEL: Readonly<Record<ActivityPhase, string>> = {
  thinking: "Thinking",
  tool: "Running",
  responding: "Responding",
};

export interface ActivityIndicatorState {
  phase: ActivityPhase;
  /** Tool name shown while `phase` is "tool". */
  detail?: string | undefined;
  elapsedMs: number;
  frame: number;
  glyphMode?: TerminalGlyphMode;
  /** Appended verbatim, e.g. "ctrl+x stops". Omitted when empty. */
  hint?: string;
}

export function activityIndicatorText(state: ActivityIndicatorState): string {
  const glyphMode = state.glyphMode ?? "unicode";
  const label = state.phase === "tool" && state.detail
    ? `${PHASE_LABEL.tool} ${state.detail}`
    : PHASE_LABEL[state.phase];
  const separator = glyphMode === "ascii" ? ": " : " — ";
  const head = `${activityLoaderFrame(state.phase, state.frame, glyphMode)} ${label}${separator}${activityPhrase(state.phase, state.elapsedMs)}`;
  const parts = [head, formatElapsed(state.elapsedMs)];
  if (state.hint) parts.push(state.hint);
  return parts.join("  ·  ");
}
