import type { GroundedLearningExtraction } from "@keating/learner-contracts";
import type { LearningForecastProposal } from "./forecasts";
import { learningReferenceId } from "./references";

type OutlookStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const browserStorage = (): OutlookStorage | undefined => {
  try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; }
};
const notify = (name: string) => { if (typeof window !== "undefined") window.dispatchEvent(new Event(name)); };

/** Fired when grounded passages for a conversation are saved or erased. */
export const LEARNING_PASSAGES_CHANGED_EVENT = "keating:learning-passages-changed";
export const LEARNING_OUTLOOK_CHANGED_EVENT = "keating:learning-outlook-changed";
export const PLAN_AROUND_CONSTRAINT_EVENT = "keating:plan-around-constraint";

// ── Learner-facing outlook ───────────────────────────────────────────────────

export interface LearningOutlook {
  readonly version: 1;
  readonly at: number;
  /** Fingerprint of the saved outcomes it was computed from; any change makes it stale. */
  readonly historyId: string;
  readonly forecasts: readonly LearningForecastProposal[];
  readonly revisit: readonly { readonly question: string; readonly missedCount: number; readonly attempts: number }[];
}

const OUTLOOK_KEY = "keating:learning-outlook:v1";
/** An outlook is about the next step; after a week it says little. */
export const LEARNING_OUTLOOK_MAX_AGE_MS = 7 * 86_400_000;

export function saveLearningOutlook(outlook: Omit<LearningOutlook, "version">, storage: OutlookStorage | undefined = browserStorage()): void {
  const useful = outlook.forecasts.some(row => typeof row.median === "number") || outlook.revisit.length > 0;
  try {
    if (useful) storage?.setItem(OUTLOOK_KEY, JSON.stringify({ version: 1, ...outlook }));
    else storage?.removeItem(OUTLOOK_KEY);
  } catch { return; }
  notify(LEARNING_OUTLOOK_CHANGED_EVENT);
}

export function clearLearningOutlook(storage: OutlookStorage | undefined = browserStorage()): void {
  try { storage?.removeItem(OUTLOOK_KEY); } catch { return; }
  notify(LEARNING_OUTLOOK_CHANGED_EVENT);
}

/** The saved outlook, only while it still describes the learner's current history. */
export function loadLearningOutlook(currentHistoryId: string, now: number, storage: OutlookStorage | undefined = browserStorage()): LearningOutlook | null {
  try {
    const text = storage?.getItem(OUTLOOK_KEY);
    const value = text && text.length <= 200_000 ? JSON.parse(text) as LearningOutlook : null;
    if (!value || value.version !== 1 || value.historyId !== currentHistoryId || !Number.isFinite(value.at)) return null;
    if (value.at > now || now - value.at > LEARNING_OUTLOOK_MAX_AGE_MS) return null;
    if (!Array.isArray(value.forecasts) || !Array.isArray(value.revisit)) return null;
    return value;
  } catch {
    return null;
  }
}

// ── Deadlines the learner mentioned ──────────────────────────────────────────

/**
 * Constraints Clairic extracted include time budgets and tool limits. Only
 * date-shaped ones become a "plan around this" offer.
 */
const DEADLINE_HINT = new RegExp([
  String.raw`\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b`,
  String.raw`\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b`,
  String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)`,
  String.raw`\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b`,
  String.raw`\b(?:tomorrow|tonight|next\s+(?:week|month|term|semester|year)|end\s+of\s+(?:the\s+)?(?:week|month|term|semester|year))\b`,
  String.raw`\bin\s+(?:a|an|one|two|three|four|five|six|\d+)\s+(?:days?|weeks?|months?)\b`,
  String.raw`\b(?:deadline|due|exam|test|interview|meeting|presentation|submission)\b`,
].join("|"), "i");

export function isDeadlineLike(quote: string): boolean {
  return DEADLINE_HINT.test(quote);
}

type ConstraintAction = "planned" | "dismissed";
const actionsKey = (sessionId: string) => `keating:learning-constraint-actions:v1:${sessionId}`;

function readActions(sessionId: string, storage: OutlookStorage | undefined): Record<string, ConstraintAction> {
  try {
    const value = JSON.parse(storage?.getItem(actionsKey(sessionId)) ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, ConstraintAction> : {};
  } catch {
    return {};
  }
}

export function recordConstraintAction(sessionId: string, referenceId: string, action: ConstraintAction, storage: OutlookStorage | undefined = browserStorage()): void {
  const actions = { ...readActions(sessionId, storage), [referenceId]: action };
  try { storage?.setItem(actionsKey(sessionId), JSON.stringify(actions)); } catch { return; }
  notify(LEARNING_PASSAGES_CHANGED_EVENT);
}

export interface PlannableConstraint { readonly referenceId: string; readonly quote: string }

/** Deadline-shaped constraints Clairic grounded in this learner message, not yet acted on. */
export function plannableConstraints(sessionId: string | undefined, messageIds: readonly string[], messageText: string,
  storage: OutlookStorage | undefined = browserStorage()): PlannableConstraint[] {
  if (!sessionId || !messageIds.length) return [];
  let items: GroundedLearningExtraction[] = [];
  try {
    const value = JSON.parse(storage?.getItem(`keating:learning-evidence:v1:${sessionId}`) ?? "null") as { items?: unknown } | null;
    items = Array.isArray(value?.items) ? value.items as GroundedLearningExtraction[] : [];
  } catch {
    return [];
  }
  const actions = readActions(sessionId, storage);
  const seen = new Set<string>();
  return items.flatMap(item => {
    const anchor = item?.evidence;
    if (item?.kind !== "learning-constraint" || !anchor || anchor.sessionId !== sessionId || !messageIds.includes(anchor.messageId)) return [];
    // The learner's own words, still present in the message they belong to.
    if (typeof anchor.quote !== "string" || !anchor.quote.trim() || anchor.quote.length > 600 || !messageText.includes(anchor.quote)) return [];
    const referenceId = learningReferenceId(anchor);
    if (actions[referenceId] || seen.has(referenceId) || !isDeadlineLike(anchor.quote)) return [];
    seen.add(referenceId);
    return [{ referenceId, quote: anchor.quote }];
  });
}

/** The learner's own request, sent only when they choose to plan around it. */
export function constraintPlanningMessage(quote: string): string {
  return `Please plan around something I mentioned: “${quote}”. If it's a deadline or date, add it as the target date on the goal or study plan it belongs to (or set up a goal for it), work out what I should do before then, and tell me what you changed.`;
}
