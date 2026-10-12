import type { PortableLearnerData } from "@keating/learner-contracts";
import { rankingHoldoutAssignment } from "../../../../packages/learner-contracts/src/judgement/ranking-holdout";
import { DECISION_POLICY_TARGETS, normalizeDecisionPolicyTopic, type DecisionPolicyTarget } from "../../../../packages/learner-contracts/src/judgement/decision-policy-data";
import { onlineDecisionEvidenceId, type OnlineDecisionPrediction } from "../../../../packages/learner-contracts/src/judgement/online-decision-policy";
import type { OnlineLearningResults } from "../../../../shared/online-learning-session";
import type { ComingUp } from "../learner-study";

export const MOBILE_ONLINE_MODELS = [{ id: "v3.5_default", label: "TabPFN 3.5 · Not Organic" }] as const;
export type MobileOnlineModel = "off" | typeof MOBILE_ONLINE_MODELS[number]["id"];
export type MobileActivityLearningMode = "background" | "live";
interface PreferenceStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
const nativeStorage: PreferenceStorage = {
  getItem: async key => (await import("@react-native-async-storage/async-storage")).default.getItem(key),
  setItem: async (key, value) => (await import("@react-native-async-storage/async-storage")).default.setItem(key, value),
};

/** Selection is explicit and local to an account+issuer. Failed storage never silently enables sharing. */
export class MobileOnlineLearningPreferences {
  private revision = 0;
  private choices = new Map<string, MobileOnlineModel>();
  private chatModes = new Map<string, MobileActivityLearningMode>();
  private chatVersions = new Map<string, number>();
  private pending = new Map<string, Promise<void>>();
  private writes = new Map<string, Promise<void>>();
  private versions = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(private storage: PreferenceStorage = nativeStorage) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.revision;
  get = (scope: string | null): MobileOnlineModel => scope ? this.choices.get(scope) ?? "off" : "off";
  chatMode = (scope: string | null): MobileActivityLearningMode => scope ? this.chatModes.get(scope) ?? "background" : "background";
  epoch = (scope: string): string => `${this.versions.get(scope) ?? 0}:${this.chatVersions.get(scope) ?? 0}`;
  loaded = (scope: string | null): boolean => !!scope && this.choices.has(scope);
  private key(scope: string) { return `keating.mobile.online-learning.v1.${encodeURIComponent(scope)}`; }
  private publish() { this.revision++; for (const listener of this.listeners) listener(); }
  async load(scope: string): Promise<void> {
    if (this.choices.has(scope)) return;
    const previous = this.pending.get(scope); if (previous) return previous;
    const work = (async () => {
      try {
        const [choice, mode] = await Promise.all([this.storage.getItem(this.key(scope)), this.storage.getItem(`${this.key(scope)}.chat-mode`)]);
        if (!this.choices.has(scope)) this.choices.set(scope, choice === "v3.5_default" ? choice : "off");
        if (!this.chatModes.has(scope)) this.chatModes.set(scope, mode === "live" ? "live" : "background");
      } catch { if (!this.choices.has(scope)) this.choices.set(scope, "off"); }
      this.publish();
    })();
    this.pending.set(scope, work);
    try { await work; } finally { this.pending.delete(scope); }
  }
  async set(scope: string, model: MobileOnlineModel): Promise<void> {
    if (model !== "off" && !MOBILE_ONLINE_MODELS.some(option => option.id === model)) throw Error("Unknown online learning model.");
    const version = (this.versions.get(scope) ?? 0) + 1; this.versions.set(scope, version);
    // Disabling takes effect before the asynchronous save and immediately invalidates visible results.
    if (model === "off") { this.choices.set(scope, "off"); this.publish(); }
    const write = (this.writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(() => this.storage.setItem(this.key(scope), model));
    this.writes.set(scope, write);
    try {
      await write;
      if (this.versions.get(scope) === version) { this.choices.set(scope, model); this.publish(); }
    } finally { if (this.writes.get(scope) === write) this.writes.delete(scope); }
  }
  async setChatMode(scope: string, mode: MobileActivityLearningMode): Promise<void> {
    if (mode !== "background" && mode !== "live") throw Error("Unknown chat learning mode.");
    const version = (this.chatVersions.get(scope) ?? 0) + 1;
    this.chatVersions.set(scope, version);
    // Leaving live comparisons stops their spending before the storage write finishes.
    if (mode === "background") { this.chatModes.set(scope, mode); this.publish(); }
    const write = (this.writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(() => this.storage.setItem(`${this.key(scope)}.chat-mode`, mode));
    this.writes.set(scope, write);
    try { await write; if (this.chatVersions.get(scope) === version) { this.chatModes.set(scope, mode); this.publish(); } }
    finally { if (this.writes.get(scope) === write) this.writes.delete(scope); }
  }
}
export const mobileOnlineLearningPreferences = new MobileOnlineLearningPreferences();

/** Changes only when usable evidence or the hourly prediction clock changes, never merely on re-export. */
export function mobileOnlineLearningRefreshKey(data: PortableLearnerData, asOf: number): string {
  return DECISION_POLICY_TARGETS.map(target => onlineDecisionEvidenceId(data, target, asOf)).join(":");
}

/** Stale, unsuccessful and differently scoped evidence cannot influence the local learner projection. */
export function mobileOnlinePredictions(data: PortableLearnerData, results: OnlineLearningResults, target: DecisionPolicyTarget, now: number): OnlineDecisionPrediction[] {
  const result = results[target];
  if (!result || result.receipt.status !== "active" || result.receipt.target !== target || !result.receipt.validation?.passed
    || result.receipt.expiresAt <= now || result.receipt.evidenceId !== onlineDecisionEvidenceId(data, target, now)) return [];
  return result.predictions;
}

export function mobileOnlineTopicEstimates(data: PortableLearnerData, results: OnlineLearningResults, topic: string, now: number) {
  const key = normalizeDecisionPolicyTopic(topic);
  const mastery = mobileOnlinePredictions(data, results, "mastery", now).find(row => row.topic === key && !row.deckId && !row.cardId);
  const cards = mobileOnlinePredictions(data, results, "retention", now).filter(row => row.topic === key && row.deckId && row.cardId);
  return { mastery: mastery?.value, retention: cards.length ? { value: cards.reduce((sum, row) => sum + row.value, 0) / cards.length, cards: cards.length } : null };
}

export function mobileOnlineDeckRecall(data: PortableLearnerData, results: OnlineLearningResults, deckId: string, now: number) {
  const cards = mobileOnlinePredictions(data, results, "retention", now).filter(row => row.deckId === deckId && row.cardId);
  return cards.length ? { value: cards.reduce((sum, row) => sum + row.value, 0) / cards.length, cards: cards.length } : null;
}

export function mobileOnlineDeckUrgency(data: PortableLearnerData, results: OnlineLearningResults, deckId: string, scope: string | null, now: number) {
  const prediction = mobileOnlinePredictions(data, results, "urgency", now).find(row => row.deckId === deckId && !row.cardId);
  return prediction && scope ? { value: prediction.value,
    heldOut: rankingHoldoutAssignment("decision-policy-urgency-v1", JSON.stringify([scope, deckId]), 1000).heldOut } : null;
}

/** Preserve learner lanes, non-deck positions, unknown histories and the existing fixed 10% control positions. */
export function applyMobileOnlineUrgency(base: ComingUp, data: PortableLearnerData, results: OnlineLearningResults, scope: string | null, now: number): ComingUp {
  if (!scope) return base;
  const predictions = mobileOnlinePredictions(data, results, "urgency", now);
  if (!predictions.length) return base;
  const values = new Map(predictions.filter(row => row.deckId && !row.cardId).map(row => [row.deckId!, row]));
  const lanes: ComingUp["lanes"] = { focus: [...base.lanes.focus], maintain: [...base.lanes.maintain], low: [...base.lanes.low] };
  for (const lane of Object.values(lanes)) {
    const eligible: number[] = [];
    for (let index = 0; index < lane.length; index++) {
      const item = lane[index]!, prediction = values.get(item.targetId);
      if (item.targetType !== "deck" || item.dueCount < 1 || !prediction || normalizeDecisionPolicyTopic(item.topic) !== prediction.topic) continue;
      if (!rankingHoldoutAssignment("decision-policy-urgency-v1", JSON.stringify([scope, item.targetId]), 1000).heldOut) eligible.push(index);
    }
    const ranked = eligible.map(index => ({ item: lane[index]!, index })).sort((a, b) => values.get(b.item.targetId)!.value - values.get(a.item.targetId)!.value || a.index - b.index);
    eligible.forEach((position, index) => { lane[position] = ranked[index]!.item; });
  }
  const positions = { focus: 0, maintain: 0, low: 0 };
  return { ...base, lanes, items: base.items.map(item => lanes[item.priority][positions[item.priority]++]!),
    dueDeckIds: [...lanes.focus, ...lanes.maintain, ...lanes.low].filter(item => item.targetType === "deck" && item.dueCount > 0).map(item => item.targetId) };
}
