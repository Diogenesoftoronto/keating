# Expanding contextual teaching data with Gemini 3.8 Flash

The expansion uses `agy --model gemini-3.8-flash-high` to draft source-derived
teaching contrasts and review them in separate sessions. A source situation becomes
several possible interactions: a productive attempt, recurring confusion, a useful
explanation, a premature answer, vague withholding, and help aimed at the wrong
problem. The learner's evidence determines whether the response is appropriate.

The same response appears twice in each context-flip pair. An explanation that
interrupts useful reasoning can become appropriate after persistent difficulty.
The examples also include diagnostic questions, corrective feedback, modest
scaffolds, unsupported mastery claims, neutral acknowledgments, and explicit
unknowns. Each response has exact highlighted spans and separate need, fit,
substance, correctness, and grade fields. These follow the
[contextual reward design](native-contextual-rewards.md).

## Inspect the original local run (v1)

Drafting packets, original drafts, separate review decisions, and `agy` logs live
in `.keating/outputs/agy-scale-v1/`. The compiled dataset lives in
`.keating/outputs/contextual-data-v1/`. Its `manifest.json` records actual accepted
counts, rejected examples, source deferrals, split counts, and content hashes.

The completed first run selected 60 source families and planned 600 contrast
slots. Twelve incomplete or ambiguous sources were deferred before drafting,
leaving 480 drafted examples. Separate review rejected one context-flip response:
“Exactly right” affirmed a learner who had only expressed confusion. The compiler
removed both members of that pair. The result is **478 model-reviewed examples
from 48 source families**: 278 MathDial examples and 200 Bridge examples.

| Result | Training | Calibration | Test | Total |
| --- | ---: | ---: | ---: | ---: |
| Accepted source families | 32 | 8 | 8 | 48 |
| Contextual examples | 320 | 80 | 78 | 478 |
| Native OpenUI text activities | 27 | 8 | 8 | 43 |
| Positive SFT candidates | 128 | 0 | 0 | 128 |

The 478 examples yield **956 observer records in ten extraction shards** and
**47 complete context-flip pairs**. All 12 source deferrals remain recorded,
accounting for 120 unfilled slots. Five further practice prompts omitted necessary
quantities; their teaching contrasts were accepted, but their proposed activity
documents were rejected. No rejection was replaced to reach the target count.

| Artifact | Use |
| --- | --- |
| `examples.json` | Inspect authored context, tutor response, classifications, rationale, localized spans, source identity, and review decision |
| `observer-inputs.json` | Pre-action need views and delivered-response views; future evidence and private labels stay out of model text |
| `observer-shard-*.json` | At most 100 records per extraction job, carrying the original split and family aliases |
| `sft-candidates.json` | Only training-split responses graded appropriate, substantive, and correct |
| `scenarios.json` | Accepted source tasks with an unanswered canonical OpenUI text question, plus split envelopes |
| `scenarios-train.json`, `scenarios-calibration.json`, `scenarios-test.json` | Explicit partitions for native execution planning |
| `scenarios/*.json` | Individual scenario files accepted by the native scenario validator |
| `splits.json` | Original frozen family membership, including deferred sources |
| `rejected.json` | Source deferrals and individual contrast rejections |

For one concrete pair, inspect source `bridge-fe7c64a16d0d78bc84eb5b65`, concerning
200 divided by 4. A learner starting to use 20 divided by 4 can continue the
reasoning. A learner repeatedly guessing 8, 16, and 24 needs more support. The
contrast holds the tutor's explanation constant and changes that preceding
evidence. The adapted activity asks the original question, “How many times 4 in
200?”, using an unanswered text field. It does not supply 50 as an answer key.

The original task and initial learner evidence remain source text. Subsequent
learner attempts and tutor replies are explicitly authored synthetic branches.
`runtime_executed`, `learning_outcome`, and `behavior_logprobs` record false or
unknown values; they are never filled from the imagined conversation.

## Repeat or extend the workflow

Start with a fully replayable development bundle from the
[source adapters](native-scenario-adapters.md). The pinned source cache and family
registry must be available locally. Preparation performs no model calls.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_data_expansion.py prepare \
  --bundle .keating/native-learning/scenarios/adapters-development-verified/scenarios.json \
  --output .keating/outputs/NEW-PACKETS \
  --families 60 --batch-size 10 \
  --prior-observer .keating/native-learning/mathdial-probe-v1/observer-inputs.json
```

Preparation joins connected source-family aliases before selection, excludes both
frozen v4 versions and all supplied prior-observer families, and fixes the split
before drafting. Sixty selected families produce 40 training, 10 calibration, and
10 test families. A rejected source stays in its original partition; the compiler
does not move it or invent replacement examples. Supply every previously used
observer pack with another `--prior-observer` argument when extending a run.

The reusable runner fixes the model to Gemini 3.8 Flash, bounds concurrency, and
preserves valid existing outputs when resumed:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/agy_contextual_data.py draft \
  .keating/outputs/NEW-PACKETS --jobs 2
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/agy_contextual_data.py review \
  .keating/outputs/NEW-PACKETS --jobs 2
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_data_expansion.py compile \
  .keating/outputs/NEW-PACKETS --output .keating/outputs/NEW-DATASET
```

Use `--batch batch-000` to run one batch. Each job owns one output file and writes a
timestamped log and receipt containing its model, prompt hash, exit status, and
elapsed time. Review sessions read the public source and draft, recompute the math,
and write decisions without editing the draft. Compilation binds each review to
the exact draft hash, replays source admission, checks connected-family separation,
and rejects a context-flip pair if either member fails review. A new output
directory is required, preserving previous artifacts.

The initial six drafting jobs used the logged launch scripts and prompts in
`.keating/outputs/agy-scale-v1/`; subsequent runs use the checked-in templates.
`current_template_hashes` identifies those templates at compilation, while runner
receipts identify the actual per-job prompt. Both keep their respective provenance.

Verification passed for source/admission replay, all 60 connected-family bindings,
exact span offsets, the 600-slot accounting, train-only positive SFT selection,
observer sharding, and every exported file hash. All 43 generated documents and
their serialized delivery envelopes passed the production TypeScript validator.
The focused Python contracts passed 27 tests; the existing source-document Bun
integration passed five tests through real Pi using authored response tapes.
Resuming all six review jobs retained their existing outputs without new calls.

## Native activities

[`native_practice_activities.py`](../scripts/training/native_practice_activities.py)
adds a reviewed text-entry affordance to a self-contained visible task. Its prompt
must be quoted verbatim from the admitted opening. A separate decision checks that
the quotation contains all necessary task information and no solved answer.

This is an authored format adaptation. It differs from the existing
[source-screen adapter](native-source-activities.md), which preserves an observed
multiple-choice or text-field interaction. Existing TutorMoments choice mappings
remain intact. The expansion does not invent multiple-choice options for a source
that contains none, or turn an absent diagram into a text problem.

Both adapters use the native runtime's existing source-document delivery and
submission path. Preparing a scenario creates no receipt. Native execution must
deliver the activity and record the learner's actual submitted attempt itself.

## Limitations and next use

This is a model-reviewed synthetic concept set. Drafting and review use separate
sessions of the same model, so they can share mistakes. Manual adjudication and
held-out calibration are still required before these labels support a trained
reward classifier. Repeated branches remain grouped by source family; example
counts are not learner counts. Template regularities and the mathematics-only
domain need stress testing on naturally occurring responses.

The stored source metadata lists MathDial as CC BY 4.0 and Bridge as CC BY-NC 4.0.
Those tags and original record hashes accompany derived examples. The mixed pack
is a research dataset; Bridge's noncommercial restriction is retained. Generation
does not erase source terms. Source payloads and generated examples remain in
ignored local storage, while checked-in tests use authored fixtures.

The next experiment compares text, raw-activation, and matching frozen-SAE probes
on these fixed partitions, calibrates thresholds on calibration families, and
evaluates once on test families. Fit the need probe from pre-action records and
the action probe from delivered-response records. Unknown labels stay absent.
Do not use test families as a source of later training examples.

Positive SFT candidates can support a separately configured supervised warm start.
PPO/SDPO and contextual reward updates require real actor token IDs, actual sampler
probabilities, delivery evidence, calibrated judgments, and next-event evidence
where applicable. This expansion does not execute those updates or spend from a
new Tinker/RunPod allowance.

## Feedback revision (v2)

The review in `.keating/outputs/contextual-data-review-v1/review.md` identified
misleading place-value explanations, rounded values presented as exact, an
unsupported “free game” premise, inconsistent learner-need labels, and missing
positive demonstrations of appropriate restraint. The user requested corrections
through agy using Gemini 3.8 Flash.

Revision jobs in `.keating/outputs/agy-feedback-v2/` receive that review, the
unchanged source packet, their previous draft and previous review. Each job owns
one new draft. Separate review sessions evaluate the revised examples and bind
their decisions to the new draft hash. The original pack and source-family
partitions remain intact. Incomplete sources and rejected examples remain
explicit exclusions; revisions are not required to fill a quota.

The compiler now emits `native-contextual-data/v2` with these contracts:

- SFT includes reviewed, correct, appropriate training responses at grades 1 and
  2. This includes a brief acknowledgment that lets productive reasoning continue.
  Neither questions nor unsolicited explanations receive automatic credit.
- Each candidate declares `last-assistant-message/v1`, a final-message index,
  target-text hash and message weights. Every earlier message has zero weight.
  `tokenization_status: not_prepared` remains explicit: the actual actor renderer
  must enforce this contract and verify token weights before training. The pack
  is not an input to an all-assistant loss without preparation.
- Observer labels keep `fit.appropriate`, `help.correct`, `help.substantive` and
  `help.substantive_appropriate` distinct. The ambiguous v1 `help.appropriate`
  alias is removed. Existing probe cards using the old label need a new version;
  changed target semantics must not be mixed silently.
- Observer `annotation_spans` preserve exact reviewed semantic spans and moves.
  They are private supervision, not an input to the observer. Extraction `spans`
  still pool the complete last event, so gold error locations cannot leak through
  the selection of activations. Span annotations and pooling spans have different
  purposes. These annotations identify moves; the response's overall fit or
  correctness must not be copied onto every clause. Per-span correctness/fit
  supervision needs its own adjudication, especially for mixed-quality responses.

The revised drafting and review prompts also apply these corrections to future
packs. Mixed responses contain separately marked useful and problematic clauses.
Need labels follow learner evidence rather than a generation batch or the type
of tutor move. This remains model-reviewed supervision; token localization,
calibration and causal effects still require their own experiments.

Native OpenUI trajectories are collected through the real execution path. Text
revisions do not manufacture tool calls, receipt IDs, behavior log-probabilities
or future learning outcomes to fill missing training coverage.
