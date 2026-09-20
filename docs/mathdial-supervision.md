# MathDial source teacher-move supervision

`scripts/training/mathdial_supervision.py` extracts the move tags attached to
teacher turns in the original MathDial **train conversations**. It produces
source-probe train/calibration/test partitions and exact temporal observer inputs.
It runs offline, verifies all five source collections, and never calls a model,
tokenizes a response, changes a registry, or updates an actor.

## What the labels mean

The pinned [MathDial dataset card](https://huggingface.co/datasets/eth-nlped/mathdial/blob/acc3878459e0bd8c04ab840056572f0b8b1abe1f/README.md)
defines the conversation field as `Persona: (dialog_act) text` turns separated
by `|EOM|`. The actual train asset contains four teacher tags: `generic`, `focus`,
`probing`, and `telling`. The target is precisely the recorded tag on one teacher
segment. It is neither an independent judgment that the tag is correct nor a
quality score. The importer makes no mapping to TutorMoments scaffolding, rigor,
Situation–Action–Result, learner need, or learning effectiveness.

[The official project description](https://github.com/eth-nlped/mathdial#description)
explains that human teachers interacted with an LLM simulating students. Teacher
utterances and their chosen moves are human-source material; learner replies,
initial errors and personas belong to the simulation setup. Names in those
personas are not identifiers of real children. Final teacher ratings describe
the source interaction and are not human learning measurements.

This importer records the pinned Hugging Face asset's CC-BY-4.0 declaration.
The GitHub README separately links BY-SA-4.0; retain the precise asset and card
provenance instead of silently replacing one declaration with the other.

## Run and integrate

From the repository root, using the already populated checksum-verified cache:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 \
  python3 scripts/training/mathdial_supervision.py inspect

rtk proxy env -u PYTHONHOME -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 \
  python3 scripts/training/mathdial_supervision.py build \
  --output .keating/outputs/mathdial-source-moves-v1

rtk proxy env -u PYTHONHOME -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 \
  python3 -m unittest discover -s scripts/training -p test_mathdial_supervision.py
```

`inspect` performs the full import and prints the manifest without writing data.
`build` requires a new directory under ignored `.keating/outputs/` or
`.keating/native-learning/scenarios/`. The directory is private (0700), files are
0600, and existing outputs are not overwritten. Missing cache assets fail; there
is no automatic download. `--cache` and `--registry` select explicit local inputs.

The notebook API is:

```python
import mathdial_supervision as supervision
import observer_core

bundle = supervision.build_supervision()  # or pass cache and registry explicitly
examples = bundle["examples.json"]["examples"]
projections = bundle["observer-inputs.json"]["records"]
views = {p["record_id"]: observer_core.boundary_view(p) for p in projections}
```

For a particular example, join through `example["observer_inputs"]["delivered"]`.
Verify its projection hash, observer text hash and template hash before attaching
actual features. Fit only rows with `target.fit_mask`; calibration and test rows
have `target.evaluation_mask` and remain out of fitting. The label is multiclass;
a binary probe consumer must explicitly choose a one-versus-rest class rather
than cast these strings or invent a numeric quality ordering. No features or
token IDs are supplied by this importer.

## Source and family checks

MathDial revision is pinned to
`acc3878459e0bd8c04ab840056572f0b8b1abe1f`. Train asset SHA-256:
`d6135869c02dccf8d14756fa2f0367c5352922bb263ec22dc0eeace4da815d43`.

All ten overlap assets from MathDial, Bridge, MRBench, MathTutorBench and
TutorMoments must exist and match both the source catalog and
`native_family_registry.json`. The importer reuses the shared native builder's
**family census**, including rejected/malformed original members; it does not
use the builder's opening-only scenarios to recover teacher labels. Original
qid aliases and normalized identical tasks stay together. Any connected test,
validation, benchmark or explicitly protected family blocks the entire group
before examples or observer inputs are exported. Existing development exposure
does not release a protected benchmark member.

The parent can use the resulting `family-audit.json`, manifest pins and group
partitions for source-probe admission. This module does not revise the shared
admission registry or grant policy-training permission. Its partitions are
authored development partitions within eligible published train material, not
the published MathDial holdout or a new sealed product release holdout. A
previously exposed family remains exposed even if it is in this probe's test
partition.

The pinned release has no stable human teacher/student identifiers, so this
export establishes task-family separation, **not person-held-out evaluation**.
Optional `--person-aliases path.json` can conservatively join known identities:

```json
{
  "schema_version": 1,
  "base_native_registry_sha256": "<exact canonical registry SHA-256>",
  "groups": [{
    "person_id": "<opaque stable source identity>",
    "role": "teacher",
    "family_ids": ["mathdial-qid-71", "mathdial-qid-72"],
    "evidence": {"source": "<identity-evidence locator>", "sha256": "<64 hex>"}
  }]
}
```

These are caller-supplied evidence assertions, not inferred or authenticated
identity. Unknown families, stale registry hashes, duplicate identities and
missing evidence pins fail. Protection propagates through joined person groups,
including links to other source collections. Without such evidence, the tool
does not merge simulated persona names or assert that people are disjoint.

## Temporal and annotation boundaries

Every example retains the source asset and record hashes, qid, original split,
conversation hash, teacher turn index, exact tag span, and exclusive source cut.
Offsets are half-open **Unicode codepoint** intervals in the original decoded
`conversation` string, not UTF-8 byte or model-token offsets. Retained action
pieces map explicitly from clean offsets back to source offsets. Prior turns
retain their original spans, cleaned text hashes and teacher removal maps.

The `pre_action` observer request contains the source task, initial learner
attempt and preceding conversation only. It has no target label. The `delivered`
request adds exactly one teacher segment, with pooling restricted to that
segment. Both are ordinary `observer_core.boundary_view` requests. Here
`actor_message`/`delivered` are that adapter's text categories for a recorded
source teacher utterance; they do **not** assert native Pi execution or artifact
delivery. `runtime_execution` is explicitly false.

The first move may follow the separately supplied initial attempt. Consecutive
teacher moves remain separate tagged segments; `cut.previous_role` reports the
actual prior role, without inventing an intervening learner event. No future
student reply enters either view. There is no retrospective supervision here.

All four annotation markers are removed everywhere in teacher text, including
earlier turns. This removes direct tag leakage while retaining semantic words
and mathematical parentheses. Unknown tags, malformed segments, empty teacher
utterances and unknown speakers are not guessed; they block affected causal
prefixes. A later malformed turn does not invalidate an earlier intact example.
The shared text-only context screen excludes references to missing visuals.

`ground_truth`, persona descriptions, confusion annotations and end-of-dialogue
ratings stay outside observer text. All targets remain in `examples.json`;
`observer-inputs.json` contains only allowlisted text and spans. Source labels
alone do not establish mathematically correct teaching or justify a reward.

## Verified cache census, 13 September 2026

Observed with native registry digest
`c7905a6659b285bd5bc5c18dc375d979b0ca9987217adfedb04a97c00adac5ca`,
without an additional person-alias file:

- 2,262 published train conversations, 599 published test conversations.
- 14,910 train teacher segments: 3,566 generic, 5,549 focus, 3,300 probing,
  2,493 telling, and two missing tags. These are source inventory counts.
- Full family closure admits 776 train conversations; 1,486 train conversations
  are excluded before label export.
- Context/segment checks yield **5,114 examples from 772 conversations in 334
  groups**, with **10,228 validated temporal observer requests**.
- Additional rejected teacher segments: 123 with missing visual context, 15
  empty turns, and 40 invalid causal prefixes. These are segment counts, not
  additional whole-conversation counts.

| Partition | Groups | Generic | Focus | Probing | Telling | Examples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 202 | 755 | 1,231 | 671 | 502 | 3,159 |
| Calibration | 66 | 235 | 358 | 212 | 168 | 973 |
| Test | 66 | 236 | 392 | 161 | 193 | 982 |
| Total | 334 | 1,226 | 1,981 | 1,044 | 863 | 5,114 |

Groups are ordered by SHA-256 of the versioned split salt and group ID, then
partitioned approximately 60/20/20. No class-driven regrouping or oversampling
changes holdout membership. Fewer than five eligible groups produces an explicit
unavailable split and disables all fitting masks. Every partition in this cache
has all four classes; class imbalance remains visible in the manifest.

The authored tests cover genuine schema shapes, all-five cache completeness,
tamper rejection, test/repack/protected-family closure, supplied person aliases,
unknown identities, source offsets, tag stripping, future invariance, absent
visual context, adjacent teacher turns, grouped masks and private no-overwrite
exports. No provider or observer model was called. Counts show source coverage;
probe accuracy, native-task generalization and human learning remain unmeasured.
