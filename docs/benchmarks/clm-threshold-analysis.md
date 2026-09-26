# CLM abstention and threshold analysis — 24 September 2026

This is an offline, retrospective analysis of the saved CLM run. No new model requests were made. Frozen benchmark labels, model outputs and production thresholds remain unchanged. Thresholds below apply only to the 142 labelled boolean judgements: 62 planning and 80 reply-review assertions. They do not repair the 20 grading/evidence labels or the two failed grading requests.

## Why so many abstentions

Keating maps a probability at or below 0.2 to false and at or above 0.8 to true; the middle interval is an abstention. CLM’s 62 scored planning probabilities ranged from 0.2080 to 0.7482, so every one was rejected by that band. Across all 628 planning Nouls, including unlabelled questions, the maximum was 0.7634: none could yield true at the 0.8 cutoff.

The pinned CLM source computes softmax over learned scaled state/action similarities, at default temperature 1. The emitted number is not independently calibrated to correctness on Keating tasks. The 0.2/0.8 thresholds require a 4:1 preference between true and false; they were inherited from the current production policy rather than fitted to CLM. CLM did not explicitly return an abstention: the host threshold rule produced it.

Source/receipt checks found no identical positive/negative candidate texts, no exact-0.5 outputs, no request-hash mismatch and no discrepancy between raw and decoded probabilities. Planning omits explicit criteria, so CLM prefixes and repeats the long question when constructing its true/false candidates. Most reply-review questions supply explicit polarity descriptions. Wording could affect compression, but these task groups differ; a matched wording experiment is needed before claiming causality.

## Threshold sweep

False applies at or below the lower cutoff; true at or above the upper cutoff; scores between them abstain. “Correct / all” keeps abstentions in the denominator; “Accuracy when answered” does not. At cutoff 0.5 there are no ties in these saved outputs.

| False / true cutoffs | Answered / 142 | Abstentions | Correct / all | Accuracy when answered | Whole-suite label match / 162 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.20 / 0.80 | 25 | 117 | 11/142 (7.7%) | 44.0% | 12/162 (7.4%) |
| 0.30 / 0.70 | 53 | 89 | 27/142 (19.0%) | 50.9% | 28/162 (17.3%) |
| 0.40 / 0.60 | 83 | 59 | 46/142 (32.4%) | 55.4% | 47/162 (29.0%) |
| 0.45 / 0.55 | 114 | 28 | 68/142 (47.9%) | 59.6% | 69/162 (42.6%) |
| 0.49 / 0.51 | 139 | 3 | 77/142 (54.2%) | 55.4% | 78/162 (48.1%) |
| 0.50 / 0.50 | 142 | 0 | 78/142 (54.9%) | 54.9% | 79/162 (48.8%) |

The whole-suite calculation retains CLM’s one correct grading/evidence label and its two failed requests. Forcing a decision at 0.5 raises the headline result from 12/162 (7.4%) to 79/162 (48.8%). This is a post-hoc rescore, not a new validated benchmark result.

At 0.5, planning reaches 39/62 (62.9%) and reply review 39/80 (48.8%). The boolean always-false baseline is 91/142 (64.1%) overall and 63/80 (78.8%) for reply review, so raw accuracy alone can reward the majority class. Balanced accuracy at 0.5 is 56.6% overall. The 25 decisions that crossed the original strict band were only 11/25 correct: distance from 0.5 was not a reliable correctness guarantee.

## Development-only cutoff selection

We swept single cutoffs from 0.00 to 1.00 in 0.01 steps, selected the highest development balanced accuracy, and broke ties by closeness to 0.5 then the lower cutoff. A single cutoff forces a label; it has no abstention band. Sibling episode families remain in the same split.

| Scope | Development-selected cutoff | Development correct | Existing holdout correct | Holdout balanced accuracy | Holdout true-label recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| all | 0.59 | 43/70 | 45/72 (62.5%) | 56.7% | 42.9% |
| planning | 0.59 | 17/30 | 23/32 (71.9%) | 68.7% | 42.9% |
| adherence | 0.63 | 27/40 | 22/40 (55.0%) | 50.2% | 42.9% |

These are exploratory reuse of an already inspected benchmark, not fresh calibration validation. In particular, the planning cutoff 0.59 achieves 23/32 holdout matches but recognizes only 6/14 true cases. The reply-review cutoff 0.63 achieves approximately chance balanced accuracy on its holdout. Neither is an established production operating point.

## What a threshold cannot fix

At the authored paired contrasts, CLM puts the true example above the false one in 10/14 planning label flips and 13/17 reply-review flips. Some useful relative signal exists, but it is not consistent enough for a universal cutoff. For example, `attempt_present` receives 0.5635 for the learner’s substantive (wrong) attempt and 0.5829 for mere agreement. No ordinary monotonic threshold can label the former true and the latter false.

Rank separation, measured by ROC AUC, is 0.691 for planning and 0.588 for reply review; 0.5 means no useful ordering. Lowering CLM’s temperature sharpens probabilities but leaves their ordering and 0.5 decisions unchanged. It can suppress abstentions without improving those decisions.

A reasonable next experiment is a matched comparison of explicit true/false criteria versus the fallback wording, followed by per-question or task-family calibration on separately labelled development data, and then fresh family-level evaluation. The current evidence supports investigating planning signal; it does not establish a reliable threshold for reply review. Production settings were not changed.

## Provenance

Pinned CLM source: `0a3a319c1a242339903db575e160e9a8d84b9ce8`. Candidate construction is in `src/clm/schema.py:93–101`, scoring in `src/clm/engine.py:125–134`, learned scale in `src/clm/heads.py:95`, and temperature default in `src/clm/server.py:105–106`. The local pinned source is `.keating/tmp/clm-pilot-source/`.

Inputs and complete numerical sweep remain under `.keating/benchmarks/context-window/keating-episodes-v1/execution/clm/threshold-analysis/`. Results use the same frozen question/label plan as [the original score report](keating-judgement-scores.md).
