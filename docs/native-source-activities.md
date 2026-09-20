# Source screens become real activities

For the Gemini 3.8 Flash expansion of MathDial and Bridge, including new reviewed
text-entry practice surfaces, see [contextual data expansion](native-data-expansion.md).

`native_source_activities.py` turns a reviewed source screen into an unanswered
canonical OpenUI question. `native_episode.ts` delivers that document through the
actual Pi session before asking the adaptive learner for its next action. A choice
uses the production submission handler, advances the document revision, records a
receipt, and gives the tutor the submitted attempt.

The original TutorMoments reference remains unchanged. The native variant retains
the original record hash, family, decision cut and source text. The conversion
adds a separate document and a private mapping review. It does not inherit a source
success label or recreate a historical student's click as a new runtime receipt.

## What changes

| Original evidence | Native interaction | Preserved |
| --- | --- | --- |
| A narrated screen with labeled options | `question`, `kind: choice`, with those option IDs and labels | Task wording, option order, source identity and prior attempts |
| An explicitly described answer field | `question`, `kind: text` | Prompt and field affordance |
| A diagram or worksheet whose content is missing | Deferred for review | Missingness and reason |
| A completed earlier screen followed by a new task | Earlier screen is not reopened as current | Decision boundary |

The first source review considered **12 development moments from four source
families**. Eight multiple-choice moments from three families became activities;
four were deferred. One deferral caught an earlier multiplication screen that the
conversation had already left. Three described a written equation without an
actual input-field affordance. Those remain chat material.

Mappings preserve awkward original options too: the source's `10 110` distractor
is retained, rather than silently repaired into a different answer. Every mapping
quotes only pre-cut evidence. An `agy` drafting attempt returned a truncated-output
error; its usable draft was repaired and separately checked against the cited
source text. The review record preserves that failure and the subsequent changes.

## Delivery and learning boundaries

```mermaid
flowchart LR
  S[Reviewed source screen] --> D[Pi custom source message]
  D --> V[Learner-visible OpenUI question]
  V --> A[Learner chooses or types]
  A --> R[Production submission receipt]
  R --> T[Tutor responds to the attempt]
  T --> E[Independent review and training export]
```

The initial delivery is `source_observation`, with runtime origin. It is context
for the observer and actor, never an actor-generated target. The export validator
binds it to the actual custom session entry and opening message. Subsequent actor
responses retain their own token boundaries. A source-only episode has no actor
training segment.

Interactive and chat conditions receive the same question and options. Chat gets
plain text with no controls. Neither view receives the private rubric, later human
continuation, answer key, or evaluation-only source record. A submitted answer is
an attempt requiring tutor review; delivery alone does not establish correctness.

## Reproduce and inspect

The CLI requires a completely replayable admitted source bundle and one mapping
decision per moment. It rebuilds admission from the pinned cache and family
registry before creating a new output directory:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_source_activities.py \
  ORIGINAL_BUNDLE.json REVIEWED_MAPPINGS.json \
  --reviewer REVIEWER_ID --output .keating/native-learning/scenarios/NEW_DIRECTORY
```

The local source review and eight runnable scenarios are under
`.keating/native-learning/scenarios/openui-source-v1/`. `mapping-review.json`
records the review, `adapted/activities.json` records counts and deferrals, and each
adapted scenario has its own JSON file. Keep source-derived records in this ignored
dataset area; the checked-in tests use independently authored material.

Run a scenario through the existing `native_episode.ts` entry point with a separately
configured learner and actor. Actual model execution uses its explicit funding
path; conversion itself performs no model calls. The source submission integration
tests use real Pi with authored response tapes.

## Limitations and next experiment

These eight moments are three source families, not eight independent learners.
The review establishes format suitability; it does not validate the tutoring
response. The restored document represents a fresh unanswered attempt while prior
human actions remain prefix evidence. Text-only diagrams and invented widgets are
not admitted. Terminal execution does not prove browser rendering.

Next compare source-text and native-control conditions on the same admitted
families, with a responsive learner, independent rubric review and explicit
delivery-failure counts. Keep these development families out of any claimed sealed
release holdout.
