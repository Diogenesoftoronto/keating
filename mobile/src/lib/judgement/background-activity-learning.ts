import { learnBackgroundActivityPolicy, type BackgroundActivityPolicy } from "../../../../packages/learner-contracts/src/judgement/background-activity-policy";
import type { ActivityBoundary, ActivityExposure } from "../../../../packages/learner-contracts/src/judgement/activity-learning";
import type { OnlineDecisionRequest } from "../../../../packages/learner-contracts/src/judgement/online-decision-policy";

interface PolicyStore {
  generation(): Promise<number>;
  history(expected: number, boundaries: readonly ActivityBoundary[], asOf: number, current: () => boolean): Promise<ActivityExposure[]>;
  savePolicy(expected: number, policy: BackgroundActivityPolicy, current: () => boolean): Promise<void>;
}
export interface MobileBackgroundActivityJob {
  scope: string; generation: number; store: PolicyStore;
  current: () => boolean;
  boundaries: () => readonly ActivityBoundary[];
  transport: (request: OnlineDecisionRequest, signal: AbortSignal, current: () => Promise<boolean>) => Promise<unknown>;
}
const COOLDOWN_MS = 60_000;
const TIMEOUT_MS = 60_000;

/** One research job at a time; conversation publication never awaits this coordinator.
 * Jobs retain account/history identity, independently of a completed turn's AbortSignal.
 */
export class MobileBackgroundActivityLearning {
  private pending: MobileBackgroundActivityJob | null = null;
  private running: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = new Map<string, { key: string; at: number }>();
  constructor(private readonly learn = learnBackgroundActivityPolicy, private readonly now = Date.now) {}
  schedule(job: MobileBackgroundActivityJob): void {
    this.pending = job; // New evidence coalesces while a valid earlier snapshot is being researched.
    this.start();
  }
  cancel(): void {
    this.pending = null;
    this.running?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private start(): void {
    if (this.running || !this.pending) return;
    const job = this.pending;
    if (!job.current()) { this.pending = null; return; }
    const wait = Math.max(0, (this.last.get(job.scope)?.at ?? -Infinity) + COOLDOWN_MS - this.now());
    if (this.timer) clearTimeout(this.timer);
    if (wait) { this.timer = setTimeout(() => { this.timer = null; this.start(); }, wait); return; }
    this.pending = null;
    const controller = new AbortController();
    this.running = controller;
    void this.run(job, controller).finally(() => {
      if (this.running === controller) this.running = null;
      this.start();
    });
  }
  private async run(job: MobileBackgroundActivityJob, controller: AbortController): Promise<void> {
    const active = () => !controller.signal.aborted && job.current();
    const fresh = async () => active() && await job.store.generation() === job.generation && active();
    let rejectCancelled!: (reason: Error) => void;
    const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
    const abort = () => rejectCancelled(new Error("Background teaching research cancelled."));
    controller.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let attemptedKey: string | null = null, completed = false;
    try {
      await Promise.race([(async () => {
        if (!await fresh()) return;
        const asOf = this.now();
        const exposures = await job.store.history(job.generation, job.boundaries(), asOf, active);
        if (!await fresh()) return;
        const judgeModel = exposures.at(-1)?.observations.judgeModel;
        if (!judgeModel) return;
        // Unlabelled conversation changes alone never incur another hosted request.
        const key = JSON.stringify([job.generation, judgeModel, exposures.filter(row => row.outcome).map(row => ({
          id: row.id, sessionId: row.sessionId, createdAt: row.createdAt, observations: row.observations,
          candidate: row.candidate, sources: row.sources, outcome: row.outcome,
        }))]);
        if (this.last.get(job.scope)?.key === key) return;
        attemptedKey = key;
        this.last.set(job.scope, { key, at: asOf });
        while (this.last.size > 32) this.last.delete(this.last.keys().next().value!);
        const result = await this.learn({ exposures, judgeModel, asOf, signal: controller.signal,
          transport: async (request, signal) => {
            if (!await fresh()) throw Error("Background teaching research changed.");
            return job.transport(request, signal ?? controller.signal, fresh);
          } });
        if (!await fresh()) return;
        if (result.policy) await job.store.savePolicy(job.generation, result.policy, active);
        completed = result.receipt.status !== "failed" && result.receipt.status !== "cancelled" && result.receipt.status !== "invalid-response";
      })(), cancelled]);
    } catch { /* Optional research cannot fail a learner response or submission. */ }
    finally {
      clearTimeout(timeout); controller.signal.removeEventListener("abort", abort);
      // Transient failure permits a later explicit refresh, while retaining the
      // spending cooldown. A cancelled request must not suppress this evidence forever.
      const previous = this.last.get(job.scope);
      if (!completed && attemptedKey && previous?.key === attemptedKey) this.last.set(job.scope, { key: "", at: previous.at });
    }
  }
}
