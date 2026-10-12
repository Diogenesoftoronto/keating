import type { PortableLearnerData } from "../packages/learner-contracts/src/portable.js";
import { DECISION_POLICY_TARGETS, type DecisionPolicyTarget } from "../packages/learner-contracts/src/judgement/decision-policy-data.js";
import { buildOnlineDecisionBatch, onlineDecisionEvidenceId, runOnlineDecisionBatch,
  type OnlineDecisionResult, type OnlineDecisionTransport } from "../packages/learner-contracts/src/judgement/online-decision-policy.js";

export type OnlineLearningResults = Partial<Record<DecisionPolicyTarget, OnlineDecisionResult>>;
export interface OnlineLearningState { scope: string | null; running: boolean; results: OnlineLearningResults; error: string | null }
export const EMPTY_ONLINE_LEARNING: OnlineLearningState = { scope: null, running: false, results: {}, error: null };
/** Per-view coordinator. Receipts are local and never reused across account sessions. */
export class OnlineLearningSession {
  private controller: AbortController | null = null;
  private cache = new Map<string, OnlineDecisionResult>();
  private lastDispatch = 0;
  private scope: string | null = null;
  cancel() { this.controller?.abort(); this.controller = null; }
  clear() { this.cancel(); this.cache.clear(); this.lastDispatch = 0; this.scope = null; }
  async update(input: { data: PortableLearnerData; scope: string; asOf: number; transport: OnlineDecisionTransport;
    current: () => { data: PortableLearnerData | null; scope: string | null; enabled: boolean };
    publish: (state: OnlineLearningState) => void }): Promise<void> {
    this.cancel();
    if (this.scope !== input.scope) { this.cache.clear(); this.lastDispatch = 0; this.scope = input.scope; }
    const controller = new AbortController(); this.controller = controller;
    const current = () => { const latest = input.current(); return !controller.signal.aborted && latest.enabled && latest.scope === input.scope; };
    const results: OnlineLearningResults = {};
    const publish = (running: boolean, error: string | null = null) => {
      if (current()) input.publish({ scope: input.scope, running, results: { ...results }, error });
    };
    try {
      const batches = DECISION_POLICY_TARGETS.map(target => buildOnlineDecisionBatch(input.data, target, input.asOf));
      const needsRequest = batches.some(batch => batch.request && !this.cache.has(`${batch.target}:${batch.evidenceId}`));
      const waitMs = needsRequest ? Math.max(0, this.lastDispatch + 60_000 - Date.now()) : 0;
      // Clear old results immediately while waiting for changed evidence.
      publish(needsRequest);
      if (waitMs) await new Promise<void>(resolve => {
        const timer = setTimeout(done, waitMs);
        function done() { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); }
        controller.signal.addEventListener("abort", done, { once: true });
      });
      if (!current()) return;
      if (needsRequest) this.lastDispatch = Date.now();
      for (const batch of batches) {
        if (!current()) return;
        const key = `${batch.target}:${batch.evidenceId}`;
        let result = this.cache.get(key);
        if (!result) {
          result = await runOnlineDecisionBatch(batch, input.transport, { signal: controller.signal, now: Date.now,
            currentEvidenceId: () => {
              const latest = input.current();
              return latest.data && current() ? onlineDecisionEvidenceId(latest.data, batch.target, Date.now()) : "changed";
            } });
          if (!current()) return;
          this.cache.set(key, result);
          if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value!);
        }
        results[batch.target] = result;
        publish(true);
      }
      publish(false);
    } catch { publish(false, "Learning history could not be checked. The usual estimates remain available."); }
  }
}
export function onlineLearningSummary(results: OnlineLearningResults): string {
  const entries = Object.entries(results);
  if (!entries.length) return "Predictions update from saved answers and reviews while this page is open.";
  const labels: Record<string, string> = { mastery: "Next answer", retention: "Recall", urgency: "Review priority" };
  return entries.map(([target, result]) => {
    const receipt = result!.receipt, count = receipt.counts;
    const detail = receipt.reasons.includes("local-history-exceeds-reconstruction-limit") ? "history exceeds the current prediction capacity; using the usual rule"
      : receipt.status === "active" ? `using TabPFN (${count.trainRows} past outcomes, ${count.validationRows} later checks)`
      : receipt.status === "baseline-retained" ? "usual rule performed at least as well"
      : receipt.status === "failed" ? "service unavailable; using the usual rule"
      : receipt.status === "invalid-response" ? "prediction could not be verified"
      : receipt.status === "stale" ? "waiting for a fresh prediction"
      : receipt.status === "no-candidates" ? "no eligible answer or delayed review to predict"
      : receipt.status === "insufficient-validation" ? `need more varied later outcomes to check predictions (${count.validationRows} eligible checks)`
      : `gathering evidence (${count.observedRows} eligible outcomes)`;
    return `${labels[target]}: ${detail}.`;
  }).join(" ");
}
