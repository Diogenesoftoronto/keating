import { MAX_STATE_CHARS, stateCharacterCount, type JudgementRequest } from "./contracts.js";
import type { TeachingPolicyTurn } from "./teaching-policy-types.js";

export const STATE_SECTION_KEYS = ["learnerMessage", "earlierLearnerExcerpts", "conversation", "learnerEvidence", "availableTools", "toolResults", "sources", "pendingSubmissions", "activeWork", "reply", "candidates", "other"] as const;
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

function textWeight(value: string): number {
  let weight = 0;
  for (const character of value) {
    weight += character.codePointAt(0)! < 0x80 ? 1 : 3;
  }
  return weight;
}
export function estimatedTextTokens(value: string): number {
  return Math.ceil(textWeight(value) / 3);
}
export function estimatedRequestTokens(request: JudgementRequest): number {
  return estimatedTextTokens(JSON.stringify(request));
}
export function estimatedStateQuestionTokens(request: JudgementRequest): number {
  const longestQuestion = Math.max(0, ...Object.values(request.questions).map(question => estimatedTextTokens(JSON.stringify(question))));
  return estimatedTextTokens(JSON.stringify(request.state)) + longestQuestion;
}

/** Exact under the same estimator as a serialized one-question batch, including its escaped key. */
function largestSingleRequestTokens(request: JudgementRequest): number {
  const envelope = textWeight(JSON.stringify({ state: request.state, questions: {} }));
  let largestEntry = 0;
  for (const [id, question] of Object.entries(request.questions)) {
    largestEntry = Math.max(largestEntry, textWeight(JSON.stringify(id)) + 1 + textWeight(JSON.stringify(question)));
  }
  return Math.ceil((envelope + largestEntry) / 3);
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

const MAX_EARLIER_EXCERPTS = 2;
const EXCERPT_CHARACTERS = 320;

/** Take the learner's own words from displaced history, in their original order. */
export function earlierLearnerExcerpts(history: TeachingPolicyTurn["conversation"], existing: readonly string[] = []): string[] {
  const excerpts: string[] = [];
  const add = (content: string) => {
    const characters: string[] = [];
    for (const character of content.trim()) {
      if (characters.length === EXCERPT_CHARACTERS) {
        characters[characters.length - 1] = "…";
        break;
      }
      characters.push(character);
    }
    const excerpt = characters.join("");
    if (excerpt && !excerpts.includes(excerpt)) excerpts.push(excerpt);
  };
  for (const content of existing) {
    add(content);
    if (excerpts.length === MAX_EARLIER_EXCERPTS) return excerpts;
  }
  for (const message of history) {
    if (message.role === "user") add(message.content.slice(message.learnerTextStart ?? 0));
    if (excerpts.length === MAX_EARLIER_EXCERPTS) break;
  }
  return excerpts;
}

/** Keep a small opening and a contiguous recent conversation beside the full current request. */
export function prepareTeachingWindow(turn: TeachingPolicyTurn, build: (turn: TeachingPolicyTurn) => JudgementRequest | null,
  stateQuestionTokens: number | null, requestTokens: number | null = null, fitsWire?: (request: JudgementRequest) => boolean) {
  const request = build(turn);
  const before = request ? measureStateComposition(request, stateQuestionTokens) : null;
  const budget = before?.budgetTokens ?? Infinity;
  const fits = (candidate: JudgementRequest | null, measured?: StateComposition) => candidate !== null
    && stateCharacterCount(candidate.state) <= MAX_STATE_CHARS
    && (measured?.estimatedStateQuestionTokens ?? estimatedStateQuestionTokens(candidate)) <= budget
    // Question batches share identical state. Only a single question's request can require less history.
    && (requestTokens === null || (measured?.estimatedRequestTokens ?? estimatedRequestTokens(candidate)) <= requestTokens
      || largestSingleRequestTokens(candidate) <= requestTokens)
    && (!fitsWire || fitsWire(candidate) || Object.entries(candidate.questions).every(([id, question]) =>
      fitsWire({ state: candidate.state, questions: { [id]: question } })));
  if (!request || !before || fits(request, before)) {
    return { turn, request, before, after: before, turnsDropped: 0, fitsLimits: request !== null };
  }

  const { conversation, earlierLearnerExcerpts: previousExcerpts, previousQuestionPresentation: linked, ...pinned } = turn;
  const boundaries = [0];
  for (let index = 1; index < conversation.length; index++) {
    if (conversation[index]!.role === "user") boundaries.push(index);
  }
  if (conversation.length) boundaries.push(conversation.length);
  const windowAt = (turnsDropped: number, excerpts: readonly string[] = []) => {
    const start = boundaries[turnsDropped]!;
    const current: TeachingPolicyTurn = {
      ...pinned, conversation: conversation.slice(start),
      ...(excerpts.length ? { earlierLearnerExcerpts: excerpts } : {}),
      ...(linked && linked.assistantTurnIndex >= start && linked.assistantTurnIndex < conversation.length
        ? { previousQuestionPresentation: { ...linked, assistantTurnIndex: linked.assistantTurnIndex - start } } : {}),
    };
    return { turn: current, request: build(current), turnsDropped };
  };
  let upper = boundaries.length - 1;
  let best = windowAt(upper);
  const fitsLimits = fits(best.request);
  if (fitsLimits) {
    // Find the smallest cut with the complete current message, evidence, and recent history.
    let lower = previousExcerpts?.length ? 0 : Math.min(1, upper);
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      const candidate = windowAt(middle);
      if (fits(candidate.request)) {
        upper = middle;
        best = candidate;
      } else {
        lower = middle + 1;
      }
    }

    const dropped = best.turnsDropped;
    const excerpts = earlierLearnerExcerpts(conversation.slice(0, boundaries[dropped]), previousExcerpts);
    if (excerpts.length) {
      const withOpening = windowAt(dropped, excerpts);
      if (fits(withOpening.request)) {
        best = withOpening;
      } else {
        // Spend the remaining room on the beginning of the original request, never another recent turn.
        const characters = excerpts.map(excerpt => Array.from(excerpt));
        let low = 2;
        let high = characters.reduce((count, text) => count + text.length, 0) - 1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const candidate = windowAt(dropped, excerptPrefix(characters, middle));
          if (fits(candidate.request)) {
            best = candidate;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
      }
    }
  }
  return { ...best, before, after: best.request ? measureStateComposition(best.request, stateQuestionTokens) : null, fitsLimits };
}

function excerptPrefix(excerpts: readonly string[][], available: number): string[] {
  const prefix: string[] = [];
  for (const text of excerpts) {
    if (available < text.length) {
      if (available >= 2) prefix.push(text.slice(0, available - 1).join("") + "…");
      break;
    }
    prefix.push(text.join(""));
    available -= text.length;
  }
  return prefix;
}
