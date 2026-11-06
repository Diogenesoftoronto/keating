/**
 * Reviewer corrections made in the review view. Draft-check labels are review
 * data only. Memory labels also change the memory bank later turns read, but
 * only for the account that bank belongs to.
 */
import { MEMORY_CATEGORIES, type MemoryCategory, type TeachingPolicyCheck } from "@keating/learner-contracts";
import type { MemoryOverride } from "./memory-admission";
import { judgementLabelId, type DraftCheckVerdict, type JudgementLabelRecord, type MemoryVerdict, type TurnMemoryDecision } from "./turn-records";

export interface JudgementLabelDeps {
  storage: { putJudgementLabel(record: JudgementLabelRecord): Promise<void>; deleteJudgementLabel(id: string): Promise<void> };
  /** The memory account signed in now, or null when unknown. */
  memoryScope: () => Promise<string | null>;
  applyMemory: (scope: string, change: MemoryOverride) => Promise<void>;
  now?: () => number;
}
interface Turn { sessionId: string; assistantTimestamp: number }

export interface MemoryLabelRecord extends JudgementLabelRecord {
  pendingClear?: boolean;
  /** Returned to the review view after a pending clear has completed. */
  cleared?: boolean;
}
interface LabelOperation {
  revision: number;
  tail: Promise<unknown>;
  current?: MemoryLabelRecord | null;
}
const operations = new WeakMap<JudgementLabelDeps["storage"], Map<string, LabelOperation>>();
function operationFor(deps: JudgementLabelDeps, id: string): LabelOperation {
  let labels = operations.get(deps.storage);
  if (!labels) { labels = new Map(); operations.set(deps.storage, labels); }
  let operation = labels.get(id);
  if (!operation) { operation = { revision: 0, tail: Promise.resolve() }; labels.set(id, operation); }
  return operation;
}
function serialize<T>(operation: LabelOperation, work: () => Promise<T>): Promise<T> {
  const result = operation.tail.then(work);
  operation.tail = result.catch(() => {});
  return result;
}

export async function saveCheckLabel(deps: JudgementLabelDeps, turn: Turn, input: {
  attempt: number; check: TeachingPolicyCheck; judge: string | null; verdict: DraftCheckVerdict | null; note?: string; existing?: JudgementLabelRecord;
}): Promise<JudgementLabelRecord | null> {
  const target = { kind: "draft-check" as const, attempt: input.attempt, checkId: input.check.id };
  const id = judgementLabelId(turn.sessionId, turn.assistantTimestamp, target);
  if (!input.verdict) { await deps.storage.deleteJudgementLabel(id); return null; }
  const now = (deps.now ?? Date.now)();
  const note = input.note?.trim().slice(0, 2000);
  const record: JudgementLabelRecord = {
    id, sessionId: turn.sessionId, assistantTimestamp: turn.assistantTimestamp, target,
    model: { status: input.check.status, probability: input.check.probability, judge: input.judge },
    verdict: input.verdict, effect: "none", ...(note ? { note } : {}),
    createdAt: input.existing?.createdAt ?? now, updatedAt: now,
  };
  await deps.storage.putJudgementLabel(record);
  return record;
}

async function applyForScope(deps: JudgementLabelDeps, scope: string, change: MemoryOverride, current = () => true): Promise<JudgementLabelRecord["effect"]> {
  const account = await deps.memoryScope().catch(() => null);
  if (!current()) return "none";
  if (account !== scope) return "pending-account";
  try { await deps.applyMemory(scope, change); return "applied"; } catch { return "failed"; }
}
const changeFor = (label: MemoryLabelRecord): MemoryOverride | null => {
  if (label.target.kind !== "memory-admission") return null;
  if (label.pendingClear) return { kind: "clear", candidateId: label.target.candidateId };
  if (label.verdict === "reject") return { kind: "reject", candidateId: label.target.candidateId };
  return label.candidate && MEMORY_CATEGORIES.includes(label.category as MemoryCategory)
    ? { kind: "admit", candidate: label.candidate, category: label.category as MemoryCategory } : null;
};

export async function saveMemoryLabel(deps: JudgementLabelDeps, turn: Turn, input: {
  decision: TurnMemoryDecision; verdict: MemoryVerdict | null; category?: MemoryCategory; existing?: JudgementLabelRecord;
}): Promise<MemoryLabelRecord | null> {
  const { decision } = input;
  const target = { kind: "memory-admission" as const, candidateId: decision.candidate.id, scope: decision.scope };
  const id = judgementLabelId(turn.sessionId, turn.assistantTimestamp, target);
  const operation = operationFor(deps, id);
  operation.revision += 1;
  return serialize(operation, async () => {
    const existing = operation.current === undefined ? input.existing : operation.current;
    if (!input.verdict) {
      if (!existing) { await deps.storage.deleteJudgementLabel(id); operation.current = null; return null; }
      // Persist the clear before attempting it so account/storage failures can be retried.
      const pending: MemoryLabelRecord = { ...existing, pendingClear: true, effect: "pending-account", updatedAt: (deps.now ?? Date.now)() };
      await deps.storage.putJudgementLabel(pending);
      operation.current = pending;
      const effect = await applyForScope(deps, decision.scope, { kind: "clear", candidateId: decision.candidate.id });
      if (effect !== "applied") {
        const next = { ...pending, effect };
        await deps.storage.putJudgementLabel(next);
        operation.current = next;
        return next;
      }
      await deps.storage.deleteJudgementLabel(id);
      operation.current = null;
      return null;
    }
    if (input.verdict === "admit" && (!decision.candidate.evidence || !input.category)) throw new Error("memory_label_requires_passage");
    const now = (deps.now ?? Date.now)();
    const draft: JudgementLabelRecord = {
      id, sessionId: turn.sessionId, assistantTimestamp: turn.assistantTimestamp, target,
      model: { probability: decision.probability, accepted: decision.accepted, category: decision.category, judge: decision.backend },
      verdict: input.verdict, effect: "none",
      ...(input.verdict === "admit" ? { category: input.category, candidate: structuredClone(decision.candidate) } : {}),
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    const change = changeFor(draft);
    const record = { ...draft, effect: change ? await applyForScope(deps, decision.scope, change) : "failed" as const };
    await deps.storage.putJudgementLabel(record);
    operation.current = record;
    return record;
  });
}

/** Corrections saved while another account was signed in apply once their own account returns. */
export async function retryPendingMemoryLabels(deps: JudgementLabelDeps, labels: readonly JudgementLabelRecord[]): Promise<MemoryLabelRecord[]> {
  const updated: MemoryLabelRecord[] = [];
  for (const label of labels) {
    if (label.target.kind !== "memory-admission" || (label.effect !== "pending-account" && label.effect !== "failed")) continue;
    const operation = operationFor(deps, label.id);
    const revision = operation.revision;
    const scope = label.target.scope;
    await serialize(operation, async () => {
      const current = () => operation.revision === revision && (operation.current === undefined || JSON.stringify(operation.current) === JSON.stringify(label));
      if (!current()) return;
      const change = changeFor(label);
      if (!change) return;
      const effect = await applyForScope(deps, scope, change, current);
      if (!current() || effect === "none") return;
      const next: MemoryLabelRecord = { ...label, effect, updatedAt: (deps.now ?? Date.now)() };
      if (change.kind === "clear" && effect === "applied") {
        await deps.storage.deleteJudgementLabel(label.id);
        operation.current = null;
        updated.push({ ...next, cleared: true });
      } else {
        await deps.storage.putJudgementLabel(next);
        operation.current = next;
        updated.push(next);
      }
    });
  }
  return updated;
}
