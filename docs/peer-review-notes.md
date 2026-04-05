# Peer Review Notes for `docs/study.typ`

This document is not part of the manuscript. It is a reviewer-facing support memo that answers the questions most likely to arise from the current evidence package.

## 1. Is this just a synthetic benchmark paper in disguise?

Partly, and the revised manuscript now says so explicitly.

- The paper separates two evidence layers instead of blending them:
  - `test/traces/*.json` and `test/final_dataset.json` are an archival external evaluation set.
  - `src/core/benchmark.ts` is an internal synthetic optimization harness.
- The manuscript treats the synthetic layer as evidence about policy robustness *inside the harness*, not as proof of human learning.
- The strongest human-facing claim left in the paper is only that the archived traces reveal interpretable failure modes.

## 2. How were the external sessions selected?

The rule is deterministic and implemented in `scripts/study-analysis.mjs`.

- Start with all 22 raw traces in `test/traces/`.
- Group by `topic x learner`.
- Keep the latest trace by timestamp for each pair.
- This yields 16 retained sessions and excludes 6 earlier duplicates.
- The retained set matches `test/final_dataset.json` exactly.

## 3. Did you modify the raw scores?

Only once, and the correction is disclosed.

- One derivative trace for `Qwen-2.5-1.5B` used `8, 7, 8` while the rest of the archive used the `0-1` scale.
- The analysis normalizes that single record to `0.8, 0.7, 0.8`.
- The rule and corrected record are written to `docs/generated/study-analysis.json`.

## 4. Why should anyone trust the external labels?

They should trust them only to the extent claimed.

- The labels are archival values shipped with the repository.
- The revised paper does *not* claim blinded human scoring, inter-rater reliability, or preregistered rubrics.
- The labels are used for descriptive evaluation and failure analysis only.
- This is why the manuscript repeatedly states that human efficacy remains unproven.

## 5. What stops the synthetic gains from being overfitting?

Nothing stops overfitting in principle, but the current data argue against trivial topic-specific overfitting inside the harness.

- The current policy was evolved on `Derivative` only.
- It still improves the full 14-topic suite across `200/200` seeds.
- The mean gain on non-derivative topics is essentially identical to the derivative gain.
- Re-running derivative evolution from scratch improves the baseline in `29/30` runs.

This is still an internal result, but it is materially stronger than a single run on a single topic.

## 6. What does the benchmark appear to reward?

The ablations make that explicit.

- Retrieval pressure is the dominant driver of synthetic gains.
- Lower challenge rate is the second strongest contributor.
- Interdisciplinary prompting helps modestly.
- Reflection bias and diagram bias hurt when swapped into the default policy in isolation.

Interpretation:

- The current synthetic harness is good at detecting under-retrieval and overload.
- It is weaker as a sensor for reflective depth, which is an important limitation for a paper about learner agency.

## 7. What is the most important failure mode in the archival traces?

Student-role contamination.

- Some student turns begin speaking like a teacher or assistant.
- Those sessions have worse mean mastery and worse mean overall score than uncontaminated sessions.
- The revised manuscript treats this as an exploratory but central failure mode.

## 8. What would a decisive next experiment look like?

A real learner study, not more synthetic benchmarking.

- Preregistered randomized comparison against at least one strong AI tutor baseline.
- Human participants.
- Blinded rubric scoring.
- Delayed retention testing.
- Explicit transfer tasks.
- An authorship-style outcome measuring whether learners can reconstruct the idea without the tutor present.

## 9. What is actually new here after the revision?

Three things.

- A corrected, auditable evidence stack.
- A reproducible analysis pipeline:
  - `scripts/study-analysis.mjs`
  - `analysis/study_analysis.py`
  - `docs/generated/study-analysis.json`
- A manuscript whose claims are now matched to the underlying evidence.

## 10. Is this really Nature-ready?

Not in the strong causal sense.

- The manuscript is now much closer to a serious submission-quality systems paper.
- It is no longer making claims the repository cannot support.
- But a genuine Nature-level claim about learner agency still needs human experimental evidence.

The right way to use the current package is as the benchmarked preclinical stage before that trial.
