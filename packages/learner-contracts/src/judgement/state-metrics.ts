import type { JudgementRequest } from "./contracts.js";
import type { TeachingPolicyTurn } from "./teaching-policy-types.js";

const REQUEST_OVERHEAD_TOKENS = 512;
export const STATE_SECTION_KEYS = ["learnerMessage", "conversation", "learnerEvidence", "availableTools", "toolResults", "sources", "pendingSubmissions", "activeWork", "reply", "candidates", "other"] as const;
export type StateSectionKey = typeof STATE_SECTION_KEYS[number];
export interface StateSectionSize { readonly bytes: number; readonly entries: number }
/** Serialized sizes and presence flags only. These estimates are not tokenizer counts. */
export interface StateComposition {
  readonly sections: Readonly<Record<StateSectionKey, StateSectionSize>>;
  readonly totalBytes: number;
  readonly estimatedStateTokens: number;
  readonly estimatedRequestTokens: number;
  readonly estimatedStateQuestionTokens: number;
  readonly budgetTokens: number | null;
  readonly fillRatio: number | null;
  readonly pinned: { readonly activeWork: boolean; readonly plan: boolean; readonly focus: boolean; readonly openInteractions: boolean; readonly pendingSubmissions: boolean };
}

export function estimatedTextTokens(value: string): number {
  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;
  for (const character of value) {
    if (character.codePointAt(0)! < 0x80) asciiCharacters++;
    else nonAsciiCharacters++;
  }
  return Math.ceil(asciiCharacters / 3 + nonAsciiCharacters);
}
export function estimatedRequestTokens(request: JudgementRequest): number {
  return estimatedTextTokens(JSON.stringify(request)) + REQUEST_OVERHEAD_TOKENS;
}
export function estimatedStateQuestionTokens(request: JudgementRequest): number {
  const longestQuestion = Math.max(0, ...Object.values(request.questions).map(question => estimatedTextTokens(JSON.stringify(question))));
  return estimatedTextTokens(JSON.stringify(request.state)) + longestQuestion + REQUEST_OVERHEAD_TOKENS;
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bytes = (value: unknown): number => value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
const size = (value: unknown): StateSectionSize => ({ bytes: bytes(value), entries: value === undefined || value === null ? 0 : Array.isArray(value) ? value.length : typeof value === "object" ? Object.keys(value).length : 1 });
export function measureStateComposition(request: JudgementRequest, budgetTokens: number | null): StateComposition {
  const state = record(request.state);
  const turn = record(state.turn);
  const activeWork = record(turn.activeWork);
  const sections = Object.fromEntries(STATE_SECTION_KEYS.map(key => [key, size(key === "reply" || key === "candidates" ? state[key] : key === "other" ? undefined : turn[key])])) as Record<StateSectionKey, StateSectionSize>;
  const totalBytes = bytes(request.state);
  // Includes keys, punctuation, scalar turn metadata, and any unrecognized state.
  sections.other = { bytes: Math.max(0, totalBytes - Object.values(sections).reduce((sum, row) => sum + row.bytes, 0)), entries: Object.keys(state).filter(key => !["turn", "reply", "candidates"].includes(key)).length + Object.keys(turn).filter(key => !(STATE_SECTION_KEYS as readonly string[]).includes(key)).length };
  const estimate = estimatedStateQuestionTokens(request);
  const budget = budgetTokens !== null && Number.isSafeInteger(budgetTokens) && budgetTokens > 0 ? budgetTokens : null;
  return { sections, totalBytes, estimatedStateTokens: estimatedTextTokens(JSON.stringify(request.state)), estimatedRequestTokens: estimatedRequestTokens(request), estimatedStateQuestionTokens: estimate, budgetTokens: budget, fillRatio: budget === null ? null : estimate / budget,
    pinned: { activeWork: turn.activeWork !== undefined && turn.activeWork !== null, plan: activeWork.plan != null, focus: activeWork.focus != null, openInteractions: Array.isArray(activeWork.openInteractions) && activeWork.openInteractions.length > 0, pendingSubmissions: Array.isArray(turn.pendingSubmissions) && turn.pendingSubmissions.length > 0 } };
}

/** Rebuild after each complete-turn eviction; only conversation is windowed. */
export function prepareTeachingWindow(turn: TeachingPolicyTurn, build: (turn: TeachingPolicyTurn) => JudgementRequest | null, stateQuestionTokens: number | null): { turn: TeachingPolicyTurn; request: JudgementRequest | null; before: StateComposition | null; after: StateComposition | null; turnsDropped: number } {
  let current = turn;
  let request = build(current);
  const before = request ? measureStateComposition(request, stateQuestionTokens) : null;
  let turnsDropped = 0;
  const budget = before?.budgetTokens ?? null;
  if (request && budget !== null && estimatedStateQuestionTokens(request) >= Math.floor(budget * 0.8)) {
    const target = Math.max(256, Math.floor(budget * 0.65));
    while (current.conversation.length > 0 && estimatedStateQuestionTokens(request) > target) {
      const nextUser = current.conversation.findIndex((message, index) => index > 0 && message.role === "user");
      current = { ...current, conversation: nextUser > 0 ? current.conversation.slice(nextUser) : [] };
      turnsDropped++;
      request = build(current);
      if (!request) break;
    }
  }
  return { turn: current, request, before, after: request ? measureStateComposition(request, stateQuestionTokens) : null, turnsDropped };
}
