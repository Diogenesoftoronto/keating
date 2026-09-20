# Independent review of a delivered MathDial chat action

`scripts/training/native_episode_review.py` prepares evidence for an independent
reviewer and validates that review before producing the existing
[`native_training` segment-review schema](native-training-exports.md#independent-review-schema).
It does not call a model, grade keywords, infer quality from a simulator's reply,
invent labels, reconstruct token IDs, or update the scenario/runtime. Python
dependencies are standard library only, declared with PEP723.

The scope is one selected delivered chat action of a MathDial development
episode. `prepare --step-index 0` selects the initial action; use `--step-index 1`
for the second action and distinct output files for each packet/review. The
second packet retains the preceding learner reply as context. Later learner
replies are excluded; no simulator reply establishes learning. Only the source question, initial incorrect solution,
and reference solution enter the private mathematics review. The source future
dialogue, self-correctness ratings, and student profile do not. The reviewer must
independently check the mathematics; even the source reference is not an oracle.

## Prepare actual evidence

Wait for the actual episode file. Replace `EPISODE.json` and `CAPTURES.json` below
with the parent's completed ledger and original-capture envelope. `CAPTURES.json`
must have `schema_version: 1` and `captures: [...]`, as consumed by
`native_training`; it is not the surrounding capture-binder report. Omit
`--captures` if they are unavailable. That still permits a descriptive review,
but no SFT review can be emitted for an uncaptured segment.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --offline --script scripts/training/native_episode_review.py prepare \
  --episode EPISODE.json --captures CAPTURES.json \
  --scenario .keating/native-learning/model-stage-zero/scenario.json \
  --source-jsonl .keating/datasets/sources/mathdial/acc3878459e0bd8c04ab840056572f0b8b1abe1f/train.jsonl \
  --source-review .keating/native-learning/model-stage-zero/source-review.json \
  --output .keating/native-learning/model-stage-zero/episode-review-packet.json \
  --form-output .keating/native-learning/model-stage-zero/episode-review-judgments.json
```

Both outputs are evaluator-only, mode 0600, and must remain outside the tutor's
and simulator's accessible workspace. Existing files are never overwritten.
Validation precedes writing; the two optional outputs are separate files, not
an atomic multi-file transaction. If interrupted, retain the valid prefix of
the output operation and choose new output names when retrying.

The packet binds the exact episode, ledger head, runtime, source asset and row,
scenario, prior source review, capture envelope, delivered feature and rubric.
It reuses `validate_episode`, `validate_capture` through `build_exports`, and
`feature_inputs`. It verifies the episode's admitted scenario hash and initial
opening against the source-reviewed scenario. Cross-dataset admission and source
suitability rely on the already completed admission/source-review stages.

Each actor message in the selected step is a separate target. The packet shows its
text/tool requests and the actual delivered observation. Full runtime state,
unrelated tool results, actor thinking blocks, and later actor outputs are
excluded. Empty or absent captured text must not be turned into positive
evidence; an unassessable target warrants abstention. New delivered documents or
controls trigger `artifact_review_required`; this first chat contract refuses
acceptance until that separate scope is reviewed through a later contract.

## Record the independent judgment

The form starts with `decision: "pending"`, `verdict: "unknown"`, empty reasoning
and citations, and unavailable reviewer identity/time. These placeholders cannot
pass finalization and are not training labels. A reviewer supplies:

- `reviewer`: `{kind: "independent_model", id, model: {provider, id, revision}}`.
  Bernoulli/Codex must record its own actual model provenance, distinct from the
  Qwen tutor and simulated learner. Do not invent a checkpoint hash. If an exact
  model revision is not exposed, state that limitation explicitly in the revision
  provenance and independence statement; this is not a pinned-revision claim.
- `reviewed_at`: an explicit timestamp with timezone; `independence_statement`:
  how this evaluator is separate from the actor, simulator and adapter author.
- One judgment per target, in packet order, with reasoned checks for mathematics,
  support quality, learner agency and evidence discipline. Every known pass/fail
  must quote actual target or delivered text using an `event_id`, `event_hash`
  and exact `quote`. Initial learner evidence can supply additional context.

For example, a citation has the shape
`{"event_id": "ACTUAL_EVENT_ID", "event_hash": "ACTUAL_EVENT_HASH", "quote": "EXACT_DELIVERED_TEXT"}`.
These are placeholders, not an example quality judgment. The reviewer must
explain what the cited response means in this particular mathematical context.
Quote matching prevents fabricated evidence; it cannot prove semantic reasoning.

Use `accept` only with four explicitly known passes; `reject` when any check
fails; `abstain` when at least one check is unknown and none fails. This is a
consistency rule for the reviewer's declarations, not automatic grading of the
tutor. Unavailable evidence stays unknown, and no learning-success score exists.
Model identity checks reject the actor/simulator ID, including trivial case and
provider-prefix variants. They cannot authenticate a claimed reviewer or detect
all aliases; operational independence remains the reviewer's responsibility.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --offline --script scripts/training/native_episode_review.py finalize \
  --episode EPISODE.json --captures CAPTURES.json \
  --scenario .keating/native-learning/model-stage-zero/scenario.json \
  --source-jsonl .keating/datasets/sources/mathdial/acc3878459e0bd8c04ab840056572f0b8b1abe1f/train.jsonl \
  --source-review .keating/native-learning/model-stage-zero/source-review.json \
  --packet .keating/native-learning/model-stage-zero/episode-review-packet.json \
  --judgments .keating/native-learning/model-stage-zero/episode-review-judgments.json \
  --output .keating/native-learning/model-stage-zero/episode-review-audit.json \
  --reviews-output .keating/native-learning/model-stage-zero/episode-reviews.json
```

Finalization reconstructs the packet from the current original inputs and rejects
any change. Accepted/rejected captured segments produce sealed `kind: "segment"`
reviews with the exact capture hash, six event-reference fields, delivered
feature hash, latest allowed event ID, reviewer and rubric revision. Reasoning
and source bindings live in `feedback`. The produced `episode-reviews.json` can
be supplied directly to `native_training.py export --reviews`; `build_exports`
is called during finalization to verify compatibility. An audit is retained for
abstentions and missing captures, with no permissive substitute review.

These are **delivered-boundary** reviews. They do not authorize SDPO hindsight,
infer human learning, or establish tool/provider reliability. Failed later
execution does not erase reviewable evidence in an earlier delivered prefix.
Acceptance is a judgment about that response's suitability as a demonstration;
training, independent admission and release gates remain separate.

## Local verification

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --offline --script scripts/training/test_native_episode_review.py
```

Fourteen authored tests cover future exclusion, pending/unknown decisions,
source/packet/capture tampering, quotes and event hashes, actor/simulator identity,
artifact scope, missing captures, SFT schema compatibility and exclusive writes.
They do not grade a real tutor. Authored episodes require a test-only Python
opt-in and retain `fixture_only`/ineligible export status. The CLI offers no
fixture promotion option. Actual model review requires the parent's real episode
and this reviewer's subsequent reasoned judgment.

## First actual episode review

On 13 September 2026, Bernoulli/Codex reviewed both delivered chat steps in
`.keating/native-learning/model-stage-zero/episode-v1/episode.json`, using the two
original captures in `bound-v1/captures.json`. The evaluator-only packets, filled
judgments, audits, combined exact-schema `reviews.json`, and `summary.json` are
under `.keating/native-learning/model-stage-zero/independent-review-v1/`.

Both segments were rejected for SFT. The first gives the correct total but adds
undefined bid/skip notation, misdiagnoses the quantity confusion, and assumes a
notes pane and learner progress unsupported by the delivered evidence. The
second's displayed arithmetic passes; its support still fails because it treats
a tutor-like simulated reply as following the explanation and insists on an
unavailable notes pane. Both observations contain no documents or available
actions. This review assessed emitted text and recorded delivery, not browser
rendering. The simulated learner's JSON was valid, with zero repairs recorded.

The raw outcome remains `budget_exhausted`. The parent identifies this as the
one-decision horizon limit; the review does not reinterpret it as financial
exhaustion or rewrite the ledger. Human learning remains unknown. Both sealed
reviews retain `accepted: false`; validation produced zero SFT/hindsight records.
Any separate use of rejected policy segments for a negative PPO experiment must
retain this decision and declare its own advantages and training contract.
