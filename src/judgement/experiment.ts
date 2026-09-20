/**
 * Pinning a judgement backend for the lifetime of one teaching experiment.
 *
 * `compareEpisodeBenchmarks` rejects a promotion with `runtime_or_model_changed`
 * when the baseline and the candidate were not produced under the same
 * runtime/model, and it is a *fixed* gate — candidates cannot tune thresholds,
 * metrics, weights, or missingness. A cascade that answered from one backend on
 * the baseline run and another on the candidate run is precisely a changed
 * model, so a non-deterministic tier would make the paired comparison
 * meaningless (§2.4, §6).
 *
 * Two mechanisms, applied together and never separately:
 *
 * 1. `RouterPolicy.pinnedBackend` restricts routing to one backend, which
 *    disables fallback for the whole experiment.
 * 2. `withPinnedJudgeIdentity` records the resolved backend in
 *    `EpisodeExecution.model` / `runtime`, so the *existing* gate detects a
 *    swapped judge instead of being fooled by one. The gate is not modified,
 *    and none of its other rejection reasons are touched.
 *
 * {@link pinExperimentJudgement} returns the runner and the judge as one unit
 * so a caller cannot pin one and forget the other.
 */
import type { EpisodeJudge, EpisodeRunner } from "../../shared/evolution/contracts.js";
import {
  type EpisodeJudgeJudgement,
  type ExperimentCompletion,
  createEpisodeJudge,
  judgeBackendTag,
  pinJudgementBackend,
  withPinnedJudgeIdentity,
} from "../../shared/evolution/model-adapters.js";
import type { JudgementBackendKey } from "../../packages/learner-contracts/src/judgement/contracts.js";
import type { JudgementThresholds } from "../../packages/learner-contracts/src/judgement/projections.js";
import type { JudgementTier, RouterPolicy } from "../../packages/learner-contracts/src/judgement/router.js";

/** Stable diagnostic codes. Provider text never reaches a caller, a log, or a screen. */
export type ExperimentPinErrorCode =
  | "no-judgement-tier-configured"
  | "no-available-judgement-backend"
  | "uncalibrated-judgement-backend"
  | "pinned-backend-not-in-ladder";

export interface ExperimentJudgementPin {
  readonly backend: JudgementBackendKey;
  /** The same policy with fallback disabled for the duration of the experiment. */
  readonly policy: RouterPolicy;
  /** What gets stamped into `EpisodeExecution.model`. Secret-free and stable. */
  readonly tag: string;
}

export type ExperimentPinOutcome =
  | { readonly ok: true; readonly pin: ExperimentJudgementPin }
  | { readonly ok: false; readonly errorCode: ExperimentPinErrorCode };

function available(tier: JudgementTier): boolean {
  return tier.isAvailable ? tier.isAvailable() : true;
}

function sameBackend(left: JudgementBackendKey, right: JudgementBackendKey): boolean {
  return left.backend === right.backend
    && left.model === right.model
    && left.calibrationSha256 === right.calibrationSha256;
}

/**
 * Resolve the ladder down to exactly one backend, once.
 *
 * An uncalibrated backend is refused rather than pinned: `resolveThresholds`
 * returns null for it on every question, so the experiment would abstain on
 * every episode and report as judge-error throughout. Failing here names the
 * cause instead of burying it in a run of empty evidence. Errors are returned,
 * never thrown.
 */
export function resolveExperimentJudgementPin(policy: RouterPolicy): ExperimentPinOutcome {
  if (policy.tiers.length === 0) return { ok: false, errorCode: "no-judgement-tier-configured" };
  if (policy.pinnedBackend) {
    const pinned = policy.pinnedBackend;
    if (!policy.tiers.some((tier) => sameBackend(tier.key, pinned))) {
      return { ok: false, errorCode: "pinned-backend-not-in-ladder" };
    }
    if (pinned.calibrationSha256 === null) {
      return { ok: false, errorCode: "uncalibrated-judgement-backend" };
    }
    return { ok: true, pin: pinFor(policy, pinned) };
  }
  const reachable = policy.tiers.filter(available);
  if (reachable.length === 0) return { ok: false, errorCode: "no-available-judgement-backend" };
  const calibrated = reachable.find((tier) => tier.key.calibrationSha256 !== null);
  if (!calibrated) return { ok: false, errorCode: "uncalibrated-judgement-backend" };
  return { ok: true, pin: pinFor(policy, calibrated.key) };
}

function pinFor(policy: RouterPolicy, backend: JudgementBackendKey): ExperimentJudgementPin {
  return {
    backend,
    policy: pinJudgementBackend(policy, backend),
    tag: judgeBackendTag(backend),
  };
}

export interface PinnedExperimentJudgement {
  readonly pin: ExperimentJudgementPin;
  /** The caller's runner, wrapped so the resolved judge appears in the execution identity. */
  readonly runner: EpisodeRunner;
  /** Routed against the pinned backend only; fallback is off. */
  readonly judge: EpisodeJudge;
}

export type PinnedExperimentOutcome =
  | { readonly ok: true; readonly experiment: PinnedExperimentJudgement }
  | { readonly ok: false; readonly errorCode: ExperimentPinErrorCode };

export interface PinExperimentInput {
  readonly policy: RouterPolicy;
  readonly runner: EpisodeRunner;
  /**
   * Only used if the pin cannot be resolved, which never happens on the `ok`
   * path. Present so a caller that still has a prose completion can keep one
   * object around; the pinned judge never calls it.
   */
  readonly complete?: ExperimentCompletion;
  readonly evidenceThresholds?: JudgementThresholds;
}

const UNREACHABLE_COMPLETION: ExperimentCompletion = async () => {
  // The typed judge never completes prose. Reaching this is a wiring bug, and
  // it is reported as a stable code rather than a provider message.
  throw new Error("episode_judge_completion_not_available");
};

/**
 * Pin the backend and build the matching runner and judge together.
 *
 * Returning them as one value is the point: a runner stamped with backend A and
 * a judge routed to backend B would defeat the very gate this exists to feed.
 */
export function pinExperimentJudgement(input: PinExperimentInput): PinnedExperimentOutcome {
  const resolved = resolveExperimentJudgementPin(input.policy);
  if (!resolved.ok) return resolved;
  const judgement: EpisodeJudgeJudgement = {
    policy: resolved.pin.policy,
    ...(input.evidenceThresholds ? { evidenceThresholds: input.evidenceThresholds } : {}),
  };
  return {
    ok: true,
    experiment: {
      pin: resolved.pin,
      runner: withPinnedJudgeIdentity(input.runner, resolved.pin.backend),
      judge: createEpisodeJudge(input.complete ?? UNREACHABLE_COMPLETION, { judgement }),
    },
  };
}
