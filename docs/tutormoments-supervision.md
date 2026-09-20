# TutorMoments source SAR supervision

`scripts/training/tutormoments_supervision.py` imports the **published source
annotations**, with separate situation, action and result targets. It does not
attach source labels to changed Keating episodes. Its inspect/build commands
read the pinned local cache offline; the explicit fetch command downloads only
the public pinned source files and their card/schemas. There are no provider,
credential or model-training operations.

The three source SAR files are now downloaded and verified. The actual corpus
contains **11,489 human SAR moments**, separately from the preserved 520 frozen
reference moments. The parent-adopted source-only sidecar now admits 73 SAR
families in 55 student groups. Existing temporal and disagreement masks still
limit fitting evidence to two groups total, one group per target. Both are in
train; calibration and test have zero fitting labels. This is admitted source
evidence, not a viable calibration experiment.

## Commands and outputs

From the repository root:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/tutormoments_supervision.py fetch
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/tutormoments_supervision.py inspect
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/tutormoments_supervision.py build --output .keating/outputs/tutormoments-sar-corpus-next
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 -m unittest discover -s scripts/training -p test_tutormoments_supervision.py -v
```

`--cache` selects a source cache with the same pinned bytes.
`--source-registry` defaults to `scripts/training/source_supervision_registry.json`.
An absent sidecar retains default denial; malformed, stale or mismatched
admission aborts before creating an output directory. Fetch does not use it.
All five collections must be present for the existing source-family closure
check. `fetch` verifies the pinned card/schemas before downloading the three
SAR files from exact revision URLs. It publishes complete verified bytes with
exclusive hardlinks and refuses to overwrite corrupt or existing files.
`inspect` prints counts and hashes, without
source text. `build` requires a **new** explicit directory under the existing
ignored output roots; directories use mode 0700 and files mode 0600. Existing
outputs are not overwritten. Inspect/build leave cache files, registry and the
exposure ledger unchanged. The current admitted corpus is in
[`.keating/outputs/tutormoments-sar-admitted-v1/`](../.keating/outputs/tutormoments-sar-admitted-v1/),
with its [manifest](../.keating/outputs/tutormoments-sar-admitted-v1/manifest.json)
and [partition/target coverage](../.keating/outputs/tutormoments-sar-admitted-v1/family-splits.json).
The immutable pre-admission proposal remains in
[admission-proposal.json](../.keating/outputs/tutormoments-sar-admission-proposal-v1/admission-proposal.json)
with its [original manifest](../.keating/outputs/tutormoments-sar-admission-proposal-v1/manifest.json).
The earlier `.keating/outputs/tutormoments-sar-corpus-v2/` snapshot predates
proposal generation and intentionally has no `admission-proposal.json`.
Preserve both snapshots; choose a new output name on rerun.

| Artifact | Contents |
| --- | --- |
| `manifest.json` | Revision, asset status and exact hashes, counts, exclusions, output content hashes |
| `source-targets.json` | Private human SAR, structured targets, origins, joins, cut positions, masks and disagreements |
| `inputs.json` | Allowlisted text views; no SAR, evaluator labels, personas or session metadata |
| `family-closure.json` | Full native source-family census plus same-student transcript grouping |
| `family-splits.json` | Whole-family train/calibration/test membership, or an explicit insufficient-evidence status |
| `rejected.json` | Non-SAR caption pass exclusions |
| `unjoined-ground-truth.json` | Structured source moments that could not be joined uniquely; never fitting examples |
| `alias-requirements.json` | Exact source identity joins and proposed admission requirements; never approval |
| `admission-proposal.json` | Separate default-deny `source_supervision` section, exact allowlist and authored grouped partitions, pending parent review |
| `source-admission.json` | Validation result and hashes of the separate sidecar, base native registry and recomputed proposal; unchanged cut policy |

Only feed an entry from `inputs.json.views[boundary]` to an observer. Join private
targets afterward by example ID. Do not serialize `source-targets.json` into a
model prompt. Source record hashes and annotation indices make every example
traceable back to exact source lines, rather than inferred identities.

## Source and label contract

The revision is **`66058b4c7ef5e7631b3c4d39a1dfa8172e36d8bc`** of
`allenai/tutormoments-preview`. The cached card and the publisher's schemas were
inspected. The schemas identify human free-text SAR separately from an
LLM-assisted structured mapping. A target derived from that mapping is not a
direct human binary judgment.

| Private target | Published field | Known mapping | Observation boundary |
| --- | --- | --- | --- |
| `situation.scaffolding`, `situation.rigor` | `situation_label` | `yes` → 1, `no` → 0 | Pre-action |
| `situation.aggregate_scaffolding`, `situation.aggregate_rigor` | `situation_label_agg` | `both`, `scaffolding`, `rigor`, `neither` → their explicit memberships | Pre-action |
| `action.scaffolding`, `action.rigor` | `action_direction_agg` | Same memberships, using the **action** field | Delivered action |
| `result.positive` | `student_outcome_agg` | `pos` → 1, `neg` → 0 | Retrospective |
| `result.effectiveness` | `strategy_label` | `effective`, `partial`, `ineffective` retained as categories | Retrospective |

`unclear`, `unknown`, `mixed`, `no_mention`, `no_evidence`, absent fields and
unrecognized values have `value: null, mask: 0`. Absence is not a negative label.
The categorical effectiveness target is not a BCE target. `both` does not force
an exclusive choice between rigor and scaffolding. Unknown labels retain their
raw value, field name and mapping origin. Decomposed facets and overscaffolding
text stay private source evidence; the importer does not infer new binary
overscaffolding labels from prose or empty lists.

Human situation/action/result texts each retain a `direct_human_annotation`
origin and a known-text flag. Caption annotations are retained as exclusion
records, not converted into SAR. The annotation pass key includes transcript,
annotation type, annotator and interface version. Duplicate pass identities
abort. Joining a structured source moment requires exact transcript, annotation
type, annotator, turn range and all three SAR texts. Conflicting present moment
IDs or cut positions reject the join. Ambiguous matches remain unknown and
preserve candidate references. A second annotator's disagreement does not
silently replace the first label: individual values remain, and conflicting
exact-span targets receive `fit_mask: 0`.

Repeated aggregate labels share an `evidence_group` across annotator copies and
alternate cuts. Their fitting weights sum to one within that group; the manifest
reports unique known evidence groups separately from row counts. Per-annotator
situation labels retain separate annotator evidence identities. These fields
let downstream probes avoid treating replicated aggregate labels as new votes.

The frozen reference lane supplies only the positive chosen situation label.
Its other situation dimension, action and result stay unknown. Its oracle
student reference and persona are never parsed into SAR supervision.

## Temporal inputs and eligibility

The source transcript's actual numbered turns are the input authority. The
importer excludes session descriptions and Gemini enrichments from the views.
Missing transcripts, unaligned turns, absent/invalid cuts and missing visual or
problem context produce explicit view rejections. It does not obtain missing
worksheets from later dialogue or infer a cut from the desired teaching move.

- **Pre-action:** transcript through the annotator's cut, ending on a learner
  turn. The cut and range must agree. No later utterance or SAR prose enters it.
- **Action:** that prefix plus the immediate tutor block. A source action span
  that starts before the decision, or covers tutor actions after learner
  feedback, cannot label this immediate block; its action view is withheld.
- **Retrospective:** the transcript through the source moment's final turn,
  requiring a learner consequence after the action. Later turns remain excluded.

Each view stores `latest_allowed_turn` and an exact content hash. A missing view
does not erase a published label: `mask` means the source target is known;
`fit_mask` additionally requires an eligible family, an unambiguous temporal
view and no conflicting judgment. The importer does not assess human learning.

Family decisions come from `native_family_registry.json` and the shared
builder's **full five-source census before scenario rejection**. All moments,
passes, views and derived rows of a transcript stay together. If cached
transcripts establish that the same student appears in multiple sessions,
those families are joined too, propagating protection to their entire group.
Unregistered families remain denied unless the exact source-only sidecar admits
them. Public benchmark family membership blocks
source-probe fitting even when that family was previously exposed in native
development; that exposure does not grant a fresh holdout or release the source
benchmark for training. This module never modifies registry admission.

The sidecar reserves its exact authored train/calibration/test groups before
label availability is inspected. The importer never reshuffles these groups
to fill a missing class or partition. `groups_with_fit_labels` and per-target
`target_coverage` report actual usable rows, unique evidence groups, student
groups and values in each partition. Without a sidecar, the previous pure
splitter remains available and this corpus has no admitted fitting rows.

## Verified cache inventory and next gate

The offline inventory traversed **6,049 records across all five pinned source
collections**, plus the three newly cached SAR files. Their full published JSON
Schemas were checked with `jsonschema==4.26.0`: **zero validation errors** over
1,584 annotation passes, 207 ground-truth records and 462 transcripts.

The human annotations contain 79 caption passes, 704 scaffolding passes and 801
rapport passes. The 1,505 non-caption passes contain **11,489 SAR moments**.
The ground-truth file contains **10,685 structured moments**. Exact joins connect
9,639 SAR entries; 804 lack a matching structured entry and 1,046 have ambiguous
matches. Ambiguous source records remain inspectable with their hashes and
candidate references. Many are repeated structured records; the importer does
not silently choose one or infer missing annotator/interface identities.

Known labels below count SAR rows, excluding the separate frozen reference
lane. Aggregate copies have fewer unique evidence groups, reported in the
manifest; these are not independent learner counts. The fitting column below
describes the preserved pre-admission proposal snapshot.

| Target group | Known source labels | Fitting eligible |
| --- | ---: | ---: |
| Per-annotator scaffolding situation | 3,079 | 0 |
| Per-annotator rigor situation | 1,750 | 0 |
| Aggregated scaffolding/rigor situation | 3,829 each | 0 |
| Scaffolding/rigor action | 4,872 each | 0 |
| Positive/negative student outcome | 4,156 | 0 |
| Categorical effectiveness | 9,550 | 0 |

The separate reference lane retains 260 scaffolding and 260 rigor situation
labels, none eligible for fitting. The SAR temporal screen produces **481
pre-action, 28 action and 283 retrospective views**. Missing/invalid cut points,
missing task or visual context, non-learner cuts and ambiguous multi-turn action
spans remain explicit rejections. A passed screen is not independent semantic
suitability review. Rapport and scaffolding effectiveness are separate
constructs and do not create artificial cross-construct disagreements.

Expected source-file identities, already embedded in the offline verifier:

| File | Bytes | Pinned identity |
| --- | ---: | --- |
| `annotations.jsonl` | 10,255,887 | SHA256 `8a7adc65b8c63a78950a278eda5e4feaa5a093bab02d964bad1027468e18914f` |
| `ground_truth.jsonl` | 11,131,708 | SHA256 `9735b8c83575098dfac6928d1ff32a0aa283700651598ab9a7757879d6edcfda` |
| `transcripts.jsonl` | 38,117,914 | SHA256 `34b5d4483302593043f3d9be3bf37f1cde6cba5b031fd2d20d75a15d5498f276` |

The annotations asset is stored as a Git blob at the pinned publisher revision;
its verifier additionally checks Git blob SHA1
`ffee6b0fdf052251f42d54fe39a41cf3992620ce`, including the object header.
Every loaded asset and
exact JSONL line also receives a SHA256 in the output. No cached hash becomes a
new trusted pin merely because a file exists.

## Exact alias and admission handoff

The SAR entries span **209 transcript families / 144 student groups**. There
are **89 protected groups and 55 groups formerly excluded solely for absent
registry admission**. The source-only sidecar now admits those 55 groups.
Across the full 462-transcript
file, 350 transcript families are absent from the current native family census.
All **520 frozen composite joins validate** against the corresponding
transcript's tutor ID, student ID and transcript ID.

`alias-requirements.json` enumerates every transcript with its exact file/line
hash, human annotation references, ground-truth references, frozen moment IDs,
cuts, same-student family closure and current exclusions. Its proposed identity
mapping is:

```text
family = "tm-" + transcripts.transcript_id
annotations.transcript_id = transcripts.transcript_id
ground_truth.conversation_id = transcripts.transcript_id
moments.provenance.conv_id = tutor_id + "_" + student_id + "_" + transcript_id
```

The last alias is proposed only where the frozen moment actually exists; no
missing frozen moment is invented. The proposal uses a **distinct
`source_supervision` registry section** with all three SAR asset hashes. It
preserves the existing native `sources.tutormoments` moments benchmark contract.
The parent adopted that exact section in a separate sidecar, preserving the
native registry hash. The importer has made **no registry or shared-module
edit** and rejects any family absent from the verified source allowlist.

## Concrete post-fetch admission proposal

The completed proposal is
`.keating/outputs/tutormoments-sar-admission-proposal-v1/admission-proposal.json`.
Its canonical unsigned content hash is
`e3011e20797a8c79386f7470118aa223bd75ad37b904351b597d536cc5949ccb`,
bound to registry hash
`c7905a6659b285bd5bc5c18dc375d979b0ca9987217adfedb04a97c00adac5ca`.

**73 SAR transcript families in 55 student groups survive protected closure.**
They contain 3,778 human SAR entries. Their same-person components cover 127
transcripts, including derivatives without SAR annotations. The exact 73-family
allowlist is in `source_supervision.sources.tutormoments.allowed_families`; the
55 complete components are in `family_groups`. The other 136 SAR transcript
families remain blocked. This calculation includes the entire five-source
census, all known native aliases, 1,102 protected seed families from frozen
benchmark/source-test/source-validation or explicit protection, and same-student
connections across every published transcript. It does not infer undocumented
cross-dataset person identities.

| Known labels in the surviving families | Rows before temporal/disagreement masks |
| --- | ---: |
| Per-annotator scaffolding / rigor situation | 84 / 44 |
| Aggregated scaffolding / rigor situation | 99 / 99 |
| Scaffolding / rigor action | 130 / 130 |
| Positive/negative outcome | 85 |
| Categorical effectiveness | 3,101 |

The proposal records the SAR release as **unpartitioned published source**.
Hugging Face's loader label `train` is retained as publisher metadata and
explicitly confers no training admission. Source-probe partitions are authored
here: sort student-group IDs by SHA256 of the recorded salt and ID; assign the
first floor(N/5) groups to calibration, the next floor(N/5) to test, and the rest
to train. This gives **33/11/11 groups**, containing **48/11/14 allowed SAR
families**. Every derivative inherits its complete group's assignment. Selection
does not depend on labels, model outputs or scores.

These are source-group reservations, not a claim that the corresponding probe
datasets are viable. The importer rechecks source pins, recomputes the full
protected closure and sealed pre-admission proposal, verifies the exact section
and retains all temporal/unknown/conflict masks. Adding admission cannot
override a newly discovered protected edge.

Even among the 55 nonprotected groups, current known labels with usable temporal
views and no exact-span disagreement occur in only two families:

- `tm-5cbca390-fcd6-51e9-8b0b-c56fb82729e3`
- `tm-6c10db3b-b970-5221-9364-8eeb5bc660a5`

They are now admitted source evidence, with one student group per target. The five
known action rows are all scaffolding-positive/rigor-negative within one group;
the three outcome rows are all negative within one group. This is insufficient
for a meaningful source-probe train/calibration/test evaluation. Review
cut/context alignment and acquire independently eligible
coverage; do not weaken protected-family closure or manufacture missing views.

The real corpus, proposal and admitted builds completed offline with the native
registry unchanged. **37 tests pass**, including public fetch integrity, no-overwrite
behavior, exact alias checks, cross-source test-alias/same-person protection,
deterministic authored partitions, proposal generation without admission and
sidecar validation. An admitted CLI build ran with socket connections blocked;
source cache, both registries, original cuts, input hashes, protected reference
entries and the original proposal were unchanged.
Native readout calibration still needs independently reviewed native labels;
this source importer does not inherit judgments onto changed tasks or episodes.

## Sidecar validation and admitted evidence

The parent-owned `scripts/training/source_supervision_registry.json` has exactly
`schema_version: 1`, `base_native_registry_sha256`, `proposal_sha256` and
`source_supervision`. Its canonical hash is
`0560ec51050daf6289080228fc85257272ac0a48e29d64004f4165b3166d36d6`.
Validation binds it to the original proposal hash above and the unchanged
native registry. The complete source census, source pins, same-person closure,
allowlist and authored partitions must reproduce that proposal exactly.
Only `unregistered_source_family` may be removed from a source SAR example's
refusals; protected, invalid-source, unknown-label and disagreement exclusions
remain effective. Frozen reference entries never pass through this admission.

| Target | Fitting rows | Unique evidence groups | Train student groups | Calibration / test rows |
| --- | ---: | ---: | ---: | ---: |
| Per-annotator scaffolding situation | 4 | 4 | 1 | 0 / 0 |
| Per-annotator rigor situation | 3 | 3 | 1 | 0 / 0 |
| Aggregated scaffolding / rigor situation | 11 each | 4 each | 1 | 0 / 0 |
| Scaffolding / rigor action | 5 each | 1 each | 1 | 0 / 0 |
| Positive/negative student outcome | 3 | 2 | 1 | 0 / 0 |
| Categorical effectiveness | 4 | 4 | 1 | 0 / 0 |

The admitted output retains the original `admission-proposal.json` unchanged,
including its historical zero-fit counts. Current counts are in `manifest.json`
and `family-splits.json`; proposal generation always precedes applying admission.

## Derived-cut-v1 investigation (not enabled)

The published annotation schema defines a turn range and a separate optional
annotator cut. The ground-truth schema binds action labels to the union of
action facets over an exact-span cluster, without first-action localization.
The [paper, Appendix C, pp. 32–33](https://tutormoments.allen.ai/static/paper/tutormoments-preview.pdf#page=32)
defines the range around the entire instructional sequence, potentially beginning
with problem introduction and continuing through its outcome. Its separate cut
instruction requires a student turn with sufficient context for the next tutor
decision. Section 3.4 footnote 3 notes that situation judgments may be scoped to
different cuts within the same span.

Consequently, a teacher span-start preceded by a student turn permits a
deterministic **candidate** `cut = start - 1`, but does not establish that the
source situation/action labels apply to that decision. It requires separate
review of prefix sufficiency and target scope. Derivation must use only the
aligned range and roles; private labels and later text must not choose the cut.
Missing worksheet/visual evidence remains rejected. A multi-turn action label
cannot label the first tutor block; a multi-turn outcome cannot become that
first action's independently measured effect. Any accepted derived boundary
must retain its own version, source hashes and review provenance, without
overwriting an explicit cut or becoming an official benchmark cut.

The [diagnostic audit](../.keating/outputs/tutormoments-derived-cut-v1-audit/audit.json)
uses the reviewed 73-family allowlist and unchanged context screen:

| Missing-cut candidate stage | SAR rows | Student groups |
| --- | ---: | ---: |
| No explicit annotation cut | 473 | 55 |
| Aligned teacher start immediately after a student | 130 | 46 |
| Existing context screen passes | 10 | 4 |
| Complete first tutor block with no later tutor action in the span | 0 | 0 |

Of the 130 role-qualified candidates, 77 fail the problem-context screen and
43 fail the visual-context screen. The ten survivors have no known,
nonconflicting situation or action labels; two have an `effective` label for
the whole multi-turn sequence. These are pending-review candidates, not added
fitting examples. The missing-cut rule does not currently solve calibration.
Separately, 140 role-qualified records already have explicit cuts equal to
`start - 1`; these merit their own scope/context review because the current
within-span check rejects them. The
[explicit-cut diagnostic](../.keating/outputs/tutormoments-explicit-cut-before-span-audit-v1/audit.json)
finds six pass the unchanged context screen (94 lack problem context; 40 lack
visual context). Those six provide no nonconflicting known situation/action
labels and no first-action-scoped examples. The initial admitted build
intentionally keeps the within-span check and all original cut values unchanged.

Publisher references: [dataset card](https://huggingface.co/datasets/allenai/tutormoments-preview),
[annotation schema](https://huggingface.co/datasets/allenai/tutormoments-preview/resolve/66058b4c7ef5e7631b3c4d39a1dfa8172e36d8bc/annotations.schema.json),
[structured mapping schema](https://huggingface.co/datasets/allenai/tutormoments-preview/resolve/66058b4c7ef5e7631b3c4d39a1dfa8172e36d8bc/ground_truth.schema.json),
[transcript schema](https://huggingface.co/datasets/allenai/tutormoments-preview/resolve/66058b4c7ef5e7631b3c4d39a1dfa8172e36d8bc/transcripts.schema.json).
