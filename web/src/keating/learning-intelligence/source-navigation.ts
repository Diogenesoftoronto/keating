import { learningSourceHash, verifyLearningEvidence, type LearningEvidenceAnchor } from "@keating/learner-contracts";
import { getJudgementDiagnostics, subscribeJudgementDiagnostics } from "../judgement/diagnostics";
import { isPrivateForkContextMessage } from "../private-fork-provenance";

export interface LearningMessageSource { sessionId: string; messageId: string; text: string; sourceHash: string }
type SourceMessage = { id?: unknown; role?: unknown; timestamp?: unknown; content?: unknown; parts?: unknown };
export function learningMessageId(message: unknown, index: number): string {
  const entry = message as SourceMessage;
  if (typeof entry?.id === "string" && entry.id.length > 0 && entry.id.length <= 200) return entry.id;
  return `${entry?.role === "assistant" ? "assistant" : "user"}-${index}-${typeof entry?.timestamp === "number" ? entry.timestamp : ""}`;
}
export function learningMessageText(message: unknown): string {
  const entry = message as SourceMessage;
  const content = entry?.content ?? entry?.parts;
  return typeof content === "string" ? content : Array.isArray(content)
    ? content.flatMap(part => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n\n") : "";
}
export function learningMessageSource(sessionId: string, message: unknown, index: number): LearningMessageSource | null {
  // Shared source material is quoted context, never this learner's evidence.
  if (isPrivateForkContextMessage(message)) return null;
  const entry = message as SourceMessage;
  if (!["user", "user-with-attachments", "assistant"].includes(String(entry?.role))) return null;
  const text = learningMessageText(message);
  return text ? { sessionId, messageId: learningMessageId(message, index), text, sourceHash: learningSourceHash(text) } : null;
}
export function resolveLearningSource(anchor: LearningEvidenceAnchor, session: { id: string; messages: readonly unknown[] } | null): LearningMessageSource | null {
  if (!session || session.id !== anchor.sessionId) return null;
  const matches = session.messages.flatMap((message, index) => {
    const entry = message as SourceMessage;
    return ["user", "user-with-attachments", "assistant"].includes(String(entry?.role)) && learningMessageId(message, index) === anchor.messageId
      ? [{ message, index }] : [];
  });
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  const source = learningMessageSource(session.id, match.message, match.index);
  return source && verifyLearningEvidence(source, anchor) ? source : null;
}

export interface ResolvedLearningPassage { anchor: LearningEvidenceAnchor; source: LearningMessageSource }
let passage: ResolvedLearningPassage | null = null;
const listeners = new Set<() => void>();
export const getLearningPassage = () => {
  const state = getJudgementDiagnostics();
  if (!state.enabled || !state.details) passage = null;
  return passage;
};
export function subscribeLearningPassage(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearLearningPassage() { passage = null; for (const listener of listeners) listener(); }
export function showLearningPassage(anchor: LearningEvidenceAnchor, source: LearningMessageSource) {
  const state = getJudgementDiagnostics();
  if (!state.enabled || !state.details) return null;
  passage = { anchor: { ...anchor }, source: { ...source } }; for (const listener of listeners) listener();
  return passage;
}
subscribeJudgementDiagnostics(() => { const state = getJudgementDiagnostics(); if (!state.enabled || !state.details) clearLearningPassage(); });
export type LearningNavigationResult = "opened" | "stale" | "unavailable" | "superseded" | "busy";
/** React transitions may resolve their launcher before the new conversation attaches. */
export async function waitForLearningSession(targetId: string, dependencies: {
  activeSessionId: () => string;
  ready: () => boolean;
  current: () => boolean;
  onTimeout: () => void;
  timeoutMs?: number;
}): Promise<boolean> {
  const timeout = Math.min(5_000, Math.max(1, dependencies.timeoutMs ?? 5_000)), deadline = Date.now() + timeout;
  while (dependencies.current()) {
    if (dependencies.activeSessionId() === targetId && dependencies.ready()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { if (dependencies.current()) dependencies.onTimeout(); return false; }
    await new Promise(resolve => setTimeout(resolve, Math.min(25, remaining)));
  }
  return false;
}
export function learningPassageExcerpt(text: string, start: number, end: number) {
  // Keep UTF-16 anchor offsets intact and avoid clipping a neighbouring emoji.
  let from = Math.max(0, start - 400), to = Math.min(text.length, end + 400);
  const splits = (offset: number) => /[\uD800-\uDBFF]/.test(text[offset - 1] ?? "") && /[\uDC00-\uDFFF]/.test(text[offset] ?? "");
  if (splits(from)) from++;
  if (splits(to)) to--;
  return { before: `${from ? "…" : ""}${text.slice(from, start)}`, quote: text.slice(start, end), after: `${text.slice(end, to)}${to < text.length ? "…" : ""}` };
}
export async function openLearningSource(anchor: LearningEvidenceAnchor, dependencies: {
  read: (sessionId: string) => Promise<{ id: string; messages: readonly unknown[] } | null>;
  activeSessionId: () => string;
  load: (sessionId: string) => Promise<void>;
  current: () => boolean;
  hasPanel?: () => boolean;
  isStreaming?: () => boolean;
  beforeReveal?: () => void;
  reveal: (anchor: LearningEvidenceAnchor, source: LearningMessageSource) => Promise<boolean>;
}): Promise<LearningNavigationResult> {
  if (dependencies.hasPanel && !dependencies.hasPanel()) return "unavailable";
  if (dependencies.activeSessionId() !== anchor.sessionId && dependencies.isStreaming?.()) return "busy";
  const session = await dependencies.read(anchor.sessionId);
  if (!dependencies.current()) return "superseded";
  if (!resolveLearningSource(anchor, session)) return "stale";
  if (dependencies.hasPanel && !dependencies.hasPanel()) return "unavailable";
  if (dependencies.activeSessionId() !== anchor.sessionId) {
    if (dependencies.isStreaming?.()) return "busy";
    await dependencies.load(anchor.sessionId);
  }
  if (!dependencies.current()) return "superseded";
  if (dependencies.activeSessionId() !== anchor.sessionId) return "unavailable";
  const source = resolveLearningSource(anchor, await dependencies.read(anchor.sessionId));
  if (!dependencies.current()) return "superseded";
  if (!source) return "stale";
  dependencies.beforeReveal?.();
  return await dependencies.reveal(anchor, source) ? "opened" : "unavailable";
}

function learningElementIsVisible(target: HTMLElement): boolean {
  if (target.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
  }
  return [...target.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
}
/** Hidden third-party dialogs do not block navigation; visible modals still own focus. */
export function learningPassageCanReceiveFocus(mark: HTMLElement): boolean {
  if ([...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], dialog[open]')].some(learningElementIsVisible)) return false;
  return learningElementIsVisible(mark);
}
export function learningPassageIsFocused(mark: HTMLElement): boolean {
  if (document.activeElement !== mark || !learningPassageCanReceiveFocus(mark)) return false;
  const rect = mark.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

export async function revealLearningPassage(anchor: LearningEvidenceAnchor, source: LearningMessageSource, current: () => boolean): Promise<boolean> {
  const selected = showLearningPassage(anchor, source);
  if (!selected) return false;
  let opened = false;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!current()) return false;
      const matches = [...document.querySelectorAll<HTMLElement>("[data-learning-message-ids]")].filter(element => {
        try { return element.dataset.learningSessionId === anchor.sessionId && JSON.parse(element.dataset.learningMessageIds ?? "[]").includes(anchor.messageId); }
        catch { return false; }
      });
      if (matches.length > 1) return false;
      const mark = matches[0]?.querySelector<HTMLElement>("[data-learning-exact-passage]");
      if (mark && mark.textContent === anchor.quote && learningPassageCanReceiveFocus(mark)) {
        mark.scrollIntoView({ block: "center", behavior: "auto" });
        mark.focus({ preventScroll: true });
        if (learningPassageIsFocused(mark)) { opened = true; return true; }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  } finally {
    if (!opened && passage === selected) clearLearningPassage();
  }
}
export const LEARNING_SOURCE_NAVIGATE = "keating:learning-source-navigate";
export interface LearningNavigationRequest { anchor: LearningEvidenceAnchor; signal: AbortSignal; resolve: (result: LearningNavigationResult) => void }
let navigationFeedback = "";
let navigationSequence = 0;
const feedbackListeners = new Set<() => void>();
export const getLearningNavigationFeedback = () => navigationFeedback;
export function subscribeLearningNavigationFeedback(listener: () => void) { feedbackListeners.add(listener); return () => { feedbackListeners.delete(listener); }; }
export function setLearningNavigationFeedback(message: string) { navigationFeedback = message; for (const listener of feedbackListeners) listener(); }
export function learningNavigationMessage(result: LearningNavigationResult): string {
  return result === "opened" ? "Opened the exact passage in its source conversation." : result === "stale" ? "This message changed or was removed. The captured source link was cleared." : result === "busy" ? "Wait for the current reply to finish before opening another conversation." : result === "superseded" ? "A newer navigation took priority." : "The original passage could not be opened. Try again from Chat.";
}
export function navigateLearningSource(anchor: LearningEvidenceAnchor, options: { timeoutMs?: number } = {}): Promise<LearningNavigationResult> {
  const sequence = ++navigationSequence;
  setLearningNavigationFeedback("");
  return new Promise(resolve => {
    if (typeof window === "undefined") { setLearningNavigationFeedback(learningNavigationMessage("unavailable")); resolve("unavailable"); return; }
    const controller = new AbortController();
    let done = false;
    const finish = (result: LearningNavigationResult) => { if (done) return; done = true; clearTimeout(timer); if (sequence === navigationSequence) setLearningNavigationFeedback(learningNavigationMessage(result)); resolve(result); };
    const timeoutMs = Math.min(10_000, Math.max(1, Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 10_000));
    const timer = setTimeout(() => { controller.abort(); finish("unavailable"); }, timeoutMs);
    window.dispatchEvent(new CustomEvent<LearningNavigationRequest>(LEARNING_SOURCE_NAVIGATE, { detail: { anchor, signal: controller.signal, resolve: finish } }));
  });
}

/** Map original source identities to their single visible row without guessing between repeated messages. */
export function learningRowSourceIds(rows: readonly { id?: string; role: string; createdAt?: Date; content?: unknown }[], originals: readonly unknown[]): string[][] {
  const ids = rows.map(() => [] as string[]);
  const byId = new Map<string, number[]>(), byTimestamp = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (row.id) byId.set(row.id, [...(byId.get(row.id) ?? []), index]);
    if (row.createdAt) {
      const key = `${row.role}:${row.createdAt.getTime()}`;
      byTimestamp.set(key, [...(byTimestamp.get(key) ?? []), index]);
    }
  });
  originals.forEach((message, index) => {
    const entry = message as SourceMessage;
    if (!["user", "user-with-attachments", "assistant"].includes(String(entry?.role))) return;
    const id = learningMessageId(message, index), text = learningMessageText(message);
    const role = entry.role === "assistant" ? "assistant" : "user";
    // Legacy visible row indices differ after filtering. Their generated ids
    // must never impersonate an original message's fallback id.
    let candidates = typeof entry.id === "string" ? byId.get(entry.id) ?? [] : [];
    if (!candidates.length && typeof entry.timestamp === "number") candidates = (byTimestamp.get(`${role}:${entry.timestamp}`) ?? [])
      .filter(rowIndex => !text || learningMessageText(rows[rowIndex]).includes(text));
    if (!candidates.length && text) candidates = rows.flatMap((row, rowIndex) => row.role === role && learningMessageText(row).includes(text) ? [rowIndex] : []);
    if (candidates.length === 1) ids[candidates[0]!]!.push(id);
  });
  return ids;
}
