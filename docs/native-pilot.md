# Native pilot: Stage 1 planning and paired reporting

`scripts/training/native_pilot.py` prepares a development pilot of **30 distinct
source situations × chat/interactive × three paired replicates = 180 episode
slots**. It performs no inference, dispatch, training, source download, or budget
reservation. Candidate selection is available before runnable model settings or
independent reviews exist.

The current real selection is in the ignored directory
`.keating/outputs/native-pilot-candidates-v1/`: `selected-ids.json` contains the
30 scenario IDs and `candidates.json` records selection rationale, coverage,
the input bundle hash, and every selected source-family group. It contains
14 MathDial, 12 Bridge, and four TutorMoments situations in 30 family groups.
MRBench and MathTutorBench currently have no admitted development scenarios in
this pack. This artifact contains no policy settings, ratings, or approvals.
**The actual 180-episode pilot has not run.** Its runnable plan awaits the
coordinator's exact actor/learner settings and independent source/format reviews.

## Admission and candidate selection

All CLI commands replay [native scenario admission](native-scenario-adapters.md)
against the full pinned source cache, including records outside the requested
dataset. The supplied development bundle must exactly match that replay. No
network fallback exists. A missing cache, changed original, changed public view,
unauthorized family, or stale admission bundle fails validation.

The planner rejects test/validation family members. Previously exposed
TutorMoments benchmark families can participate only through the existing
registry's explicit development exception. This does not authorize new protected
families or make exposed data an untouched holdout. Planning uses already
materialized development data and never relaxes or rewrites its exposure journal.

Selection cycles through available datasets in stable ID order, preferring
distinct origin-family clusters before additional cuts from a family. Duplicate
record identities and identical normalized opening evidence do not fill extra
slots. The full family census connects aliases, including connections through
unselected records. A source family is an origin grouping, not a count of people.
The selection is for development coverage; it is not a random population sample.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_pilot.py candidates \
  --scenarios .keating/native-learning/scenarios/adapters-development-verified/scenarios.json \
  --output .keating/outputs/native-pilot-candidates-next
```

`candidates.json` gives IDs, family groups, dataset admission/rejection counts,
selection rationale, and outstanding prerequisites. `selected-ids.json` can be
passed directly to `plan --selection`. It has no raw conversations or originals.

## Freeze the experiment after settings are known

The coordinator supplies a JSON configuration. There are no default actor,
simulator, rubric, or fabricated checkpoint pins. Required top-level fields:

| Field | Required content |
| --- | --- |
| `authors` | Nonempty array naming the adaptation and policy/configuration authors, used by independence checks |
| `seed` | Integer in `[0, 2^32)` used to assign paired replicate seeds |
| `actor`, `learner` | Each has `model`, immutable `revision`, `prompt_sha256`, and `sampler` with `temperature`, `top_p`, `max_tokens` |
| `runtime` | `revision` of the exact runnable runtime |
| `rubric` | `revision`, content `sha256`, and `metrics` array; each metric has `id`, operational `definition`, `unit`, finite `minimum`, `maximum` |
| `limits` | Positive integers: `max_decisions` ≤ 6, `max_sessions` ≤ 2, `max_provider_calls` ≤ 12, `max_tool_calls` ≤ 16, `max_repairs` = 1, `turn_timeout_ms` ≤ 120000, `learner_timeout_ms` ≤ 120000 |
| `conditions` | Exactly `chat` and `interactive`; each has matching `surface`, the real `tool_schema_sha256`, and `learner_actions` |

Chat's `learner_actions` is `[]`. Interactive's is
`["submit-answer", "choose-option", "update-notes"]`. Ordinary messages,
reopen/new-session and stop remain controller events. The surface/tool contract
is the declared experimental difference. Actor and learner checkpoints, prompt
policy, samplers, limits, and initial evidence are shared across both formats.

Pins are recorded and hashed; this offline tool cannot verify a remote service's
checkpoint identity or seed support. The runner must record what actually ran.
Paired seeds identify matching replicates and must not be presented as proof
that a provider honored a seed. Any changed configuration defines a new plan.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_pilot.py plan \
  --scenarios .keating/native-learning/scenarios/adapters-development-verified/scenarios.json \
  --selection .keating/outputs/native-pilot-candidates-v1/selected-ids.json \
  --configuration CONFIGURATION.json \
  --output .keating/outputs/native-pilot-plan-v1
```

`plan.json` stores exact native scenarios, shared public-evidence hashes,
source/registry/census hashes, actor/learner/runtime/rubric/limits/condition
manifests, and 180 stable slots. Each slot references one situation and binds
its condition, replicate, seed, and manifest hashes. There is no second copy of
the initial evidence that a condition can independently rewrite. Full scenarios
include private `evaluation_only` material: only the existing allowlisted
actor/learner projections may be passed to a provider.

`reviews.json` is a **pending review form**. All approval, independence, and
suitability flags start false; reviewer and evidence fields are null. These are
not reviews and must never be automatically turned into approvals.

## Independent review gates and dispatch interface

For all 30 selected situations, independent reviewers must complete:

- `source_context`: `context_complete`, `initial_evidence_preserved`, `approved`,
  and `independent` must be true. Missing worksheets, visual context, ambiguous
  task content, or invented reconstruction must be resolved by review or replaced
  with another eligible situation; they cannot be filled in by the planner.
- Both `formats.chat` and `formats.interactive`: `format_suitable`,
  `initial_evidence_preserved`, `approved`, and `independent` must be true.
- Every review has a nonempty `reviewer` and `evidence: {uri, sha256}` referencing
  the actual review artifact. The reviewer must differ from declared authors and
  actor/learner identities. All reviews bind the exact `plan_sha256`.

The flags are attestations to independently performed work. Hashes and identity
comparisons do not authenticate a reviewer or prove the quality of a review.
The coordinator must retain and audit the referenced evidence. Offline test
fixtures use explicitly authored approval objects to exercise rejection logic;
they are never operational review artifacts.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_pilot.py ready \
  --scenarios .keating/native-learning/scenarios/adapters-development-verified/scenarios.json \
  --plan .keating/outputs/native-pilot-plan-v1/plan.json \
  --reviews REVIEWED-PAIRS.json \
  --output .keating/outputs/native-pilot-ready-v1
```

`dispatch.json` has `executes: false`, the frozen plan and review bindings, and
`slots`. It is input to a separately authorized runner, not an execution command.
For each slot, resolve its `situation_id` against `plan.situations`, pass that
entry's unchanged `scenario` to the real native runtime, and apply the pinned
condition contract. Record actual receipts after execution. Future content,
answer keys, source results, and evaluator criteria remain outside public views.

The `validate` command takes `--scenarios` and `--plan`, reconstructs the complete
plan from the pinned originals/configuration/selected IDs, and rejects drift.
Every `ready` and `report` CLI invocation also performs this validation. Pure
Python callers must call `load_admitted_bundle` and `validate_pilot` before
consuming an external plan; the pure functions do not silently load sources.

## Attempt and assessment records

`--attempts` is a JSON array, with one record per attempted slot. A missing record
means **unattempted**, not a successful or failed episode. A started attempt that
was interrupted is recorded explicitly. Fields:

| Field | Meaning |
| --- | --- |
| `slot_id` | Exact `dispatch.slots[].id` |
| `plan_sha256`, `dispatch_sha256` | Frozen experiment and reviewed dispatch bindings |
| `manifest_hashes`, `scenario_sha256`, `initial_evidence_sha256` | Actual run bindings, matching the assigned slot |
| `status` | `started`, `complete`, `learner_stop`, `tutor_failure`, `provider_failure`, `invalid_learner_action`, `delivery_failure`, `budget_exhausted`, or `assessment_unavailable` |
| `receipt` | `{uri, sha256}` identifying an actual runtime artifact; may be null only while `started` |

Duplicate slots, unknown slots, and changed bindings fail. Retries and partial
delivery evidence belong inside the runtime receipt; they are not additional
independent pilot replicates. Preserve a started attempt on interruption, then
replace that slot's attempt record with its actual final status when known.

`--outcomes` is a separate JSON array of externally assessed observations, with
one record per `(slot_id, metric)`. Fields are `slot_id`, `metric`, `value`,
`assessor`, `independent`, `evidence: {uri, sha256}`, and `rubric_sha256`.
The last field is **`plan.manifest_hashes.rubric`**, binding the whole metric
manifest, including units and bounds. A known value must be finite, within the
declared range, independently assessed, and backed by evidence. Actor/learner
identities cannot assess themselves. The reporter cannot authenticate that
evidence; the review process is responsible for its validity.

Absent values and explicit `null` stay unknown. Zero is a known measured value.
Runtime completion never creates a rating, failed delivery never defaults to
zero learning, and an unfinished attempt cannot have a known assessed outcome.
An independent assessment of a valid prefix may accompany an eventual episode
failure only when the metric definition and evidence justify that scope.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_pilot.py report \
  --scenarios .keating/native-learning/scenarios/adapters-development-verified/scenarios.json \
  --plan .keating/outputs/native-pilot-plan-v1/plan.json \
  --dispatch .keating/outputs/native-pilot-ready-v1/dispatch.json \
  --attempts ATTEMPTS.json --outcomes OUTCOMES.json \
  --output .keating/outputs/native-pilot-report-v1
```

Omitting attempts/outcomes produces a planned-only report with all outcomes
unknown; a dispatch specification is required as soon as any attempt is supplied.
Outputs must be new ignored directories under `.keating/outputs/` or
`.keating/native-learning/scenarios/`, resolving within the workspace. Existing
outputs are not overwritten. Private payload files use mode `0600`.

## Paired estimates and uncertainty

Reports retain all planned slots in condition/dataset denominators, separate
attempted, unattempted, unresolved, failure, and explicit terminal status counts,
and show known/unknown outcomes for each metric. Every selected source-family
group remains in the metric report, including groups with no attempts or no
known outcomes. Their effects are null, not absent or zero.

For each metric, match chat and interactive by **the same situation and
replicate**. Compute `interactive − chat` only if both values are known. Average
matched replicate differences within a situation first. Available-pair estimates
then weight situations equally; they do not give a situation three times the
weight because it has three observed replicas instead of one.

The primary uncertainty calculation resamples whole source-family blocks from
the full alias census. Selected cuts and aliases within a family stay together.
It reports both a situation-weighted and an equal-family-weighted effect with
percentile 95% intervals. With fewer than two observed family clusters, intervals
are null. Bootstrap defaults are 2000 draws and seed 42; CLI controls are
`--bootstrap` and `--seed`. These intervals characterize available family clusters,
not a human population and not uncertainty about unobserved outcomes.

`full_pilot_effect` stays null until all 90 replicate pairs are observed.
`full_family_effect` likewise requires every replicate in that family. Available
effects are explicitly conditional on observed pairs; missingness can bias them.
Report the support counts alongside estimates. Neither independent people nor
learning gains are inferred from synthetic branches or execution receipts.

## Notebook and offline checks

`analysis/native_pilot.py` declares marimo, pandas, NumPy, and matplotlib through
PEP 723. Open it through the existing notebook task. It verifies artifact hashes
and plots candidate coverage, planned/attempted denominators, all source-family
effects with unknown values labeled, and paired family-bootstrap intervals. It
reads `native-pilot*` artifact directories in the two permitted output roots.
It never generates a report, a rating, an approval, or an episode.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 -m unittest discover \
  -s scripts/training -p test_native_pilot.py
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 MPLBACKEND=Agg \
  uv run --script analysis/native_pilot.py
```

The authored fixtures exercise pairing, zero versus missing outcomes, failure
denominators, family clustering through aliases, pending/independent review gates,
admission replay, frozen evidence, and output boundaries. Their numeric values
are arithmetic checks, not measured tutor ratings. No inference is part of these
tests or this Stage 1 tooling delivery.
