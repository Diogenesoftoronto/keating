import type { RealLearnerOutcome } from "./types.js";
import { resolveTopic } from "./topics.js";
import { clamp } from "./util.js";
import { feedbackToOutcomeScore } from "./benchmark-real.js";

export interface LearnerTurnSignal {
  topic: string;
  signal: "thumbs-up" | "thumbs-down" | "confused";
  masteryEstimate: number;
  evidence: string;
}

const CONFUSION_PATTERNS = [
  /\b(confused|lost|stuck|unclear|not sure|don't understand|dont understand|doesn't make sense|doesnt make sense)\b/i,
  /\b(can you explain|what do you mean|why is|how does)\b/i
];

const NEGATIVE_PATTERNS = [
  /\b(wrong|incorrect|not helpful|bad explanation|no,? that's not|still wrong)\b/i
];

const POSITIVE_PATTERNS = [
  /\b(got it|makes sense|i understand|that helps|clear now|yes exactly|correct)\b/i
];

export function inferLearnerTurnSignal(
  text: string,
  fallbackTopic = "general"
): LearnerTurnSignal | null {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 4) return null;

  const resolved = resolveTopic(inferTopic(compact, fallbackTopic));
  const signal =
    NEGATIVE_PATTERNS.some((pattern) => pattern.test(compact)) ? "thumbs-down" :
    CONFUSION_PATTERNS.some((pattern) => pattern.test(compact)) ? "confused" :
    POSITIVE_PATTERNS.some((pattern) => pattern.test(compact)) ? "thumbs-up" :
    null;

  if (!signal) return null;

  return {
    topic: resolved.slug,
    signal,
    masteryEstimate: signal === "thumbs-up" ? 0.75 : signal === "confused" ? 0.35 : 0.2,
    evidence: compact.slice(0, 240)
  };
}

export function learnerTurnSignalToOutcome(signal: LearnerTurnSignal, learnerId: string): RealLearnerOutcome {
  return {
    learnerId,
    topic: signal.topic,
    feedbackSignal: signal.signal,
    quizScore: null,
    sessionDurationMs: null,
    masteryEstimate: clamp(signal.masteryEstimate),
    outcomeScore: feedbackToOutcomeScore(signal.signal)
  };
}

function inferTopic(text: string, fallbackTopic: string): string {
  const lowered = text.toLowerCase();
  for (const token of lowered.match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (["confused", "understand", "explain", "wrong", "helpful", "clear", "still"].includes(token)) continue;
    const resolved = resolveTopic(token);
    if (resolved.slug !== token || token === fallbackTopic) return token;
  }
  return fallbackTopic;
}
