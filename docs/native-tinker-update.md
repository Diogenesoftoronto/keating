# One bounded native Tinker update

`scripts/training/native_tinker_update.py` consumes the sealed output of
`native_training.build_exports`. Its default CLI and `prepare_update` API only
validate and price a plan. `--execute` permits one forward/backward batch and one
optimizer step, after a full reservation in a separate research budget ledger.
It neither samples actor responses nor reconstructs missing original tokens.

## Completion boundary

The runnable consumer implements SFT, independently supplied PPO advantages, and
live teacher-scored SDPO through Tinker 0.27.1. Implementation checks inject a mock
service and inspect the installed SDK's source, signatures, and typed data without
creating a provider client. Live execution results belong to the separately
authorized run's `result.json`; offline checks do not establish update completion.

Earlier Pi-only plumbing traces lack authoritative original actor token IDs and
sampler logprobs and cannot train here. The generation-time adapter now records
native `SampledSequence.tokens` and probabilities with the exact request prefix,
model/tokenizer/sampler attestations, and runtime-event bindings. Two actual
responses were bound in `.keating/native-learning/model-stage-zero/bound-v1`.
Their independent reviews reject the actions for SFT. Binding checks consistency
between the authoritative capture and runtime evidence. Retokenizing delivered text or
rescoring it afterward still cannot recover the behavior policy.

Live execution also requires an immutable initial Tinker **training checkpoint**,
an independently approved family/split manifest, and independent segment reviews.
SFT and SDPO require acceptance. PPO can use reviewed rejected actions with the
strictly nonpositive advantage rule described below.
SDPO additionally requires the exact feedback-conditioned teacher prefix from
an upstream pinned renderer. The consumer rejects absent fields with explicit
codes. It does not create permissive admission manifests or review its own data.

The local `.keating/native-learning/model-stage-zero/negative-ppo-v1/{exports,splits,config,signals}.json`
inputs contain those two rejected policy segments, zero SFT segments, and 1,738
original actor targets. Offline `prepare_update` produced plan
`aeab6e00b4a47ef556ef7ebdbdc4ee96e431f078e74bbd23c7124d935e1f76a1`
with a **$0.614802 reservation allowance**. This is a manually reviewed behavioral
PPO baseline; it does not use a trained SAE reward or measure a learning outcome.
The amount is a plan allowance, not an invoice. Execution evidence is recorded
below. These private local artifacts remain outside version control.

### Completed negative-PPO run and paired diagnostic

The execution coordinator confirmed **26 updater tests passed**, including the
dedicated negative-PPO and single-attempt SDK checks. The subsequently saved
`.keating/native-learning/model-stage-zero/negative-ppo-v1/executed-v1/result.json`
has a valid content seal, `status: "complete"`, and
`optimizer_acknowledged: true`. It completed on
`2026-09-13T12:13:21.587618+00:00` for the plan above. This establishes an
acknowledged single optimizer update and two saved checkpoints:

- Training state: `tinker://0f52488b-3e41-56af-abd5-eaeb2baa1f02:train:0/weights/native-aeab6e00b4a47ef556ef7ebd-updated`.
- Sampler: `tinker://0f52488b-3e41-56af-abd5-eaeb2baa1f02:train:0/sampler_weights/native-aeab6e00b4a47ef556ef7ebd-updated`.
- Result content seal (`result_hash`): `90e44f7521af36a1c9918e6c9470d5e4b8d56ef2eae588e0d203c8360ef99f79`.
- Result file SHA-256: `33d0b5613154d7c94ae5c17c2c4c9b2def8ec82b594f675ffbb888b98d1845cf`.

The saved `paired-evaluation-v1/results.json` also has a valid content seal
(`cffb7d80a944a23605e9662f284c91de2bf74583079edc0545d906e3052ddfc5`)
and complete status: all **six planned generations returned**, three per arm.
Its suite SHA-256 is
`6777de0d5e78e9f2b3daf4a26c2c20c27bd07e836f9e0b80bdf59df737b80bdb`.
The blinded review recorded 22 true criterion values, zero false, zero unknown,
and **three paired rubric ties**. The fraction and JSON outputs were identical
across arms. No improvement was detected under the declared v1 criteria; one
sample per arm on three authored cases cannot establish reliable equivalence or
a training effect. This was a compact chat-only diagnostic, not the full native
tool harness or a human learning study. Learning outcomes remain unknown.

Both rectangle responses contained false side counts that the narrow v1 rubric
missed. After unblinding, label A was the updated checkpoint: it asserted seven
4 cm sides and four 7 cm sides. Label B was the original checkpoint: it asserted
four sides of each length before asking about the correct two sides of each
length. These errors are documented in
`paired-evaluation-v1/posthoc-observations.json`; the original suite and blinded
review are unchanged. Passing their narrow criteria does not establish overall
mathematical correctness.

`evaluation-suite-ppo-v2.json` retains the exact v1 task prompts, settings, case
IDs, and families, and adds whole-response numerical/geometric correctness and
internal-consistency criteria for the rectangle case. It explicitly records
`authored_after_v1_outputs: true`, known v1 model exposure, and fresh independent
preflight pending. No v2 generation or scoring has occurred. Its additions are
not preregistered v1 metrics, and these exposed families are not an unseen holdout.

## CLI and Python API

Every input is local JSON. Paths in these examples refer to supplied evidence,
not files produced automatically by this module. Commands assume the repository
root and the existing managed-Python environment.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_tinker_update.py \
  --exports exports.json --splits training-splits.json --config update-config.json \
  --signals update-signals.json --cap-usd 1.00 --output .keating/update-plan
```

This prints `planned_no_dispatch`, the content hash, method, segment count, and
cost allowance. `--output` is optional for planning and must name a new directory.
Planning imports neither Tinker nor Torch, reads no credential, creates no client,
and never touches a budget ledger. `--cap-usd` in plan mode checks the plan size;
existing ledger headroom is checked under lock only at execution.

To execute an approved plan, use the same inputs, a new output directory, and add
`--execute --budget-ledger .keating/native-learning/approved-update-subledger.json --cap-usd 1.00`.
The example subledger must have an allocation reserved from the shared research
cap before execution; creating a new file does not grant additional spending.
The cap is a required explicit decimal USD string. The only credential route is
the environment variable `TINKER_API_KEY`. The parent can resolve its credential
helper and inject this variable into the child environment. Never put its value
in a command line, JSON file, plan, notebook output, or log. Account selection is
explicit in the sealed config: `project_selection: "explicit"` supplies a
`project_id`, while `project_selection: "account_default"` omits the SDK's
`project_id` argument. For account default, omit the config's `project_id` or set it
to `null`, and unset `TINKER_PROJECT_ID` in the execution environment. A nonempty
ambient project value is rejected before reservation or client creation. Legacy
configs with an explicit `project_id` and no selection field remain supported.

```python
from native_tinker_update import prepare_update, execute_update

plan = prepare_update(exports, split_manifest, config, signals)
# No SDK, credentials, network, or ledger changes above.

# Only in an explicitly authorized live caller:
result = execute_update(
    exports, split_manifest, config, signals,
    budget_path=budget_path, cap_usd="1.00", output_dir=new_output_directory,
)
```

The execution API revalidates raw inputs and computes its own plan. It does not
accept a caller-edited plan with an understated cost. It creates a private output
directory (`0700`) and atomically writes private files (`0600`): `plan.json` and
`result.json`. These contain tokenized training evidence and must stay out of
commits and public logs. The CLI prints only the concise result summary.

## Input contracts

All envelopes use `native_training.seal(value, field)` and the insertion-ordered
`native_hash` algorithm, not sorted-key JSON. Hashes bind the admitted bytes;
they do not authenticate the author. Only ingest exports from the trusted ledger
validator and admission/review/capture operators. The consumer cannot prove the
truth of a newly rehashed fabricated attestation.

### Validated export

The envelope must have `schema_version: 1` and a valid `export_hash`. Selection is
explicit through `config.capture_hashes`; there is no automatic first-N selection.
Each selected record is `status: "available"`, has
`training_eligible: true`, belongs to a `model_episode`, and has a matching
delivered observer feature. The method determines its projection:

| Method | Selected projection | Required review decision |
| --- | --- | --- |
| SFT | `sft` | Accepted |
| SDPO | `sft` | Accepted, with retrospective feedback |
| PPO | `policy_segments` when present | Accepted or rejected, matching the sealed independent review |
| Legacy PPO | `sft`, only when `policy_segments` is absent | Accepted |

An empty `policy_segments` list never falls back to `sft`. A malformed list,
missing selected capture, or absent independent review is an error. A policy row
retains `episode_id`, `branch_id`, `family`, `event_id`, `event_hash`, `payload_hash`,
`status`, `training_eligible`, `review_hash`, `review_decision`, and `segment`.
`review_decision` must be exactly `accepted` or `rejected`, and must agree with the
review's boolean `accepted`. Rejected rows stay out of SFT and hindsight exports.

The consumer checks episode/branch/family identity, event/payload/review hashes,
original prompt and completion IDs, exact causal shift, actor-only token roles,
original generation provenance, tokenizer identity, and allowed behavior revision.
Tools and learner messages may occur in the captured prompt. Only
`assistant_text` and `assistant_tool_call` can appear in completion target roles.
SFT may omit behavior probabilities; PPO and SDPO must have all of them.

`hindsight` rows and `preferences` are retained in the source export but are not
silently converted into advantages. SDPO starts from accepted `sft` segments and
live-scores their supplied teacher prefixes. This allows bootstrapping when the
source export reports `missing_teacher_capture`. Preference learning is not one
of this CLI’s three methods.

### Configuration (`config_hash`)

This is a shape example. Checkpoint, tokenizer revision, capture hash, project,
and rate values must be supplied from real evidence before execution. The rates
below are **illustrative arithmetic inputs, not current Qwen pricing**.

```json
{
  "schema_version": 1,
  "method": "sdpo",
  "model": {
    "provider": "tinker",
    "id": "Qwen/Qwen3.5-9B-Base",
    "revision": "tinker://TRAINING_ID/weights/INITIAL_CHECKPOINT"
  },
  "tokenizer": {
    "id": "Qwen/Qwen3.5-9B-Base",
    "revision": "PINNED_TOKENIZER_REVISION",
    "chat_template_hash": "64_LOWERCASE_HEX_CHARACTERS"
  },
  "project_selection": "explicit",
  "project_id": "EXPLICIT_TINKER_PROJECT",
  "capture_hashes": ["64_LOWERCASE_HEX_CHARACTERS"],
  "allowed_behavior_revisions": ["tinker://BEHAVIOR_ID/sampler_weights/CHECKPOINT"],
  "learning_rate": 0.00001,
  "epsilon": 0.2,
  "max_abs_log_ratio": 2,
  "advantage_cap": 3,
  "ttl_seconds": 3600,
  "timeout_seconds": 30,
  "rates": {
    "model_id": "Qwen/Qwen3.5-9B-Base",
    "source": "REVIEWED_PRICE_SOURCE_AND_STORAGE_ASSUMPTIONS",
    "verified_on": "2026-09-13",
    "prefill_usd_per_million": "1.00",
    "train_usd_per_million": "3.00",
    "fixed_usd": "0.10",
    "safety_factor": 5
  }
}
```

Seal the completed object with `config_hash`. Boundaries are 1–8 unique segments,
32,768 tokens per student or teacher context, and 65,536 aggregate context tokens
per update. Learning rate is in `[1e-8, 1e-3]`, epsilon `[0.01, 0.3]`, maximum
absolute log ratio `[0.01, 10]`, and advantage cap `[0.01, 100]`. Checkpoint TTL is
60–86,400 seconds; future/HTTP timeout is 1–600 seconds. These are implementation
limits, not tuned research optima.

For the deliberately selected account default, replace both project lines with
`"project_selection": "account_default"`; an optional `"project_id": null` is
equivalent. Execution records this selection and uses `account-default` as the
subledger's project identity. It never creates a new project implicitly.

The named initial checkpoint is loaded into a **new trainer with optimizer reset**.
An arbitrary revision label or a mutable base model name does not qualify as an
immutable checkpoint. This CLI does not bootstrap a base adapter. The parent’s
capture/bootstrap stage must supply that state artifact. Server `get_info` must
match the configured model and tokenizer ID before scoring. Tokenizer revision
and template hashes are external capture/renderer attestations: `get_info` does
not expose an independent hash of their contents.

The two-action baseline uses distinct immutable identities:

- Initial training state: `tinker://b0a238b0-9465-5079-9d45-a3b128b0b605:train:0/weights/native-initial-0c65557bd60fc0fb`.
- Captured behavior sampler: `tinker://8129cbe3-543c-583c-9dbf-a719cd10731b:train:0/sampler_weights/native-initial-recovered-cb6c0bad7a6dadce`.

The recovery loaded the original training state and froze the sampler with zero
optimizer steps. The updater loads the first URI and admits the second through
`allowed_behavior_revisions`; different run IDs are valid. This recorded lineage
does not waive the numerical staleness check. Each captured token's original
behavior probability is still compared with the current student's forward score
before backward dispatch. The consumer does not infer weight equivalence from
checkpoint names or substitute newly scored probabilities for captured ones.

### Family/split admission (`split_hash`)

```python
manifest = seal({
    "schema_version": 1,
    "export_hash": exports["export_hash"],
    "registry_revision": pinned_registry_revision,
    "approved_by": admission_reviewer_id,
    "episodes": exports["episodes"],  # exact ordered episode fingerprints
    "families": [{
        "family": source_family,
        "aliases": [source_family, *known_source_family_aliases],
        "split": "train",  # train | validation | test | reference
        "protected": False,
        "sources": [{
            "dataset": dataset_id, "revision": dataset_revision,
            "record_id": source_record_id, "record_sha256": source_record_hash,
            "original_split": "train",
        }],
    }, *other_known_families],
}, "split_hash")
```

The manifest is an independent training-admission attestation tied to the exact
export and episode runtime/ledger fingerprints. Include all known protected
families and aliases, not just selected training examples. The validator rejects
alias overlap, the same source record under two families, and identical source
hashes assigned to different families. Dataset record identity remains grouped
across dataset revisions. All episode families must be registered; all selected
families must be unprotected `train` families with original source split `train`.

Public `test`, `validation`, `benchmark`, and unknown source splits cannot be
relabeled as training here. In particular, TutorMoments benchmark exposure in a
development run does not authorize training on those protected source records.
Use separately admitted training material or independent authored training data.
The source materialization registry is not a replacement for training admission.

The native export contains family IDs and runtime hashes, but does not contain
the full source admission registry. The admission operator must verify those
joins against the original scenario/source assets before signing off on this
manifest. The consumer checks the supplied assignment and bindings; it cannot
discover omitted family aliases or independently infer original dataset splits.

### Update signals (`signals_hash`, PPO/SDPO only)

```python
signals = seal({
    "schema_version": 1,
    "export_hash": exports["export_hash"],
    "signals": [{
        "capture_hash": original_capture_hash,
        "review": original_independent_segment_review,
        # Method-specific fields below.
    }],
}, "signals_hash")
```

The raw segment review must retain its `review_hash`, independent reviewer
identity, capture/event/branch/family references, evidence feature hash, and
latest allowed event ID. Its seal and decision must match the selected export row.
The upstream exporter checks actor/simulator/reviewer independence; the consumer
also rejects fixture reviewers, actor self-review, changed evidence, or temporal
boundary mismatches.

For **PPO**, add `advantages`, a finite vector with exactly one entry per captured
completion token, bounded by `advantage_cap`, and:

```python
"advantage_provenance": {
    "review_hash": review_hash,
    "feature_hash": reviewed_feature_hash,
    "estimator_revision": pinned_estimator,
    "baseline_revision": pinned_baseline,
    "aggregation": declared_action_credit_rule,
}
```

The external estimator supplies already computed advantages. The consumer does
not turn missing assessments into zeros or reward a simulator's claim of learning.

For a rejected PPO action, **every advantage must be nonpositive and at least one
must be negative**. For example, `[0, -1, -1]` is admissible for an otherwise valid
three-token capture; `[0, 0, 0]` and `[0, -1, 0.1]` are rejected. This sign rule is
checked before dispatch, in addition to finite-value, length, and magnitude checks.
The supplied estimator, baseline, and credit rule must describe the actual manual
review procedure. Neither a rejected action nor a missing learning assessment is
automatically converted into a scalar by this consumer.

PPO results retain `review_decision`, `review_hash`, `advantage_provenance`, and
`signal_kind: "independent_behavioral_review_advantages"` alongside the original
behavior and current-student scores. The plan also retains the full sealed review.
These fields distinguish a behavioral penalty from an accepted demonstration or
a measured learning gain. SFT and SDPO do not acquire a rejected-action path.

For **SDPO**, the accepted review must cover the retrospective feature. Compute its
feedback packet with `native_training.feedback_packet(feature, review)` and add:

```python
"teacher_prefix": seal({
    "prompt_token_ids": exact_teacher_prefix_ids,
    "completion_token_ids": original_capture_completion_ids,
    "tokenizer": original_tokenizer_provenance,
    "original_request_hash": original_request_hash,
    "feedback_hash": feedback_packet["feedback_hash"],
    "conditioning": "original_context_then_feedback_then_original_completion",
    "renderer": {"id": renderer_id, "revision": renderer_revision},
}, "prefix_hash")
```

This teacher prefix is a newly rendered privileged input, so its length and IDs
can differ from the student prefix. Its target completion must remain the original
actor completion. The upstream renderer must insert the feedback before replaying
that completion and record the renderer/tokenizer revisions. Hashing an arbitrary
token array is not evidence that the conditioning semantics are correct. The
consumer requires and preserves the external attestation; it does not guess the
prefix from a transcript or claim that newly tokenized text was captured at origin.

## Update math and official API boundary

For captured prompt `P` and actor completion `C`, the input is `(P+C)[:-1]`, the
targets are `(P+C)[1:]`, and the mask is `0*(len(P)-1) + 1*len(C)`. Each action’s
completion contribution is divided by `len(C) * batch_size`. SFT uses these
weights with `cross_entropy`. PPO applies the same normalization to the advantage
vector. Prefix logprob entries in PPO are numeric zero padding with zero
advantage, not asserted original prompt probabilities. The implementation follows
Tinker’s summed [cross-entropy](https://tinker-docs.thinkingmachines.ai/tinker/losses/cross-entropy/)
and [PPO](https://tinker-docs.thinkingmachines.ai/tinker/losses/ppo/) loss contracts.

SDPO first freezes a sampler checkpoint from the newly created trainer before any
update. That snapshot scores the supplied teacher prefix plus original completion
using `SamplingClient.compute_logprobs`. Completion scores are sliced at
`len(teacher_prefix)`. The current student uses `TrainingClient.forward` on shifted
targets; its completion scores start at `len(student_prompt)-1`. The whole vector
and completion lengths are checked independently. Both use the same original
completion IDs. These calls follow the official
[sampling client](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/samplingclient/)
and [training client](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/trainingclient/)
interfaces; checkpoint loading uses
[`create_training_client_from_state`](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/serviceclient/).

`sdpo_math.prepare_advantages` computes detached teacher-minus-current-student
logprobs, initializes its mean absolute scale from that action, and clips at three
times the scale. This single-update consumer then applies the configured absolute
cap. It does not maintain an EMA across separate CLI invocations. Original actual
sampler probabilities remain the PPO denominator, even when the behavior weights
differ from the current student. The staleness gate bounds the absolute
current-minus-behavior log ratio before backward dispatch.

No optimizer runs between current-student scoring and backward. Backward’s scores
must match the forward scores within `1e-4` before optimization is permitted.
This is a sampled-action, detached SDPO surrogate for one update; it is not
full-vocabulary reverse KL or a multi-epoch recomputation schedule. The fixed
teacher, original behavior distribution, and current student remain distinct in
the saved result. Tool-result/learner tokens never become actor targets.

The SDK `compute_logprobs` interface returns values without provider request and
response IDs. Result `teacher_captures` therefore records **local operation IDs**,
exact scoring-request hash, frozen checkpoint, timestamp, and probabilities, with
provider IDs explicitly `null`. This result is not a compatible replacement for
the stricter `native_training` external teacher-capture envelope, which requires
provider IDs. No IDs are fabricated to bridge that gap. Local teacher scoring is
usable for the immediate update because the consumer performed and recorded it.

## Shared independent research budget

Capture and update can share `BudgetLedger` without using the old model-specific
`PilotBudget`. Its identity is `native-research-budget/v1`, with a fixed explicit
project, model ID, and total cap. A changed identity or cap on an existing ledger
is rejected. Reserved amounts persist after success and failure; this ledger
tracks pessimistically committed allowances, not invoices or reconciled refunds.

The project has one shared **$100** research cap across providers. The coordinator
reserves allocations in `.keating/native-learning/research-budget-v1.json`, with
project identity `keating-native-research-2026-09-13` and model identity
`shared-runpod-and-tinker`. An updater subledger uses its own fixed project/model
identity and only its separately granted allowance. The consumer validates that
subledger; it does not create or verify the parent allocation automatically.
Do not point a model-specific update directly at the shared allocation ledger or
interpret the cap as $100 per provider.

```python
from native_training import seal
from native_tinker_update import BudgetLedger

ledger = BudgetLedger(path, project_id, model_id, "1.00")
sample_plan = seal({
    "operation": "native-capture", "capture_request_hash": capture_request_hash,
    "model_id": model_id, "project_id": project_id,
    "cost": {"reserved_usd": pessimistic_sample_allowance_as_decimal_string},
    "phases": ["create_service", "create_sampler", "sample"],
}, "plan_hash")
ledger.reserve(sample_plan)                 # before any client or dispatch
ledger.before(sample_plan, "create_service")
# create service
ledger.before(sample_plan, "create_sampler")
# create sampler
ledger.before(sample_plan, "sample")
# dispatch and await sample; save authoritative original capture
ledger.mark(sample_plan, status="complete")
# On an exception: ledger.mark(sample_plan, status="failed_unknown")
```

`reserve` validates the seal and positive amount, checks cumulative headroom
under `flock`, and atomically persists the reservation. `before` validates the
plan again, checks identity/amount and headroom, and durably records the next
ordered phase before dispatch. Each phase must be unique; number multiple sample
operations explicitly (`sample_0`, `sample_1`, …). Duplicate plans and duplicate,
skipped, or unplanned phases fail. `mark` accepts only `status` (`complete` or
`failed_unknown`) and `optimizer_acknowledged` (boolean). Completion requires all
declared phases to have been dispatched; the calling adapter must only mark it
after those operations and its evidence writes have actually succeeded.

The shared budget primitive assumes its calling adapter has computed a valid
conservative allowance and pinned the request. The updater does that internally;
the capture adapter must do it for sampling. Do not reserve a sample with an
update-token estimate. Do not delete/reset ledgers to recover headroom or treat
an ambiguous provider failure as a refund. The separate `.lock` file is stable
across atomic JSON replacement.

The update reserves

```
ceil_to_microdollar(safety_factor * (
    fixed_usd
    + train_token_allowance * train_usd_per_million / 1_000_000
    + teacher_prefill_tokens * prefill_usd_per_million / 1_000_000
))
```

SFT budgets one training pass; PPO/SDPO budget current forward plus backward at the
full training rate. SDPO also includes the full teacher input, including replayed
completion. No discount or cache saving is assumed. The positive fixed allowance
must cover creation, optimizer/checkpoint operations, storage through the specified
TTL, and other non-token charges under the supplied pricing assumptions. Rates
and assumptions are pinned to the model and saved with the plan. This is a local
reservation guard, not a provider-enforced dollar cap or a guarantee that an
incorrect price assumption cannot understate an invoice.

## Failures and verification

`complete` means the optimizer acknowledged exactly one update and both the
updated training checkpoint and sampler checkpoint were saved. It does not mean
the policy improved or was deployed. Release, retention, and learning checks
remain separate; `assessment` stays `null`/unknown.

Any dispatched-operation exception produces `failed_unknown`, keeps the full
reservation, and avoids automatic application retries. HTTP retries are configured
off (`ServiceClient(max_retries=0)`), and the teacher sampler explicitly receives
`tinker.lib.retry_handler.RetryConfig(enable_retry_logic=False)`.

Tinker 0.27.1 also has submission retries above HTTP for loading, gradient,
optimizer, and checkpoint operations. `disable_internal_retries` installs a
single-attempt `execute_with_retries` on this service's holder **before loading the
training checkpoint**, then verifies the returned trainer shares that holder.
This instance-only override leaves other holders unchanged and remains installed
for pending futures. It does not import the bootstrap module or patch SDK classes
globally. Normal future status polling remains necessary and is retained.

Before the production execution path writes output or reserves budget,
`audit_sdk()` checks the installed version and exact SHA-256 source hashes for
`service_client.py`, `training_client.py`, and `internal_client_holder.py` against
`SDK_SOURCE_HASHES`. The plan records these hashes and
`submission_retry_policy: "single_attempt_per_holder"`. A source mismatch blocks
execution; using the private holder seam with a different SDK requires a new
audit. Dependency-injected mock tests intentionally bypass the installed SDK gate.
Offline tests additionally check method signatures, disabled sampling retries,
typed data constructors, and the holder's single-attempt failure behavior.

If checkpoint saving fails after optimizer acknowledgement, the result and ledger preserve
`optimizer_acknowledged: true`. If the optimizer itself times out, false means
**unconfirmed**, not proof that no update happened. Examine the provider state
before any new plan. Provider exception text and credentials are not written to
the result or terminal.

Run the independent tests with:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --no-project --with tinker==0.27.1 \
  python -m unittest discover -s scripts/training -p test_native_tinker_update.py
```

Tests cover reserve-before-client/forward/optimizer, one-step dispatch order,
SFT/PPO/SDPO masks, actual behavior versus frozen teacher/current student,
staleness/alignment failures, missing capture/review/probabilities, fixture
rejection, source split and alias leakage, failed/partly completed operations,
private outputs, CLI planning without credentials, and offline SDK data types.
Dedicated cases cover independently rejected negative-PPO evidence, rejection of
incorrect signs or review decisions, holder isolation on submission failure, and
the pinned SDK source audit.
They establish the local consumer contract, not live Tinker billing or a trained
policy’s quality.
