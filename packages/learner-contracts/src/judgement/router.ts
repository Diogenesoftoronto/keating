/**
 * The cascade router: the only module that decides which tier answers.
 *
 * Callers ask for a decision, never for a tier. Three invariants are enforced
 * here rather than left to each call site:
 *
 * 1. A judgement only ever *improves* an answer that already exists. Every
 *    routed question carries the baseline its deterministic tier already
 *    produced, so an abstention returns that baseline instead of a low score.
 * 2. A tier with no calibration for a question is skipped, not guessed at.
 * 3. A pinned backend disables fallback entirely, because a paired comparison
 *    whose judge changed halfway through is not a comparison.
 *
 * Pure and transport-free: tiers are injected, so unit tests need no network.
 */
import {
  type JudgementAnswer,
  type JudgementBackendKey,
  type JudgementCaller,
  type JudgementOutcome,
  type JudgementQuestion,
  type JudgementState,
  judgementRequestProblem,
  questionDigest,
} from "./contracts.js";
import {
  type CalibrationTable,
  type JudgementProvenance,
  type JudgementThresholds,
  type JudgementVerdict,
  abstained,
  judgementProvenance,
  resolveThresholds,
} from "./projections.js";

export interface JudgementTier {
  readonly key: JudgementBackendKey;
  readonly call: JudgementCaller;
  /**
   * False when the backend is switched off, unconfigured, or unreachable.
   * Escalating from the on-device tier to a hosted one is a setting, and this
   * is where that setting is read — not a constant buried in a call site.
   */
  readonly isAvailable?: () => boolean;
}

export interface RouterPolicy {
  /** Ordered ladder, cheapest first. */
  readonly tiers: readonly JudgementTier[];
  readonly calibration: CalibrationTable;
  /**
   * Restrict routing to one backend for the lifetime of an experiment. The
   * evolution promotion gate rejects a run whose runtime or model changed, so a
   * router that silently fell back would invalidate its own comparison.
   */
  readonly pinnedBackend?: JudgementBackendKey;
}

export type VerdictReader<T> = (
  answer: JudgementAnswer,
  thresholds: JudgementThresholds,
  provenance: JudgementProvenance,
) => JudgementVerdict<T>;

export interface RoutedQuestion<T> {
  readonly key: string;
  readonly question: JudgementQuestion;
  /** What the deterministic tier already concluded. Returned unchanged on abstention. */
  readonly baseline: T;
  readonly read: VerdictReader<T>;
}

/** One tier's attempt at one question. Kept for telemetry and for explaining a decision. */
export interface RouteAttempt {
  readonly backend: JudgementBackendKey;
  readonly outcome: "decided" | "abstained" | "skipped-unavailable" | "skipped-uncalibrated" | "error";
  readonly detail?: string;
}

export interface RouteOutcome<T> {
  /** Always populated: the improved value, or the baseline when nothing decided. */
  readonly value: T;
  readonly verdict: JudgementVerdict<T>;
  readonly attempts: readonly RouteAttempt[];
}

function tierAvailable(tier: JudgementTier): boolean {
  return tier.isAvailable ? tier.isAvailable() : true;
}

function sameBackend(left: JudgementBackendKey, right: JudgementBackendKey): boolean {
  return left.backend === right.backend
    && left.model === right.model
    && left.calibrationSha256 === right.calibrationSha256;
}

function eligibleTiers(policy: RouterPolicy): readonly JudgementTier[] {
  if (!policy.pinnedBackend) return policy.tiers;
  const pinned = policy.pinnedBackend;
  return policy.tiers.filter((tier) => sameBackend(tier.key, pinned));
}

/**
 * Route a batch against the ladder.
 *
 * Questions that abstain at one tier escalate together to the next, so the
 * expensive tier is asked once about the residue rather than once per question.
 */
export async function routeJudgements<T>(
  state: JudgementState,
  questions: ReadonlyArray<RoutedQuestion<T>>,
  policy: RouterPolicy,
  signal?: AbortSignal,
): Promise<Record<string, RouteOutcome<T>>> {
  const digests = new Map(questions.map((entry) => [entry.key, questionDigest(entry.question)]));
  const attempts = new Map<string, RouteAttempt[]>(questions.map((entry) => [entry.key, []]));
  const settled = new Map<string, RouteOutcome<T>>();
  let pending = [...questions];

  for (const tier of eligibleTiers(policy)) {
    if (pending.length === 0) break;
    if (!tierAvailable(tier)) {
      for (const entry of pending) {
        attempts.get(entry.key)!.push({ backend: tier.key, outcome: "skipped-unavailable" });
      }
      continue;
    }

    // A tier that was never calibrated for a question cannot answer it; that is
    // a reason to escalate, not a reason to borrow another backend's numbers.
    const askable: Array<{ entry: RoutedQuestion<T>; thresholds: JudgementThresholds }> = [];
    const deferred: Array<RoutedQuestion<T>> = [];
    for (const entry of pending) {
      const thresholds = resolveThresholds(policy.calibration, tier.key, digests.get(entry.key)!);
      if (thresholds === null) {
        attempts.get(entry.key)!.push({ backend: tier.key, outcome: "skipped-uncalibrated" });
        deferred.push(entry);
      } else {
        askable.push({ entry, thresholds });
      }
    }
    if (askable.length === 0) {
      pending = deferred;
      continue;
    }

    const request = {
      state,
      questions: Object.fromEntries(askable.map(({ entry }) => [entry.key, entry.question])),
    };
    const problem = judgementRequestProblem(request);
    let outcome: JudgementOutcome;
    try {
      outcome = problem !== null
        ? { ok: false, error: { code: "request-invalid", retryable: false } }
        : signal?.aborted
          ? { ok: false, error: { code: "cancelled", retryable: false } }
          : await tier.call(request, signal);
    } catch {
      // Injected transports must not leak provider errors or learner text.
      outcome = { ok: false, error: { code: "backend-unavailable", retryable: true } };
    }

    const stillPending: Array<RoutedQuestion<T>> = [...deferred];
    for (const { entry, thresholds } of askable) {
      const provenance = judgementProvenance(tier.key, digests.get(entry.key)!);
      const trail = attempts.get(entry.key)!;
      if (!outcome.ok) {
        trail.push({ backend: tier.key, outcome: "error", detail: outcome.error.code });
        stillPending.push(entry);
        continue;
      }
      if (!sameBackend(tier.key, outcome.response.backend)) {
        trail.push({ backend: tier.key, outcome: "error", detail: "backend-identity-mismatch" });
        stillPending.push(entry);
        continue;
      }
      const answer = outcome.response.answers[entry.key];
      if (!answer) {
        trail.push({ backend: tier.key, outcome: "error", detail: "response-malformed" });
        stillPending.push(entry);
        continue;
      }
      const verdict = entry.read(answer, thresholds, provenance);
      if (verdict.status === "decided") {
        trail.push({ backend: tier.key, outcome: "decided" });
        settled.set(entry.key, { value: verdict.value, verdict, attempts: [...trail] });
      } else {
        trail.push({ backend: tier.key, outcome: "abstained", detail: verdict.reason });
        stillPending.push(entry);
      }
    }
    // Preserve the caller's ordering so escalation batches stay deterministic.
    const order = new Map(questions.map((entry, index) => [entry.key, index]));
    pending = stillPending.sort((left, right) => order.get(left.key)! - order.get(right.key)!);
  }

  for (const entry of pending) {
    const trail = attempts.get(entry.key)!;
    const provenance = judgementProvenance(
      policy.pinnedBackend ?? policy.tiers[policy.tiers.length - 1]?.key
        ?? { backend: "fixture", model: "none", calibrationSha256: null },
      digests.get(entry.key)!,
    );
    const exhausted = trail.some((attempt) => attempt.outcome === "error");
    settled.set(entry.key, {
      value: entry.baseline,
      verdict: abstained<T>(exhausted ? "backend-error" : "no-calibration", provenance),
      attempts: [...trail],
    });
  }

  return Object.fromEntries(settled);
}

/** Single-question convenience over {@link routeJudgements}. */
export async function routeJudgement<T>(
  state: JudgementState,
  question: RoutedQuestion<T>,
  policy: RouterPolicy,
  signal?: AbortSignal,
): Promise<RouteOutcome<T>> {
  const routed = await routeJudgements(state, [question], policy, signal);
  return routed[question.key];
}
