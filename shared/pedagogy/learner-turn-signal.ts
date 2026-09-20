import type { OutcomeSignal } from "./benchmark-real.js";

/** Existing browser next-turn heuristic, shared without browser, storage or model dependencies.
 * A textual reaction is a proxy; it never establishes mastery or learning effectiveness.
 * Keep negative > confused > positive precedence and the original vocabulary unchanged.
 */
export function classifyLearnerTurnSignal(text: string): OutcomeSignal | null {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 4) return null;
  const lowered = compact.toLowerCase();
  return /\b(wrong|incorrect|not helpful|bad explanation|no,? that's not|still wrong)\b/i.test(lowered) ? "thumbs-down"
    : /\b(confused|lost|stuck|unclear|not sure|don't understand|dont understand|doesn't make sense|doesnt make sense|can you explain|what do you mean|why is|how does)\b/i.test(lowered) ? "confused"
    : /\b(got it|makes sense|i understand|that helps|clear now|yes exactly|correct)\b/i.test(lowered) ? "thumbs-up"
    : null;
}
