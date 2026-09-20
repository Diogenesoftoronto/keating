# Teaching judgment in the training signal

The tutor should explain when an explanation advances understanding, and leave
room when the learner is making useful progress. The same explanation can be
appropriate after recurring mistakes and excessive during a productive attempt.
Neither an explicit request nor a fixed count of failures decides this.

[`native_contextual_rewards.py`](../scripts/training/native_contextual_rewards.py)
implements `native-contextual-rewards/v1`. It uses the
[automatic response-grading protocol](teaching-v4-response-grading.md) on separately
admitted **training episodes**. It classifies learner need from the visible prefix,
then localizes tutor moves and judges their fit, substance, and correctness from
the delivered response. Actual delivered activity text is included with receipt
references, so a useful chat message cannot conceal an answer revealed in a card.

This adapts the separation of localization, classification, and reward judgment
in [Features as Rewards, v3](https://arxiv.org/html/2602.10067v3#A3.SS1.SSS5).
The tutoring labels and reward mapping below are our experimental design. This
implementation does not reproduce that paper's trained hallucination probes.

## What changes in an update

| Independently classified response | Grade | Action reward at scale 1 |
| --- | --- | --- |
| Appropriate, substantive and correct explanation, hint, question or other move | 2 | +1 |
| Appropriate but insubstantial help | 1 | 0 |
| Overhelp, underhelp, misdirected help, incorrect, illegible or benchmark-meta output | 0 | −1 |
| Unknown need, fit, substance or correctness; insufficient confidence | Unknown | No consumable signal |

`reward = reward_scale × (grade − 1)`, with a declared scale in `(0, 1]`.
The reward is an **immediate action advantage with a fixed zero baseline**, horizon
one and discount zero. It describes the delivered teaching move. A later claim of
understanding does not turn it into measured learning.

The existing custom consumer accepts the complete contextual audit through its
`--features` argument. At preparation and execution it reconstructs the visible
inputs, exact span checks, classifier request hashes, scores and action scalars
from the original episodes and saved decisions. Changed evidence or arithmetic
fails this check. It records `contextual_reward_hash` in the training plan.

The resulting scalar feeds the existing **F-only** and **F+S** loss. F means the
behavioral feature signal; S means next-turn hindsight distillation. Each action
has one completion mean, so response length and the number of highlighted spans
do not multiply its reward. Actor-authored tool-call tokens can remain targets;
learner, tool-result and prompt tokens remain context. Span offsets describe
learner-visible text, not actor token indices.

In F+S, the frozen teacher still receives the actual next learner event through
the existing allowlisted hindsight projection. The need classifier never receives
that future event. Contextual classifier prose is not appended to either actor or
teacher prompts; its scalar enters the F term. F and S retain separate coefficients
and diagnostics. This permits measuring agreement or conflict between signals.

Independently rejected actions can receive negative F-only updates. They are not
silently admitted as positive demonstrations or accepted hindsight examples.

## Freeze the measurement before using it

Create a sealed specification with `native_training.seal(spec, "spec_hash")`:

```python
spec = seal({
    "kind": "native-contextual-rewards/v1",
    "classifier": classifier_manifest,
    "reward_scale": 1.0,
    "excluded_family_aliases": classifier_calibration_and_test_families,
    "excluded_sources": [
        {"dataset": dataset, "record_id": record_id, "record_sha256": sha256}
        for dataset, record_id, sha256 in classifier_holdout_sources
    ],
}, "spec_hash")
```

The classifier manifest uses the same protocol, immutable artifact revision,
calibration hash and predeclared confidence threshold as automatic grading.
Activation classifiers additionally pin the frozen observer manifest. The
classifier must differ from the actor and learner simulator. This interface is
independent of their model sizes; it does not apply an SAE to a different model's
activations.

Uncalibrated model judges and fixture classifiers can generate diagnostic audits,
but cannot export training signals. A calibration hash is an artifact pin, **not
an automatic finding of adequate calibration**. The experiment's calibration
review must justify its threshold and intended domain before that pin is used.

Both v4.0 and v4.1 family and case identities are automatically excluded, including
registered `family:` aliases. The spec also excludes the classifier's calibration
and test families and source records; identical source hashes are rejected even
after a rename. The existing native split registry continues to enforce training
membership, source provenance and protected flags. Carry source-family aliases
through every adaptation and branch.

## Run the preparation, then the existing trainer

Use the original native episode, capture, review, split and base-config files.
Do not pass `response-grades` from a v4 benchmark run as training data.

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --no-project --with typer python scripts/training/native_contextual_rewards.py \
  --episode episode.json --captures captures.json --reviews reviews.json \
  --splits splits.json --base-config base-config.json --spec reward-spec.json \
  --classifier-config classifier-config.json --output contextual-rewards.json

rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --offline --script scripts/training/native_custom_update.py \
  --episode episode.json --captures captures.json --reviews reviews.json \
  --splits splits.json --base-config base-config.json --custom-config custom-config.json \
  --features contextual-rewards.json --output new-training-plan
```

The first command invokes the explicitly configured classifier: two calls per
admitted action, bounded by its call/time limits. A hosted classifier must use the
experiment's budgeted provider adapter. The second command only prepares a plan.
The [existing execution command](native-custom-update.md#execution-lifecycle)
then rebuilds that plan and reserves against the existing shared ledger before
any training dispatch. Keep classifier costs and training costs in that same
experiment accounting; do not create another $100 allowance.

## Verification and remaining experiment

Offline tests use authored provider envelopes and classifier decisions. They
exercise context-dependent reward sign, underhelp, visible artifact evidence,
future exclusion, exact spans, unknown abstention, protected source aliases,
tampered audits, both feature-enabled modes, and the actual CPU Torch custom-loss
callback with prompt masking. Run them with:

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --offline --script scripts/training/test_native_contextual_rewards.py
```

The historical `premature_answer` SAE head and `native-feature-rewards/v2` retain
their narrow explicit-request scope. No old checkpoint is relabeled as having
learned this broader judgment. The next experiment needs a calibrated contextual
classifier, separately admitted natural training contrasts, and matched F-only,
S-only and F+S updates evaluated on untouched v4 families. This integration has
not fitted those broader probes or executed another hosted update.

Multiple actor segments in one delivery abstain until credit can be assigned
unambiguously. The current projection handles receipt-backed semantic text;
visual-only information requires its own validated observation path. Hashes and
exact offsets establish evidence binding, not the truth of a classifier decision.
