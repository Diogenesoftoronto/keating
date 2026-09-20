# Datasets for events inside the teaching harness

The useful unit is a learner situation that can unfold through Keating: an attempt,
a tutor decision, new evidence, an opportunity to revise help, and an observable
artifact or conversation outcome. Preserve each source dataset unchanged and label
its adaptations separately. A scripted learner reply is not evidence that a tutor
caused learning.

## Implemented: TutorMoments

The [Ai2 release](https://huggingface.co/datasets/allenai/tutormoments-preview)
contains 520 frozen moments, balanced between scaffolding and rigor. We pin the
revision and byte hash, preserve the original context and oracle material, and
keep it separate from a twelve-episode synthetic Keating pilot. The original
transcripts contain repeated turn numbers for enrichments; the importer preserves
their order rather than deleting them.

See [the adaptation protocol](../scripts/training/benchmarks/tutormoments-keating-v1/README.md)
and `analysis/tutormoments_comparison.py`. Ordinary and reopen variants share source
families. The notebook compares structure and provenance; no provider scores have
been collected.

## Pinned source catalog and explorer

`scripts/training/benchmark_sources.json` pins revisions, selected paths, exact byte
counts and SHA-256 hashes for all six resources. The source snapshots are cached
under ignored `.keating/datasets/sources/<source>/<revision>/`; raw material is not
added to the repository. Downloads never run upstream code. A cached file with an
unexpected checksum is rejected rather than silently replaced.

Inside the development shell:

```sh
rtk python scripts/training/benchmark_sources.py list
rtk python scripts/training/benchmark_sources.py fetch --source all
rtk python scripts/training/benchmark_sources.py verify
```

Open `analysis/benchmark_sources.py` through the existing marimo editor. It shows
verification status, declared licenses, counts, and individual original records.
It is an evaluator view: full records may contain reference answers and future
dialogue, and must not be copied wholesale into tutor requests. Missing caches
are shown without automatic downloads. Invalid caches produce explicit errors.

| Resource | Selected pinned snapshot | Current adaptation |
|---|---|---|
| TutorMoments | 520 moments, dataset card | Twelve authored Keating episodes |
| MathDial | 2,262 train + 599 test records, dataset card | Original data only |
| Bridge | 419 train + 71 validation + 210 test records, dataset card | Original data only |
| MRBench / BEA | 300 v3 dev + 191 v3 test records, README | Original data only; excludes other versions |
| MathTutorBench | 1,150 standard + 327 hard bundled MathDial/Bridge records, README | Original data only; not every upstream task |
| StudentSim | README and MIT software license | Software reference only; no simulator execution or training data |

These counts are not additive coverage: several collections reuse the same
conversations. No cross-source deduplication or evaluation scores are claimed.
Local availability does not resolve licensing questions. Original split names
are preserved; inspect task protocols before treating a split as a holdout.

## Adaptation targets and reuse boundaries

| Source | What it adds | Proposed Keating adaptation | Boundary |
|---|---|---|---|
| [MathDial](https://huggingface.co/datasets/eth-nlped/mathdial) | Math problems, incorrect student solutions and tutoring dialogues | Turn the erroneous solution into a learner attempt, then test diagnosis, a targeted hint, a revised attempt and transfer | CC BY 4.0; its student dialogue is simulated. Keep problem IDs grouped and correct solutions evaluator-only. |
| [Bridge](https://huggingface.co/datasets/rose-e-wang/bridge) | Tutoring context with original/revised responses and pedagogical intent | Counterfactual episodes testing whether the harness notices a misconception and changes its approach | Dataset card says CC BY-NC 4.0. Commercial permission remains unresolved; do not silently merge it into broadly reusable fixtures. |
| [MRBench / BEA 2025](https://github.com/kaushal0494/UnifyingAITutorEvaluation) | Human-annotated tutor responses and dimensions such as mistake identification, location, guidance and actionability | Calibrate our reviewer against labeled responses, then use the dimensions to audit harness feedback | The repo declares CC BY-SA 4.0 and derives from MathDial/Bridge; verify inherited source terms before redistribution. Response annotations alone are not multi-turn outcomes. |
| [MathTutorBench](https://github.com/eth-lre/mathtutorbench) | Teacher-grounded tasks across several pedagogical abilities | Build separate diagnosis, guidance and assessment probes instead of one blended score | No explicit repository license found; selected data combines MathDial and Bridge. Permission and inherited terms need clarification before redistribution or commercial use. |
| [StudentSim](https://github.com/microsoft/StudentSim) | A framework for training and evaluating student simulators | Evaluate an adaptive learner-event generator against held-out student behavior before using it to rank tutors | Software is MIT; external data permissions are separate. Simulator fidelity and tutor effectiveness require separate evidence. |

MathDial is the most direct next source for new runnable cases. MRBench is useful
for improving the evaluator first. Bridge provides useful counterfactual teaching
examples but has a narrower reuse license. StudentSim addresses the main weakness
of our current fixed scripts: follow-up attempts do not depend on what the tutor
actually said.

## Adaptation contract

1. Pin source revision, source record ID, license and checksum. Preserve vanilla.
2. Rewrite the situation into explicit learner-visible evidence. Use real harness
   `message`, `reopen`, `new_session`, or canonical `ui_action` events; do not turn
   annotations into fictitious tool receipts.
3. Keep gold answers, future continuations and judge rationales out of tutor input.
4. Record which cues, numbers, environment and future turns were changed. Review
   whether the original label still fits; adapted labels are not automatically gold.
5. Split at source conversation/problem family level before generation; keep
   variants together. Deduplicate across collections that reuse MathDial/Bridge.
6. Report source and adapted arms separately with missing runs retained as unknown.
   Match source IDs and model/prompt conditions before interpreting differences.

Sources checked 2026-09-13. No paid evaluations were launched during this setup.
