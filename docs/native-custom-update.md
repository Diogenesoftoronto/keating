# Separate native custom-loss consumer

[`native_custom_update.py`](../scripts/training/native_custom_update.py) implements
`native-custom-update/v1` as a separate consumer. It leaves the existing
`native_tinker_update.py`, its immutable plans, and other workers' source pins
unchanged. It connects the [combined-loss kernel](native-combined-loss.md) to
Tinker 0.27.1's custom callback interface.

**Live execution is now recorded separately:** the [three-arm result](native-combined-results.md)
contains acknowledged F-only, S-only and F+S updates on actual native captures,
with a frozen SAE reward and delivered simulated learner feedback. This verifies
the training path, not improved tutoring. The tests described below use authored envelopes, the installed
SDK's actual custom-loss algorithm and value types, local transport doubles, and
an in-memory implementation of the existing ledger storage boundary. They do not
construct a ServiceClient, read a credential, make a live reservation, contact a
provider, or establish a model update or human outcome.

## API and evidence admission

For context-sensitive teaching judgments, `--features` also accepts a complete
[`native-contextual-rewards/v1` audit](native-contextual-rewards.md). Preparation
reconstructs its receipt-backed need/action views and reward arithmetic, then
feeds the resulting action scalars into F-only or F+S. This rewards warranted
explanations and penalizes both overhelp and underhelp. The original feature
envelope and historical narrow SAE reward remain supported unchanged.

```python
plan = prepare_custom_update(
    episodes, captures, reviews, splits, base_config, custom_config,
    feature_signals=None,
)
```

The inputs are original `native_training` episode/capture/review envelopes and
an externally supplied split manifest, not a claimed validated plan. Preparation
rebuilds exports with `native_training.build_exports` and passes them through
the unchanged base consumer's admission. It returns a new sealed plan with its
own hash, base-plan hash, feature-plan hash when applicable, raw-input hash,
source pins, rows, operation phases, and cost allowance. No ledger is touched.

F-enabled modes project each independently supported **action scalar** into a
constant token-advantage vector, without scaling, then call the unchanged PPO
`prepare_update` validator. That preserves independent review, feature evidence,
temporal boundaries, capture provenance, original IDs, actual sampler
probabilities, eligibility, family/source splits, and rejected-action sign rules.
The shared export validator requires delivered or retrospective segment-review
evidence; a pre-action need review cannot supply an action-feature advantage.
The scalar remains an action advantage in the custom kernel. An existing arbitrary
token-level vector is not silently averaged into this scalar.

S-enabled modes call the corrected `native_hindsight.prepare_signals` on the
original envelopes and retain its prefix proof bundle. The exact handoff is:

| Contract | Required value |
| --- | --- |
| Producer | `native-hindsight/v3` |
| Teacher projection | `native-hindsight-teacher-feedback/v1` |
| Projection contract hash | `0912a4c75f99aef1123cf5708df1b2e8f7380ce4f60a6f251bb5e2abf9bcae58` |

The teacher prefix is locally regenerated using that producer's allowlisted
next-learner-event and bounded-verdict projection. Original actor completion IDs
are replayed unchanged. Unrestricted review prose and delivered tutor/artifact
text stay outside the projected teacher input; the private plan retains the
producer's full provenance separately. S still requires the existing accepted
SDPO projection. F-only can use independently rejected actions with strictly
nonpositive advantages and at least one negative value, as the base PPO consumer
requires. F+S must satisfy both admission paths on matching captures, review
hashes, branches, and original segments.

The `renderer=` injection is a trusted local-test seam inherited from hindsight.
The normal S path uses the pinned local Qwen renderer, audited package versions,
and cached tokenizer files. No network tokenizer fallback is added. Preparation
fails if those local requirements are unavailable. F-only preparation imports
neither Torch nor Tinker. S preparation needs the renderer environment, even
though it makes no hosted calls.

## Explicit sealed configuration

`base_config` is an unchanged, valid base-consumer configuration with method
`ppo` for F-only or `sdpo` for S-enabled modes. Its model, tokenizer, account,
capture allowlist, lifetime, learning rate, and rate assumptions remain binding.

The custom envelope is sealed with
`native_training.seal(value, "custom_config_hash")`. It has exactly these fields:

```json
{
  "schema_version": 1,
  "kind": "native-custom-update/v1",
  "base_config_hash": "SUPPLIED_BASE_CONFIG_HASH",
  "loss": {
    "mode": "F+S",
    "feature_coefficient": 0.4,
    "sd_coefficient": 0.6,
    "anchor_coefficient": 0.1,
    "epsilon": 0.2,
    "feature_cap": 3.0,
    "sd_cap": 3.0,
    "max_abs_log_ratio": 2.0,
    "anchor_assumption": "logged_target_logprob_mse"
  },
  "hindsight": {
    "producer": "native-hindsight/v3",
    "projection": "native-hindsight-teacher-feedback/v1",
    "contract_hash": "0912a4c75f99aef1123cf5708df1b2e8f7380ce4f60a6f251bb5e2abf9bcae58"
  },
  "reference": {"kind": "initial_actor_snapshot_original_context"},
  "scoring_rates": {
    "model_id": "SAME_AS_BASE_MODEL",
    "source": "SUPPLIED_RATE_SOURCE",
    "verified_on": "YYYY-MM-DD",
    "sample_usd_per_million": "SUPPLIED_DECIMAL_USD_RATE"
  }
}
```

This is a schema illustration, not ready-to-execute evidence or a price claim.
All loss settings must be explicit. The kernel's coefficient and cap bounds
apply. Epsilon and staleness bounds must equal the base configuration; fixed caps
cannot exceed the base advantage cap. The new recipe remains
`independent_fixed_caps/v1`, not the base updater's EMA-based SDPO recipe.

Set `hindsight` to `null` for F-only. Set `reference` and `anchor_assumption` to
`null` when the anchor coefficient is zero. Set `scoring_rates` to `null` only if
both teacher and reference scoring are disabled. The optional anchor is the
declared logged-target squared-logprob surrogate, not full-vocabulary KL. A
reference snapshot uses the original context, independently of the teacher's
feedback-conditioned context.

### Action-feature envelope

For F-enabled modes, supply a sealed `features_hash` envelope with schema version
1, kind `native-action-feature-advantages/v1`, the rebuilt `export_hash`, and a
`signals` list covering exactly the selected captures. Each record contains:

- `capture_hash`, the original sealed independent `review`, and finite
  `action_advantage` within the base admission cap.
- `advantage_provenance.review_hash` and `feature_hash`, matching the independently
  reviewed feature and action.
- Nonempty `estimator_revision`, `baseline_revision`, and `source_revision`.
- `unit: "action_advantage"`, `aggregation: "per_action_completion_mean"`, integer
  `horizon_actions` in `[1, 64]`, and finite `discount` in `[0, 1]`.

These are supplied estimator attestations, not inferred provenance or proof of
causal learning. An absent or `null` advantage raises `CustomAbstention` during
preparation, before any reservation or client. Nonfinite values are invalid,
not unknown. Known zero remains zero; it does not drop the action from the mean.
Disabled F rejects an extraneous feature envelope.

## Audited SDK behavior and accounting

The installed 0.27.1 source was inspected directly. `audit_sdk()` reuses the base
audit and additionally pins sampling, custom-future, and retry implementations.
The complete SHA-256 mapping is stored in the module and each new plan. The
training-client hash is
`92a0b666a1006fe648e985c85c71e63d8eedaa114b0e91167ae14a029bbf31d6`.

The inspected custom method performs the following sequence:

1. Accept original target datums and insert zero weights for a cross-entropy
   forward when weights are absent.
2. Convert returned target logprobs into differentiable local Torch leaves and
   invoke the callback once.
3. Call local `loss.backward()` once. The callback itself does not call backward;
   its optional component diagnostics use `autograd.grad` while retaining the
   graph and leaving `.grad` unpopulated.
4. Send **negative local derivatives** as weights to summed cross-entropy
   forward/backward. The SDK performs no additional mean normalization.
5. Merge callback metrics into the backward result.

This consumer supplies target-only datums. It never feeds the base `datum()`
helper's already-scaled advantages into the callback. The live callback tensors
remain intact; they never pass through `completion_scores()` or a Python-list
conversion before loss evaluation. Only detached report values become lists.

Instance-local wrappers gate the SDK's actual `forward_async` and
`forward_backward_async` calls. Both must form exactly one SDK chunk. Before the
backward submission, transported weights must be finite and match the recorded
negative derivatives, including zero context-token weights. These wrappers do
not patch SDK classes or alter the old updater. Holder retries remain disabled
through the unchanged single-attempt helper.

The public synchronous custom wrapper waits without a timeout before returning
its final future. The consumer instead schedules the audited async implementation
and awaits its final result under one enclosing timeout. Hooks remain attached
to that one-shot client after failure so later dispatch still passes the ledger
gate. A timeout does not prove the dispatched operation was cancelled remotely.

The new plan charges two actor-token passes at the base full training rate:
one SDK forward and one summed-CE forward/backward. There is no separate
`student_forward` call. Local gradient computation is not another provider pass.
Teacher/reference `compute_logprobs` calls are budgeted for all supplied prefix
and completion tokens plus **one sampled token per call**, because the pinned
sampling implementation requests `max_tokens=1`. This is why an explicit sampling
rate is required. Context limits include that extra token. The total batch bound
also includes teacher/reference sequences and scoring samples.

The declared fixed allowance and safety factor are retained. This remains a
local pessimistic allowance, not an invoice or provider-side spending limit.

## Execution lifecycle

```python
result = execute_custom_update(
    episodes, captures, reviews, splits, base_config, custom_config,
    feature_signals,
    budget_path=budget_path, cap_usd=cap_usd, output_dir=new_output_directory,
    expected_plan_hash=previously_prepared_hash,
)
```

Execution recomputes the plan from raw inputs. The optional expected hash detects
changed evidence, settings, or consumer source; it is not a caller-supplied plan
accepted as authority. The normal path requires the existing explicit account
selection and environment-only credential route, SDK/source audits, a new private
output directory, and the unchanged `BudgetLedger` reservation before dispatch.
No new human approval workflow is introduced.

Teacher and reference each get a separate frozen sampler checkpoint from the
initial actor weights, with distinct returned paths. Their scored target IDs
match the original completion exactly. Snapshot and scoring operations remain
distinct phases; local operation IDs are not labeled as provider capture IDs.

The custom callback rejects invalid alignment, nonfinite selected values, stale
behavior ratios, and unavailable or zero signals. A zero total logprob gradient
also abstains before backward submission. After backward, completion scores
must still agree with callback scores within the existing `1e-4` tolerance,
remain within the behavior-ratio bound, and have finite returned metrics. All
checks precede the optimizer phase.

Only an acknowledged optimizer result sets `optimizer_acknowledged: true`. That
acknowledgement persists even if saving later fails. Training and sampler paths
are validated separately. Exceptions retain the reservation and mark the ledger
`failed_unknown`; no automatic retry or refund occurs. A callback abstention after
the SDK forward is recorded explicitly, while its consumed forward allowance
remains reserved. Raw provider exception text is not written to reports.

Outputs are private `plan.json` and `result.json` under the supplied new directory.
They include the projection proof, source pins, frozen scores, per-action loss
records, local gradient diagnostics, phase progress, and acknowledgement state.
They may contain original tokens and private evidence and are not public notebook
fixtures. Assessments remain `null`/`unknown`.

## CLI, tests, and notebook boundary

The default CLI prepares a plan from local JSON:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --offline --script scripts/training/native_custom_update.py \
  --episode episode.json --captures captures.json --reviews reviews.json \
  --splits splits.json --base-config base-config.json --custom-config custom-config.json \
  --features action-features.json --output .keating/custom-plan
```

Use repeatable `--episode` arguments for multiple episodes; omit `--features`
for S-only. An offline environment and the S renderer's pinned local files must
already be available. Execution additionally requires `--execute`,
`--budget-ledger`, `--cap-usd`, and a fresh output directory;
`--expected-plan-hash` binds a reviewed plan. See the separate live result above
for execution receipts; the commands shown here remain examples.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --offline --script scripts/training/test_native_custom_update.py
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --offline --script scripts/training/test_native_combined_loss.py
```

The consumer tests declare Tinker 0.27.1, CPU Torch 2.10.0, and NumPy 2.2.6 via
PEP 723. They need no Transformers or model download because they inject the
authored hindsight renderer. The math tests separately declare CPU Torch 2.8.0
and NumPy 2.2.6. Their direct unittest paths retain explicit optional-dependency
skips for minimal environments; the sandbox task declarations install the tested
dependencies rather than relying on those skips.

Coverage includes the actual SDK callback/negative-gradient contract, equal
action weighting, masks, mode admission, source pins, corrected hindsight,
independent snapshots, cost accounting, staleness, score drift, callback
abstention, invalid transport, timeouts, acknowledgement preservation, and
duplicate-plan rejection. All provider-shaped records are authored fixtures.

`prepare_custom_update` is the read-only API for a future consumer notebook.
Display authored plans or deliberately selected private summaries; keep
`execute_custom_update` outside reactive cells. The parent's separate math
notebook wraps the loss kernel. The separate `analysis/combined_reward_results.py`
now explores selected actual results without importing the execution path.
