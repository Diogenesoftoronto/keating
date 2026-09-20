# Research evidence notes

These are frozen, public-facing summaries of the working research reports, packaged with the narrative so it can be read before the repository changes are published. They do not replace the complete private traces. See the evidence audit for exact run hashes and attribution limits.

## E1: Native feature and hindsight updates {#native-update}

Source: `docs/native-combined-results.md`, 14 September 2026.

The frozen layer-12 SAE/readout scored two actual native tutor actions at 0.10262744084186472 and 0.030449145424427688. Separate instruction-model learner replies were delivered through Keating after both actions. The first learner draft was invalid; one allowed repair succeeded. A final tutor response without a subsequent learner event was excluded.

F-only, S-only and F+S each completed one optimizer step from common earlier feature-updated weights, with optimizer state reset. Each used 37 original actor targets and learning rate 1e-5. Anchor weight was 0.1. All 2,738 context targets per arm had zero recorded gradient. Maximum numerical derivative replay errors were 2.06e-10, 3.43e-9 and 2.73e-9. The F/S cosine was 0.312903 in target-log-probability coordinates, not model-parameter gradient space. All three sampler archives were downloaded and hash-checked; restored-archive inference was not demonstrated.

The native trace is authored and the learner simulated. It has no delivered interactive artifact, independent transfer check, or human outcome. An accepted chat segment does not establish full native quality.

## E2: Fresh behavior comparison {#behavior}

Source: `docs/checkpoint-behavior-results.md`, 14 September 2026.

Eight authored tasks × two seeds × four checkpoint arms = 64 completed responses. Same task messages, temperature 1, top-p 1, top-k -1, maximum 512 completion tokens. All stopped normally. Two fresh automated reviewers scored opaque, shuffled outputs before unblinding; eight overlapping verdicts agreed, with one of 24 overlapping criterion scores left unresolved.

Initial/F-only/F+S scored 10/16; S-only scored 9/16. Each trained arm repeated Initial verbatim in 14/16 task/seed pairs. F-only and F+S changed no overall verdict; S-only regressed once. No improvement or complementary benefit was demonstrated. Other-capability tasks were matrix transposition and list aliasing, not human retention tests. At the checkpoint-comparison snapshot, the shared ledger reserved $58.30 of the $100 cap. Two later controlled-generation allocations brought reservations to $61.30, including the failed first attempt; this is not invoice accounting.

## E3: Native source adapters {#adapters}

Source: `docs/native-scenario-adapters.md`.

Five adapters preserve source identity and source-family joins while separating actor, learner and evaluation-only projections. The 6,049-record pinned cache produces 826 development admissions and 4,766 reference admissions. These views overlap and are not additive independent tasks. Reference is not necessarily unexposed. MRBench and MathTutorBench have zero development admissions because resolved records overlap protected families.

TutorMoments/MathDial/Bridge/MRBench/MathTutorBench starting states were adapted; no source adaptation itself runs a tutor, validates an answer, or demonstrates learning. StudentSim remains a software reference, not a sixth executed dataset adaptation. The initial twelve TutorMoments authored episodes are distinct from later generic adapter admissions.

## E4: Earlier gates and source supervision {#earlier-gates}

Source: `docs/plans/native-research-completion-audit.md`, historical 13 September snapshot with 14 September follow-ups.

Twenty production plumbing traces used authored policies and actual action receipts; learning assessments stayed unknown. Broader chat and interactive model canaries failed quality gates through unsupported claims, absent activities and invalid learner actions. The proposed 30 × 2 × 3 paired pilot has not run.

The admitted TutorMoments explicit-cut action labels had insufficient group/class coverage. MathDial supplied a completed 200-family source `move.probing` classification experiment. Its SAE Brier was 0.10916 and AUC 0.92 on forty test families, versus raw Brier 0.17735 and AUC 0.78. The primary text fit was intercept-only; a later text-only tuning control was exploratory after test exposure. Source move labels are not reward or learning labels. A planned four-layer extraction failed during dependency bootstrap and produced no fitted layer-sweep result.

Later actual premature-answer F and matched F/S/F+S runs supersede the historical audit's absence claims. Its older reservation totals are not the latest balance.

## E5: Premature-answer readout {#probe}

Source: `docs/premature-answer-reward.md`, `probe-summary.json`.

Pinned Qwen3.5-9B-Base with the matching 65,536-wide layer-12 SAE and signed Top-K 50. Thirty authored task families, four request/response contrasts each; 18/6/6 train/calibration/test families. Actual CUDA extraction completed for all 120 records. Fixed train-only preprocessing and calibration-only fitting. Test results on 24 records:

| Readout | Brier | AUC | Accuracy | Nonzero weights |
| --- | ---: | ---: | ---: | ---: |
| Text, intercept-only | 0.18750 | 0.5000 | 18/24 | 0 |
| Raw activations | 0.07621 | 0.9722 | 20/24 | 33 |
| SAE | 0.03806 | 1.0000 | 23/24 | 19 |

Changing the request increased the identical worked answer's score in every held-out family. No causal direction, human outcome or artifact transfer follows. The reward is a negative probability penalty behind an explicit hint-only gate and independently checked correctness; missing evidence abstains. A small penalty is not a positive teaching-quality reward.


## V4, source activities and the sequential coordinator {#v4-extension}

The frozen teaching-v4 pack contains 12 cases, 73 learner messages and 10 families. Manifest SHA256: `0633813d1e7369de0853f0377146d5edc8c93735b2b11d97a40ca741d50653fc`. All 12 completed offline through the real Pi runtime. The [new live pilot data](teaching-v4-pilot.json) preserves all four scheduled slots: one complete, one malformed-generation failure, one tool-call exhaustion and one blocked after the bridge halted. Actual sampling: 16 calls and 3,047 output tokens, with no maximum-output truncation. The complete episode's [independent review and exact responses](benchmark-diagnostics.html) are public. No v4 activations have been extracted.

Eight reviewed TutorMoments multiple-choice moments have canonical unanswered OpenUI documents; four were deferred. A real Pi offline canary accepted a choice, persisted its receipt and continued the tutor. The [allowlisted source example](frontier-example.json) includes the exact question, options, source revision, attribution and recorded checks. It preserves source text and starts a fresh unanswered activity.

The [token contribution export](probe-spans.json) binds a saved 9B observer artifact, fitted report, feature card, measurement plan and reward audit by hash. All 49 token contributions plus bias reconstruct probability 0.0836922507 with zero recorded logit residual. Local operational paths were removed from this public projection. Contribution magnitudes explain the fitted arithmetic, not causal importance.

`native_curriculum.py` orders collection, one-step updates, and evaluation at each checkpoint. It records durable intents before dispatch, validates lineage and family exclusions, and blocks uncertain redispatch. Eighteen new coordinator tests and 29 existing continual tests passed. Callbacks remain the integration seam; a live sequential training/evaluation curriculum has not run. Current orchestration supports the existing native Tinker update contract, not the combined custom updater. Optimizer moments restart per stage.

The generic extractor supports `Qwen/Qwen3.5-27B` and `Qwen/SAE-Res-Qwen3.5-27B-W80K-L0_50`: hidden width 5120, dictionary width 81920 and Top-K 50. Model/tokenizer revision `fc05daec18b0a78c049392ed2e771dde82bdf654`; dictionary revision `13d4221569f7ca5d3c1e605e3e3dc95117e4807c`; candidate layer 31. These are metadata pins, not extraction evidence. Its probes must be refitted; 9B coordinates are not transferable. The actor is independently selected. The legacy remote worker remains 9B-only, with fresh bundle and hash checks passing 99 focused tests.

The report workbench and contribution math are offline. Fourteen new benchmark diagnostic tests and nine probe-span tests passed. The combined shared cap remains $100: $68.30 reserved, $31.70 unallocated, no active grants. Failed reservations remain counted.
