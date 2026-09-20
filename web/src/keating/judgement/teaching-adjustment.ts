import { proposeTeachingAdjustment, teachingAdjustmentInstruction, type TeachingAdjustmentProposal, type JudgementResponse, type CalibrationTable } from "@keating/learner-contracts";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { subscribeJudgementModelSettings } from "../judgement-model";
import { subscribeWebJudgementCalibration } from "./calibration";
import { getJudgementDiagnostics, onJudgementDiagnosticsDisabled } from "./diagnostics";

type Message = { role?: unknown };
type Proposal = Extract<TeachingAdjustmentProposal, { status: "review-required" }>;
export interface TeachingAdjustmentSnapshot {
  sessionId: string;
  status: "empty" | "review" | "queued" | "applying";
  id?: string;
  proposal?: Proposal;
}
const serialize = (value: unknown): string | null => { try { return JSON.stringify(value); } catch { return null; } };
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const isLearner = (message: Message) => message.role === "user" || message.role === "user-with-attachments";

/** Ephemeral explicit acceptance, tied to one agent, reviewed history and next run.
 * Source text never becomes instructions; only a closed code-owned direction does.
 */
export function createTeachingAdjustmentController(options: {
  sessionId: string;
  source: () => { messages: readonly Message[]; current: boolean; streaming: boolean; model: string };
  subscribeInvalidation?: readonly ((listener: () => void) => () => void)[];
  enabled?: () => boolean;
  now?: () => number;
}) {
  let state: TeachingAdjustmentSnapshot = freeze({ sessionId: options.sessionId, status: "empty" });
  let source: { key: string; length: number; model: string; expires: number } | undefined;
  let active: { key: string; length: number; model: string; proposal: Proposal } | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const enabled = options.enabled ?? (() => { const settings = getJudgementDiagnostics(); return settings.enabled && settings.reviewReplies; });
  const now = options.now ?? Date.now;
  const publish = (next: TeachingAdjustmentSnapshot) => {
    state = freeze(next);
    for (const listener of listeners) { try { listener(); } catch { /* Optional inspector cannot interrupt teaching. */ } }
  };
  const cancel = () => { source = undefined; active = undefined; publish({ sessionId: options.sessionId, status: "empty" }); };
  const valid = () => !disposed && enabled() && options.source().current;
  const exact = () => {
    const live = options.source();
    return valid() && !!source && now() < source.expires && !live.streaming
      && live.model === source.model && serialize(live.messages) === source.key;
  };
  const subscriptions = (options.subscribeInvalidation ?? [onJudgementDiagnosticsDisabled,
    subscribeJudgementModelSettings, subscribeWebJudgementCalibration]).map(subscribe => subscribe(cancel));
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    offer(response: JudgementResponse, messages: readonly Message[], replyId: string, calibration?: CalibrationTable) {
      if (!valid() || active) return;
      const live = options.source();
      const key = serialize(messages);
      if (!key || live.streaming || key !== serialize(live.messages)) return;
      const proposal = proposeTeachingAdjustment(response, calibration);
      if (proposal.status !== "review-required") { cancel(); return; }
      source = { key, length: messages.length, model: live.model, expires: now() + 15 * 60_000 };
      publish({ sessionId: options.sessionId, id: replyId, status: "review", proposal });
    },
    accept(id: string): boolean {
      if (state.status !== "review" || state.id !== id || !exact()) { cancel(); return false; }
      publish({ ...state, status: "queued" });
      return true;
    },
    cancel,
    startRun(messages: readonly Message[]) {
      const live = options.source();
      const prefix = source && serialize(messages.slice(0, source.length));
      if (!valid() || state.status !== "queued" || !state.proposal || !source || now() >= source.expires
        || live.model !== source.model || prefix !== source.key || messages.length !== source.length + 1
        || !isLearner(messages[source.length]!)) { cancel(); return; }
      active = { key: serialize(messages)!, length: messages.length, model: source.model, proposal: state.proposal };
      source = undefined;
      publish({ ...state, status: "applying" });
    },
    instruction(): string | undefined {
      if (!active) return;
      const live = options.source();
      if (!valid() || !live.streaming || live.model !== active.model
        || serialize(live.messages.slice(0, active.length)) !== active.key
        || live.messages.slice(active.length).some(isLearner)) { cancel(); return; }
      return "An explicit human review accepted this adjustment for the current reply only. Author your own learner-facing words; this is a fallible review, not a grade or an observed learner fact. Respect the learner's current request and applicable safety instructions. "
        + teachingAdjustmentInstruction(active.proposal.adjustment);
    },
    finishRun: cancel,
    dispose() { disposed = true; cancel(); for (const unsubscribe of subscriptions) unsubscribe(); listeners.clear(); },
  };
}
export type TeachingAdjustmentController = ReturnType<typeof createTeachingAdjustmentController>;

/** Apply only at the provider boundary: never persist or overwrite the base prompt. */
export function withTeachingAdjustment(stream: NonNullable<AgentOptions["streamFn"]>, controller: TeachingAdjustmentController): NonNullable<AgentOptions["streamFn"]> {
  return (model, context, options) => {
    const instruction = controller.instruction();
    return stream(model, instruction ? { ...context, systemPrompt: `${context.systemPrompt ?? ""}\n\n${instruction}` } : context, options);
  };
}
