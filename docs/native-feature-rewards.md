# Native feature rewards: W6 connection

`scripts/training/native_feature_rewards.py` connects **externally approved feature
measurements** to the existing PPO signals format. It validates native evidence,
computes bounded rewards and discounted action returns, and emits an audit and
signals. It does not fit or score probes, construct a provider client, update
weights, reconstruct tokens, write files, or allocate money.

This is an offline connection for research plan W6. It does **not** establish
reward quality, learning improvement, or a promotion decision. In particular,
MathDial `move.probing` extraction and classification remain research
classification. They are not automatically valid need estimates, reward heads,
or evidence of human learning.

## Approval and input contract

Call `build_feature_signals` with these keyword arguments:

| Argument | Contract |
| --- | --- |
| `episodes` | One to eight complete native episode records, including original ledgers/runtime evidence. Each branch has at most twelve delivered actor actions. |
| `captures`, `reviews` | The existing version-1 envelopes accepted by `native_training.build_exports`. Original actor tokens, roles, actual-sampler log probabilities, and independent segment reviews are required for an emitted signal. |
| `update_config` | A sealed existing **PPO** config with one to eight selected capture hashes and an immutable initial training checkpoint. Its advantage cap must cover the approved reward rule. |
| `split_manifest` | The existing sealed family manifest bound to the rebuilt export. Reward trajectories must be admitted, unprotected training families. Known aliases cannot overlap reward-evaluation holdouts. |
| `probes` | Five entries, each `{report, mode}`, containing existing `observer_probes.fit_probes` reports and a selected `text`, `raw`, or `sae` baseline. No model is loaded or scored here. |
| `evaluation_card` | A sealed, independently approved card expressly authorizing these pinned probes for feature rewards in this scope. |
| `approved_card_hash` | The exact card hash supplied separately by the experiment owner from their approved manifest. It is required; the module never approves a supplied card itself. |
| `measurements` | Zero to 96 sealed action measurement records. Missing measurements abstain. Foreign, stale, duplicated, or conflicting records raise. |

The five probe slots have distinct temporal meanings:

| Slot | Input boundary | Operational meaning |
| --- | --- | --- |
| `need_scaffolding` | `pre_action` | Evidence that support is called for before teaching |
| `need_rigor` | `pre_action` | Evidence that greater challenge is called for before teaching |
| `action_scaffolding` | `delivered` | Scaffolding actually delivered in text/artifacts |
| `action_rigor` | `delivered` | Rigor actually delivered in text/artifacts |
| `excessive_help` | `delivered` | Excessive assistance given this learner's request/context |

These are slots in an approved operational mapping, not assumptions that current
classifiers implement all five concepts. A situation label cannot simply replace
an action label. Each report's boundary, definition, model, calibration, split
manifest, observer manifest, and selected feature card remain pinned. The report
must have nonempty train/calibration/test counts and declare that test data were
not used for selection. Its existing classification-only permitted-use statement
is retained; a separate reward-use approval is necessary.

The evaluation card has the following exact top-level fields:

```text
schema_version: 1
purpose: "native-feature-rewards/v1"
status: "approved_for_feature_reward"
frozen: true
independent: true
approver: {kind: "human", id: <independent experiment approver>}
  # Or {kind: "independent_model", id, model: {provider, id, revision}}
approved_at: <ISO timestamp with timezone, before every episode begins>
rubric_revision: <exact revision on every action review>
probe_pins: {<each slot>: {
  report_sha256, mode, model_sha256,
  feature_card_sha256, observer_manifest_sha256
}}
evaluation: {
  artifact_sha256, protocol_revision,
  heldout_family_aliases: [<all registered family/alias identities>],
  gates: {calibration: true, independent_evaluation: true,
          domain_and_surface_transfer: true}
}
scope: {
  datasets: [<source.dataset values>],
  surfaces: ["chat", "interactive"],
  actor_model_id, learner_model_id, tokenizer,
  runtime_source_hashes_sha256
}
rule: <fixed rule below>
card_hash: <native_training.seal hash>
```

Approval can come from a human or a separately identified independent model;
human approval is not a plan requirement or an additional user confirmation gate.
The evaluator model must differ from the actor and learner, including simple
provider-prefix/case aliases. Existing approved evaluation artifacts may be used
when their contents and scope meet this contract.

Approval refers to an independently reviewed evaluation artifact; the function
checks its pin and explicit gate verdicts. It does not independently reproduce
those evaluations or authenticate the reviewer. Hashes bind supplied evidence;
they are not signatures or permission grants. Do not derive `approved_card_hash`
from an untrusted measurement's own card at the point of use. Changing probe
coefficients, scope, or reward settings requires a new independent approval.

The approved scope pins exact runtime source hashes using
`native_training.native_hash(runtime.source_hashes)`. Surface validation describes
**delivered content**: observations with documents require `interactive` approval;
those without documents require `chat` approval. An experiment with both types of
observation needs both. This is not evidence of browser rendering or an intended
interactive condition succeeding. Register every known family alias upstream;
this module cannot discover undeclared source relationships.

## Predictions and review binding

Each measurement is sealed with `native_training.seal(record, "measurement_hash")`:

```text
schema_version: 1
episode_hash: native_training.native_hash(original_episode)
episode_id, branch_id, family, event_id, event_hash, payload_hash
review_hash: <exact sealed segment review for this action>
card_hash: <approved evaluation card>
predictions: {<slot>: <prediction record>}
measurement_hash
```

Each prediction is sealed with `prediction_hash` and contains exactly:

```text
report_sha256, model_sha256, observer_manifest_sha256
native_feature_hash
input_sha256
scorer_revision
probability: <finite number in [0, 1], or null>
abstention_reason: <null for a number; nonempty explanation for null>
prediction_hash
```

`native_feature_hash` binds the regenerated `native_training.feature_inputs`
record at the slot's required boundary. `input_sha256` is the existing
`observer_core.digest` of `native_observer.project_feature(feature, family=...,
source=...)`, using the source object emitted by `native_observer.project_episode`:
`{dataset, measurement, episode_hash}`. Observer/report hashes use the observer's
sorted canonical hash; native ledgers, cards, measurements, and envelopes use the
native insertion-ordered hash. Do not interchange them.

An existing external scoring path can retain the output of
`observer_probes.predict_probe` with these bindings. This module only validates
the supplied numeric record and its provenance. It does not claim to verify that
the external scorer actually ran or that its probabilities are calibrated.

The independent action assessment comes from the exact review's
`feedback.checks`, as produced by the existing native review path. The approved
`assessment_checks` names select required gates (for example, independently
checked mathematics and evidence discipline). Each check has a `pass`, `fail`,
or `unknown` verdict, reasoning, and event/hash/quote citations. Known judgments
must cite the reviewed actor action or actual delivery. The module rechecks quotes,
causal bounds, and consistency with review acceptance. A review of another capture,
another branch, or a later event cannot authorize this signal.

Missing required checks or any `unknown` review verdicts abstain. A delivery receipt alone
does not establish pedagogical correctness or learner success. A separately
known action assessment does not replace the episode's unknown learning outcome.
Retrospective reviews can assess consequences using their validated later
boundary; pre-action need predictions still use only the original prefix.

## Reward and return rule

The fixed card contains exactly this rule shape:

```text
gamma: <0 through 1>
horizon: <integer 1 through 12 delivered actions>
excess_penalty: <0 through 1>
minimum_need_mass: <0.001 through 2>
failure_reward: <-1 through -0.001>
advantage_cap: <0.01 through 100, no greater than the PPO config cap>
baseline: {kind: "frozen_constant", value: <-12 through 12>, revision: <pin>}
assessment_checks: [<required independent check names>]
normalization: "mean_of_action_completion_means"
```

For known need probabilities `n_s, n_r`, delivered action probabilities `a_s,
a_r`, and excessive-help probability `b`, compute:

```text
mass = n_s + n_r
match = (n_s * a_s + n_r * a_r) / mass
reward = match - excess_penalty * b
```

If need mass is below the approved threshold, abstain. If any required need,
action, or assessment value is unknown, abstain. When the required independent
checks are known and include a failure, use the declared negative `failure_reward`
instead of granting a positive feature reward. Rewards stay in `[-1, 1]`.
These are declared behavioral rewards, not TutorMoments' official score or a
probability of human learning.

For action `i`, sum at most `horizon` rewards in **the same episode branch**, in
ledger order, with coefficients `1, gamma, gamma², ...`. Subtract the frozen
constant baseline, then clamp to the advantage cap. The baseline cannot read the
future. A learned baseline is deliberately outside this version's contract.

Unknown rewards propagate through every return that depends on them. They are
never dropped, averaged away, or replaced with zero. At `gamma=0`, only the current
reward matters. `complete` or `learner_stop` with a completed runtime permits a
short terminal horizon. Failure, invalid learner action, missing assessment, or
budget exhaustion leaves an unobserved tail unknown. A fully observed finite
horizon earlier in that failed episode can still be eligible. Review sign
conflicts abstain: a rejected action never receives a nonnegative PPO advantage,
and its sign is not silently flipped to satisfy the updater.

Version 1 requires one original actor completion per delivered runtime step.
Multiple actor completions sharing one delivery abstain because the current
feature projection does not assign that single delivery reward independently to
each completion. Missing captures/reviews remain missing positions in the reward
timeline. Reopen/session events and steps without new actor output are context,
not extra reward-bearing actions.

## Existing PPO handoff

```python
audit = build_feature_signals(
    episodes=episodes, captures=captures, reviews=reviews,
    probes=probes, evaluation_card=approved_card,
    approved_card_hash=experiment_manifest["approved_reward_card_hash"],
    measurements=measurements, update_config=ppo_config,
    split_manifest=split_manifest,
)

# Pure planning only. Missing selected signals fail closed here.
plan = native_tinker_update.prepare_update(
    audit["export"], split_manifest, ppo_config, audit["signals"]
)
```

The returned audit is sealed with `audit_hash`; `signals` is the existing sealed
`{schema_version, export_hash, signals, signals_hash}` envelope. Every emitted row
contains the original review, the action advantage repeated across its original
eligible actor completion tokens, and provenance binding the card, config, rule,
baseline, original feature, and all same-branch return evidence. The audit retains
raw reward, return, clipped advantage, and abstention reasons, including actions
not selected for this PPO batch. `selected_abstentions` lists selected captures
without a signal. Do not silently change the selection or approved config to hide
missingness; preserve the audit and explicitly plan any different batch.

**Do not divide these advantages by completion length.** The existing
`native_tinker_update.datum` supplies zero prompt advantages and divides eligible
completion values by `completion_count * batch_action_count`. That preserves
`mean_of_action_completion_means` for unequal completion lengths. Reward is counted
once per action; repeating its advantage over tokens does not create additional
reward observations. Tool-result and learner tokens remain context, while original
actor-authored tool-call tokens retain their existing eligibility and masks.

Hosted instruction-baseline journals with unattested catalog revisions are not
training captures. This connection does not change initial/SFT/Base checkpoints,
observer weights, actor configuration, original source hashes, or evaluator state.
It never invokes `execute_update`. Funding, release evaluation, and any paid
dispatch remain the parent's separate, explicit stages.

Keep original episodes, probe reports, cards, measurements, and generated audits
in private ignored storage such as `.keating/`; use the project's exclusive,
mode-0600 writer when the parent persists them. This module has no writer or CLI.
No private records or approval artifacts are bundled with it.

## Verification and remaining gates

Run the new unittest module in the existing Python environment:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 -m unittest discover \
  -s scripts/training -p 'test_native_feature_rewards.py'
```

Tests use authored ledgers, mock captures, explicit mock approvals, and the existing
PPO planner/datum constructor. They check arithmetic, unequal completion lengths,
masking, branch separation, temporal/review bindings, approval/scope drift,
unknown evidence, failure tails, and classification-only rejection. They do not
contact a provider or assert a fitted probe's reward validity.

W6 still needs independently validated need/action concepts, calibrated external
scores, an approved domain/surface evaluation card, and reviewed native trajectories
with original trainable actor captures. The current MathDial classification work
can inform that evaluation; it does not complete those gates. Any subsequent
feature-only PPO experiment must use the existing updater and independent held-out
evaluation. This implementation reports no training or learning gain.
