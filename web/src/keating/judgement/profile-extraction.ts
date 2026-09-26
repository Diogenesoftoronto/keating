/**
 * Web wiring for declared-profile extraction.
 *
 * The decision logic lives in `@keating/learner-contracts`; this file only
 * supplies a routed caller and a learner-facing off switch. Extraction is
 * opt-in: a learner who never turns it on, or who turns it off, completes
 * onboarding through the form and no sentence of theirs is ever sent to a
 * model for classification.
 */
import {
  extractProfileFields,
  profileProposalFrom,
  type ExtractableProfileField,
  type JudgementCaller,
  type ProfileFieldDecision,
  type ProfileProposal,
  type ProfileProposalSource,
} from "@keating/learner-contracts";
import { createLocalSetting } from "../local-setting";
import { createWebJudgementRuntime } from "./runtime";
import { createJudgementOperationCaller } from "./operation";

const preference = createLocalSetting<boolean>({
  key: "keating:profile-extraction:v1",
  event: "keating:profile-extraction-changed",
  normalize: value => value === true || value === "true",
});

export const webProfileExtractionEnabled = () => preference.load();
export const setWebProfileExtractionEnabled = (enabled: boolean) => preference.save(enabled);
export const subscribeWebProfileExtraction = (listener: () => void) => preference.subscribe(listener);

export interface WebProfileExtractionOptions {
  readonly fields?: readonly ExtractableProfileField[];
  readonly source?: ProfileProposalSource;
  readonly signal?: AbortSignal;
  /** Test seam. Omit to route through the learner's configured judgement backend. */
  readonly call?: JudgementCaller;
  /** Test seam for the off switch, so tests need no global storage. */
  readonly enabled?: boolean;
}

export interface WebProfileExtractionResult {
  /** Reviewable suggestions. Empty whenever extraction is off or abstained. */
  readonly proposals: readonly ProfileProposal[];
  /** Every decision, including abstentions, so review can explain a blank pass. */
  readonly decisions: readonly ProfileFieldDecision[];
}

const EMPTY: WebProfileExtractionResult = Object.freeze({ proposals: Object.freeze([]), decisions: Object.freeze([]) });

/**
 * Read one learner sentence into reviewable proposals.
 *
 * Returns proposals; it writes nothing. The caller shows them, the learner
 * accepts or discards, and only then does `acceptedProfilePatch` produce a
 * profile change.
 */
export async function extractProfileProposals(
  evidence: string,
  options: WebProfileExtractionOptions = {},
): Promise<WebProfileExtractionResult> {
  const enabled = options.enabled ?? webProfileExtractionEnabled();
  if (!enabled) return EMPTY;

  const call = options.call ?? createJudgementOperationCaller({
    runtime: createWebJudgementRuntime(),
    // Extraction only ever proposes, so an uncalibrated answer is admissible
    // here: the learner is the calibration, and they see it before it lands.
    accept: () => true,
  });

  const decisions = await extractProfileFields(evidence, options.fields ?? [], call, { signal: options.signal });
  const source = options.source ?? "conversation";
  const proposals = decisions
    .map(decision => profileProposalFrom(decision, source))
    .filter((proposal): proposal is ProfileProposal => proposal !== null);
  return Object.freeze({ proposals: Object.freeze(proposals), decisions });
}
