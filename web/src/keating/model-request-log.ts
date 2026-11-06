/**
 * Opt-in, in-memory record of what Keating sends to models: each private
 * teaching draft (system prompt, messages, tools and the final provider
 * payload) and each judge request. Off by default; never persisted, and the
 * last entries are dropped as new ones arrive. Credentials travel in request
 * headers, which are not captured.
 */
import type { Context } from "@earendil-works/pi-ai";
import type { JudgementCaller, JudgementRequest } from "@keating/learner-contracts";

const STORAGE_KEY = "keating:model-request-log";
const LIMIT = 30;

export interface ModelRequestEntry {
  readonly id: string;
  readonly at: number;
  readonly sessionId: string;
  readonly kind: "draft" | "judge";
  readonly model: string;
  /** Draft attempt context as Keating composed it. */
  readonly context?: Context;
  /** Provider-shaped request body, before the outermost transport adds web search or audio parts. */
  payload?: unknown;
  readonly judgement?: JudgementRequest;
}

let entries: readonly ModelRequestEntry[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

let enabledState = (() => {
  try { return localStorage.getItem(STORAGE_KEY) === "on"; } catch { return false; }
})();

export function modelRequestLogEnabled(): boolean { return enabledState; }

export function setModelRequestLogEnabled(enabled: boolean): void {
  enabledState = enabled;
  try { if (enabled) localStorage.setItem(STORAGE_KEY, "on"); else localStorage.removeItem(STORAGE_KEY); } catch { /* Storage unavailable. */ }
  if (!enabled) entries = [];
  notify();
}

export function getModelRequestLog(): readonly ModelRequestEntry[] { return entries; }

export function subscribeModelRequestLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearModelRequestLog(): void { entries = []; notify(); }

/** Records an entry when logging is on; returns it so the payload can be attached later. */
export function recordModelRequest(entry: Omit<ModelRequestEntry, "id" | "at">): ModelRequestEntry | undefined {
  if (!modelRequestLogEnabled()) return undefined;
  const recorded: ModelRequestEntry = { ...structuredClone(entry), id: crypto.randomUUID(), at: Date.now() };
  entries = [...entries, recorded].slice(-LIMIT);
  notify();
  return recorded;
}

export function attachModelRequestPayload(entry: ModelRequestEntry | undefined, payload: unknown): void {
  if (!entry) return;
  try { entry.payload = structuredClone(payload); } catch { entry.payload = String(payload); }
  entries = [...entries];
  notify();
}

export function loggingJudge(judge: JudgementCaller, sessionId: string, model: () => string): JudgementCaller {
  return (request, signal) => {
    recordModelRequest({ sessionId, kind: "judge", model: model(), judgement: request });
    return judge(request, signal);
  };
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "__keatingRequests", { configurable: true, get: getModelRequestLog });
}
