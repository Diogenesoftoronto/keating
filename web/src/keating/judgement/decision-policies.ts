import { decisionPolicyFeatures, normalizeDecisionPolicyQuestion, normalizeDecisionPolicyTopic, type DecisionPolicySnapshot, type DecisionPolicyTarget } from "../../../../packages/learner-contracts/src/judgement/decision-policy-data";
import { isVerifiedDecisionPolicy, MAX_DECISION_POLICY_FIT_BYTES, verifyDecisionPolicyText, type VerifiedDecisionPolicy } from "../../../../packages/learner-contracts/src/judgement/decision-policy-fit";
import type { CardReviewRecord, FlashcardDeck, QuestionCheckRecord } from "../storage";
import type { ComingUpItem, ComingUpQueue } from "../coming-up";

export type WebDecisionPolicies = Partial<Record<DecisionPolicyTarget, VerifiedDecisionPolicy>>;
export interface WebDecisionEvidence { checks: QuestionCheckRecord[]; reviews: CardReviewRecord[]; decks: FlashcardDeck[] }
export interface WebDecisionEstimate { value: number; evidenceLabel: string; fileSha256: string; fitSha256: string; domain: string; method: string }
export type WebDecisionEstimates = Partial<Record<DecisionPolicyTarget, WebDecisionEstimate>>;
const DAY = 86_400_000;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const webDecisionPolicyEvidenceLabel = (kind: "observed-binary" | "judgement-probability") => kind === "judgement-probability"
  ? "Synthetic judge-probability fit; no observed learning outcome" : "Recorded-outcome fit; personal calibration unverified";
export async function webDecisionDigest(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
}
interface StoredPolicy { text: string; sha256: string }
export interface WebDecisionPolicyStorage {
  get(target: DecisionPolicyTarget): Promise<StoredPolicy | null>;
  put(target: DecisionPolicyTarget, value: StoredPolicy): Promise<void>;
  remove(target: DecisionPolicyTarget): Promise<void>;
}
export function indexedDbDecisionPolicyStorage(factory: IDBFactory = indexedDB): WebDecisionPolicyStorage {
  const run = async <T>(target: DecisionPolicyTarget, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("keating-decision-policies-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("policies");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Policy database is blocked"));
    });
    try { return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("policies", mode), request = operation(transaction.objectStore("policies"));
      transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    }); } finally { database.close(); }
  };
  return { get: async target => (await run(target, "readonly", store => store.get(target))) ?? null,
    put: async (target, value) => { await run(target, "readwrite", store => store.put(value, target)); },
    remove: async target => { await run(target, "readwrite", store => store.delete(target)); } };
}
const changes = new Set<() => void>();
const revisions: Record<DecisionPolicyTarget, number> = { mastery: 0, retention: 0, urgency: 0 };
export function subscribeWebDecisionPolicies(listener: () => void): () => void { changes.add(listener); return () => { changes.delete(listener); }; }
const notify = () => { for (const listener of changes) listener(); };
/** Imported models never share a table with learner records, grades or the explicit profile. */
export class WebDecisionPolicyStore {
  constructor(private readonly storage: WebDecisionPolicyStorage = indexedDbDecisionPolicyStorage(), private readonly digest = webDecisionDigest) {}
  async load(target: DecisionPolicyTarget): Promise<VerifiedDecisionPolicy | null> {
    const revision = revisions[target];
    try {
      const row = await this.storage.get(target); if (!row) return null;
      const verified = await verifyDecisionPolicyText(row.text, row.sha256, this.digest);
      return revisions[target] === revision && verified.artifact.target === target && verified.artifact.status === "validated" ? verified : null;
    } catch { return null; }
  }
  async import(target: DecisionPolicyTarget, text: string): Promise<VerifiedDecisionPolicy> {
    const revision = ++revisions[target];
    if (text.length > MAX_DECISION_POLICY_FIT_BYTES) throw new Error("Policy file is too large");
    const sha256 = await this.digest(text), verified = await verifyDecisionPolicyText(text, sha256, this.digest);
    if (verified.artifact.target !== target || verified.artifact.status !== "validated" || !verified.artifact.selected) throw new Error("Policy has not passed its target comparison");
    if (revision !== revisions[target]) throw new Error("Policy import was superseded");
    await this.storage.put(target, { text, sha256 }); notify(); return verified;
  }
  async remove(target: DecisionPolicyTarget): Promise<void> { ++revisions[target]; await this.storage.remove(target); notify(); }
}

/** Live web projection: prior recorded responses and current persisted SRS. No fabricated portable history. */
export function webDecisionSnapshot(evidence: WebDecisionEvidence, topic: string, asOf: number): DecisionPolicySnapshot {
  const key = normalizeDecisionPolicyTopic(topic), tasks = new Set<string>();
  const objective = evidence.checks.filter(row => normalizeDecisionPolicyTopic(row.topic) === key && row.createdAt < asOf)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).filter(row => {
      const task = normalizeDecisionPolicyQuestion(row.question);
      if (row.grading !== "auto" || row.score === undefined || !Number.isFinite(row.score) || row.score < 0 || row.score > 1 || !row.answer.trim() || tasks.has(task)) return false;
      tasks.add(task); return true;
    });
  const snapshot: DecisionPolicySnapshot = { topic: key, asOf, objective: objective.length ? { count: objective.length, mean: average(objective.map(row => row.score!)),
    last: objective.at(-1)!.score!, ageDays: (asOf - objective.at(-1)!.createdAt) / DAY, evidenceIds: objective.map(row => row.id) } : null,
    // The adapter does not invent a historical profile. This field is unused by the fitted feature extractor.
    progress: { mastery: null, retention: null, confidence: 0, status: "insufficient" }, cards: [], decks: [], reconstruction: "current-deck-metadata-with-prior-canonical-review-schedules" };
  const history = (rows: CardReviewRecord[]) => {
    const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), last = sorted.at(-1);
    return last ? { priorReviewCount: rows.length, recallRate: average(rows.map(row => Number(row.rating >= 2))), lapseRate: average(rows.map(row => Number(row.rating === 0))),
      lastRating: last.rating / 3, reviewAgeDays: (asOf - last.createdAt) / DAY, intervalDays: last.appliedIntervalDays,
      lastReviewedAt: last.createdAt, evidenceIds: sorted.map(row => row.id) } : null;
  };
  for (const deck of evidence.decks.filter(row => normalizeDecisionPolicyTopic(row.topic) === key && row.createdAt < asOf)) {
    const rows = evidence.reviews.filter(row => row.deckId === deck.id && row.createdAt < asOf && Number.isFinite(row.appliedIntervalDays) && row.appliedIntervalDays >= 0);
    for (const card of deck.cards) {
      const reviews = rows.filter(row => row.cardId === card.id), value = history(reviews), srs = card.srs;
      // A later edit/import or an incomplete review ledger cannot masquerade as the current recorded state.
      if (!value || srs.lastReviewedAt !== value.lastReviewedAt || srs.lastRating !== value.lastRating * 3 || srs.intervalDays !== value.intervalDays
        || !Number.isFinite(srs.dueAt) || reviews.filter(row => row.createdAt === value.lastReviewedAt).length !== 1) continue;
      snapshot.cards.push({ ...value, deckId: deck.id, cardId: card.id, nextDueAt: srs.dueAt });
    }
    const known = snapshot.cards.filter(row => row.deckId === deck.id), value = history(rows);
    if (!value) continue;
    const due = known.filter(row => row.nextDueAt <= asOf), future = known.filter(row => row.nextDueAt > asOf);
    snapshot.decks.push({ ...value, deckId: deck.id, title: deck.title, cardCount: deck.cards.length, knownCardCount: known.length,
      scheduleComplete: deck.cards.length > 0 && known.length === deck.cards.length, dueCount: due.length,
      overdueCount: due.filter(row => row.nextDueAt < asOf - DAY).length, oldestDueDays: due.length ? Math.max(...due.map(row => (asOf - row.nextDueAt) / DAY)) : 0,
      nextDueAt: future.length ? Math.min(...future.map(row => row.nextDueAt)) : null });
  }
  return snapshot;
}
export function webDecisionEstimate(policy: VerifiedDecisionPolicy | undefined, target: DecisionPolicyTarget, snapshot: DecisionPolicySnapshot, selection: { deckId?: string; cardId?: string } = {}): WebDecisionEstimate | null {
  if (!isVerifiedDecisionPolicy(policy) || policy.artifact.target !== target || !policy.artifact.selected) return null;
  const features = decisionPolicyFeatures(snapshot, target, selection), value = features ? policy.predict(features) : null;
  if (value === null) return null;
  return { value, fileSha256: policy.sha256, fitSha256: policy.artifact.fitSha256, domain: policy.artifact.domain, method: policy.artifact.selected,
    evidenceLabel: webDecisionPolicyEvidenceLabel(policy.artifact.dataset.labelKind) };
}
/** Ten percent of stable item identifiers retain baseline positions across reloads and model changes. */
export function webDecisionExploration(id: string): boolean {
  let hash = 2166136261;
  for (const char of `decision-policy-exploration-v1:${id}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 10 === 0;
}
export function projectWebDecisionPolicies(queue: ComingUpQueue, evidence: WebDecisionEvidence, policies: WebDecisionPolicies, now: number): ComingUpQueue {
  const snapshots = new Map<string, DecisionPolicySnapshot>();
  const items = queue.items.map(item => {
    let snapshot = snapshots.get(item.topic); if (!snapshot) { snapshot = webDecisionSnapshot(evidence, item.topic, now); snapshots.set(item.topic, snapshot); }
    const estimates: WebDecisionEstimates = {}, mastery = webDecisionEstimate(policies.mastery, "mastery", snapshot);
    if (mastery) estimates.mastery = mastery;
    if (item.targetType === "deck") {
      const urgency = webDecisionEstimate(policies.urgency, "urgency", snapshot, { deckId: item.targetId }); if (urgency) estimates.urgency = urgency;
      const cards = evidence.decks.find(deck => deck.id === item.targetId)?.cards ?? [];
      const recall = cards.map(card => webDecisionEstimate(policies.retention, "retention", snapshot!, { deckId: item.targetId, cardId: card.id }));
      if (recall.length && recall.every(value => value !== null)) estimates.retention = { ...recall[0]!, value: average(recall.map(value => value!.value)) };
    }
    return { ...item, decisionEstimates: estimates, decisionExploration: webDecisionExploration(item.id) };
  });
  const byId = new Map(items.map(item => [item.id, item]));
  const rerank = (lane: ComingUpItem[]) => {
    const projected = lane.map(item => byId.get(item.id)!);
    const eligible = projected.filter(item => item.targetType === "deck" && item.dueCount > 0 && !item.decisionExploration && item.decisionEstimates.urgency);
    const ranked = [...eligible].sort((a, b) => b.decisionEstimates.urgency!.value - a.decisionEstimates.urgency!.value);
    const ids = new Set(eligible.map(item => item.id)); let next = 0;
    return projected.map(item => ids.has(item.id) ? ranked[next++]! : item);
  };
  const lanes = { focus: rerank(queue.lanes.focus), maintain: rerank(queue.lanes.maintain), low: rerank(queue.lanes.low) };
  return { ...queue, items, lanes, dueDeckIds: [...lanes.focus, ...lanes.maintain, ...lanes.low].filter(item => item.targetType === "deck" && item.dueCount > 0).map(item => item.targetId) };
}
