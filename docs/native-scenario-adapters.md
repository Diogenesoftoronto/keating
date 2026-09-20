# Native scenario adapters

These adapters produce **initial evidence for actual Keating execution** from
the pinned originals in `benchmark_sources.py`. They do not write a successful
conversation, choose the tutor's move, call a simulator, grade a learner, or run
a model. All five adapters produce the same version-1 scenario contract.

## Run

The source cache must contain every pinned data asset from all five collections,
even when selecting just one source. This is required to resolve cross-collection
family overlap. The builder never downloads or executes upstream code.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_scenarios.py inspect --source all
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_scenarios.py build --source all --output .keating/native-learning/scenarios/my-development-run
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_scenarios.py validate --source all --output .keating/native-learning/scenarios/my-development-run
```

Use `--purpose reference` on **both build and validate** to materialize reference
families. That is a new native evaluation condition, not the upstream official
benchmark or a pristine release holdout. `--source` accepts `mathdial`, `bridge`,
`mrbench`, `mathtutorbench`, `tutormoments`, or `all`. No sampling or hidden limit is
applied: every selected record is either eligible or explicitly rejected.

`--cache` selects the pinned cache location. `--registry` selects an explicit
admission registry; it cannot change the hard rule against using original
test/validation/benchmark splits for development. Source-specific exceptions are
limited to the already exposed TutorMoments conversation families.

Outputs must be in a Git-ignored directory under `.keating/outputs/` or
`.keating/native-learning/scenarios/`. Build requires a fresh directory and never
overwrites an existing bundle. The complete source-derived payload, including
restricted originals, stays ignored. Only adapter code, authored test fixtures,
schema, registry identifiers/hashes, and this documentation belong in Git.

## Runtime interface

```json
{
  "schema_version": 1,
  "id": "source-stable-hash",
  "family": "original-family-id",
  "source": {
    "dataset": "mathdial",
    "revision": "pinned-40-character-revision",
    "record_id": "train.jsonl#row=0",
    "sha256": "canonical-original-record-sha256",
    "license": "publisher-declared-license",
    "original_split": "train",
    "transformations": ["native-starting-state-v1"]
  },
  "actor": {"opening_message": "Task and pre-decision evidence"},
  "learner": {
    "profile_evidence": [{"kind": "observed_learner_utterance", "text": "Observed attempt"}],
    "assumptions": []
  },
  "evaluation_only": {}
}
```

This abbreviated example documents the public interface; the machine schema
requires full hashes and private provenance fields. Dataset names are catalog
IDs. `record_id` uses the pinned asset path and zero-based row offset, so records
without a publisher ID are still traceable **without inventing family identity**.
`source.sha256` hashes canonical JSON of the entire original record: sorted keys,
UTF-8, no ASCII escaping, compact separators, no nonfinite JSON numbers. The
separate asset-byte hash is `evaluation_only.asset.sha256`.

The output directory contains:

| File | Contents | Consumer |
| --- | --- | --- |
| `scenarios.json` | `{schema_version, source, purpose, registry_sha256, summary, scenarios, rejected, families}` | Local coordinator/evaluator only |
| `actor.json` | Array of `{id, opening_message}` | Actor request construction |
| `learner.json` | Array of `{id, profile_evidence, assumptions}` | Learner policy context |

Read `scenarios.json["scenarios"]` for the common scenario objects. Never send the
whole bundle to the actor or learner. `public_views(scenario)` returns fresh,
allowlisted `actor` and `learner` dictionaries. Source profiles that contain
authored psychological claims, solutions, teacher judgments, and future responses
remain in `evaluation_only.original`. Native assessment is always
`{"status":"unassessed","outcome":null}`. A learner's already observed attempt
may of course contain a proposed answer; that is available evidence, not a hidden
answer-key field.

The pure Python API is
`build_native_scenarios(load_source_records(cache), registry, source, purpose,
exposed_families)`. Production callers must pass the complete loader result, not
a filtered list. The CLI additionally enforces ignored output paths, exposure
journaling and publication. `validate` reloads the pinned originals, reconstructs
the entire admission/grounding result, and compares every bundle and projection;
checking just the schema is insufficient to establish source grounding.

## What each adapter changes

| Source | Actor-visible initial evidence | Private source material | Origin family |
| --- | --- | --- | --- |
| MathDial | Problem and original learner attempt, before the tutoring conversation | Ground truth, source persona, teacher confusion label, original conversation and ratings | Original `qid`; equal normalized problems merge qid aliases |
| Bridge | `c_h` history ending at a learner decision | Original/revised tutor responses, revision continuation, error/intervention labels | Conversation part of `c_id` |
| MRBench/BEA v3 | Parsed `conversation_history`, ending at a learner decision | Candidate tutor responses and their annotations | Matched original MathDial question or unique informative Bridge learner utterance |
| MathTutorBench bundled tasks | Source problem and history with trailing tutor candidate removed | Reference solution and the full history, including the withheld candidate | Same original MathDial/Bridge join; never its array offset |
| TutorMoments | Latest explicit `PROBLEM_CHANGE` starting boundary through the frozen cut; full prefix if no explicit boundary exists | Rubric, dimension, reference-aware student configuration and future continuation | Original conversation/session UUID, compatible with the existing native pack |

The serializer preserves source text and mathematical symbols. Identity matching
normalizes Unicode/whitespace and typographic quotes, but retains operators and
token boundaries. It does not fuzzy-match mathematical tasks or treat a repack's
UUID as an independent person. Bridge joins require an informative learner
utterance of at least 24 normalized characters and one consistent source
conversation; short generic replies, conflicting anchors, and unresolved
identities are rejected. This intentionally sacrifices coverage for traceability.

TutorMoments equal-number enriched turns remain ordered and valid. Out-of-order
or post-cut context is rejected. When a new explicit problem boundary exists,
earlier unrelated tasks are excluded; the exact start index is recorded. Source
screen descriptions can supply textual problem evidence but do not establish
that a native activity was delivered. The runtime must create its own receipts.

Visual references and absent textual problems are flagged rather than completed
from a private answer key. A conservative heuristic looks for a self-contained
source task; every accepted record still carries
`context_review: "heuristic-pass-independent-review-required"`. Admission proves
traceability and the specified structural checks, not pedagogical suitability or
visual equivalence. Human review can reject additional cases.

## Admission and exposure

`native_family_registry.json` pins all source revisions and data-asset hashes.
Default is deny. Its explicit split rules authorize development materialization
from original train/dev data and reference materialization from the named splits.
All test, validation, and benchmark membership remains protected for development.
An explicit `protected_families` entry also blocks development.

The family census runs **before** source filtering or task-context rejection.
Every linked record contributes its original split. For example, a MathDial train
record reused in a MathTutorBench benchmark cannot enter development through
`--source mathdial`. A malformed test row with a valid original identity still
reserves its family. Identity collisions are never reissued as new families.
Unresolved derived rows are quarantined, not assigned fresh independent IDs.
The unresolved counts also mean the report is not a certificate that every
possible cross-source relationship has been discovered.

The existing TutorMoments pack exposes **six moments in five conversations**.
The registry records all six moment IDs and the five family IDs, including the
conversation contributing two moments. All related moments retain development
exposure. Reusing these already exposed families is allowed; they never become
untouched holdouts. This exception cannot override an explicit protected-family
entry or authorize test-split MathDial/Bridge material.

Build maintains `.keating/native-learning/scenarios/exposure-ledger.json`. It
records new development families before publishing source payloads, using a file
lock and atomic replacement. A failed publication conservatively remains exposed.
The journal is monotonic, labels later reference exports as development-exposed,
and **never grants admission**. Preserve this ledger with experiment artifacts.
Malformed journal data blocks operation instead of silently resetting exposure.
Deleting the ignored journal loses local exposure evidence; retain the tracked
registry and archive the journal when moving an experiment to another machine.

A reference bundle can become stale if its family is later development-exposed:
revalidation then rejects its earlier exposure label. Rebuild in a fresh output
directory. Do not edit old source packs to hide exposure.

License strings reproduce publisher declarations from the pinned catalog. Family
admission is an experiment-use control, not a license grant. Repacked material
retains its original provenance and source obligations. No restricted raw data is
embedded in these five tracked files.

## Verified corpus and checks

On the currently pinned cache (6,049 source records), the built packs contain:

| Adapter | Development eligible | Reference eligible |
| --- | ---: | ---: |
| MathDial | 772 | 2,849 |
| Bridge | 42 | 150 |
| MRBench/BEA | 0 | 355 |
| MathTutorBench | 0 | 1,262 |
| TutorMoments | 12 | 150 |
| Total | 826 | 4,766 |

Development excludes 5,223 records; reference excludes 1,283. Each exclusion has
a stable reason and source-record hash, and totals reconcile with all input rows.
Resolved MRBench/MathTutorBench material overlaps protected evaluation families;
zero development admissions are the intended exclusion, not a missing adapter.
Reference artifacts contain actual adapted starting states for all five sources.
Repeated rows/variants remain in the same family; these counts are not counts of
independent people, tasks, learning outcomes, or pristine holdout examples.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 -m unittest discover -s scripts/training -p test_native_scenarios.py
```

The authored fixture tests cover public leakage, original-byte/record hashes,
source-role and cut boundaries, candidate removal, origin ambiguity/collisions,
MathDial/Bridge reuse across collections, protected-family admission, immutable
split labels, exposure persistence, and replay validation after tampering. They
contain no copied source records. Runtime execution, adaptive learner behavior,
provider performance and training are tested by the parent integration, not by
these adapter tests.
