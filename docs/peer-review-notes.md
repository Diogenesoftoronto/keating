# Peer Review Notes for `docs/study.typ`

This support memo records the strongest likely reviewer questions for the August 8, 2026 revision. It is not part of the manuscript.

## 1. Is this a human-learning study?

No.

- The 22 archived sessions are model-to-model teaching traces, not human-participant data.
- The 16 retained records support descriptive failure analysis only.
- The synthetic benchmark measures behavior inside an explicit score model.
- The manuscript makes no causal efficacy claim and calls for a preregistered human trial.

## 2. How were archived sessions selected?

The versioned rule in `scripts/study-analysis.mjs` is deterministic:

1. Start with all 22 JSON files in `test/traces/`.
2. Group by `topic x learner`.
3. Keep the latest timestamp in each group.
4. Compare the resulting 16 records with `test/final_dataset.json`.

The current snapshot matches exactly and excludes six earlier duplicates.

## 3. Were raw scores modified?

One encoding correction is disclosed. A derivative trace for `Qwen-2.5-1.5B` used `8, 7, 8` while the rest used a 0-1 scale. The analysis normalizes those values to `0.8, 0.7, 0.8` and records the before/after values and rule in `docs/generated/study-analysis.json`.

## 4. Why trust the archival labels?

Only to the limited extent claimed.

- They are archived labels with no documented scorer provenance.
- There is no blinded scoring or inter-rater reliability.
- They are used for descriptive topic, learner-role, and contamination analysis.
- They are not treated as measured human learning outcomes.

## 5. What exactly is the synthetic comparison?

The evaluated policy is frozen at `docs/study/evaluated-policy.json` rather than loaded from ignored `.keating` state. Against the Keating 3.3.0 default under the same default objective weights, it improves the 14-topic suite by a mean 3.982 points over 200 seeds (2.5th-97.5th percentiles 3.039-4.985) and is positive on all 200 aggregate comparisons.

This is not a held-out generalization result. The candidate originated in full-suite work. The paper now describes the per-topic results as robustness inside the score model.

## 6. Is MAP-Elites reliably improving?

Not always. The revised protocol gives each of 30 derivative-focused reruns a fresh grid. With 24 candidates per run:

- 11 selected policies improve scalar score;
- four tie the baseline;
- 15 regress;
- the mean delta is -0.014, median -0.164, observed range -8.805 to +7.142.

Candidate search scores use co-evolved weights and candidate-specific seeds, so the revised analysis does not compare those raw values with the baseline. It reevaluates the selected policy and default on the same seed with `DEFAULT_WEIGHTS`. The result shows no reliable scalar improvement and is reported as a design limitation.

## 7. What does the benchmark reward?

One-at-a-time swaps rank lower challenge rate first (+2.227), then maximal retrieval practice (+1.820) and interdisciplinary bias (+1.182). Maximum diagram bias is the strongest negative isolated change (-1.583), followed by reflection bias (-0.376).

These values diagnose the algebraic surface. They do not show that lowering challenge or visual emphasis improves human learning.

## 8. What is the most important archival failure mode?

Student-role contamination. Five of 16 curated sessions contain at least one heuristic marker of the simulated student speaking like a teacher or assistant. Those sessions have lower descriptive mastery and overall scores. The heuristic is versioned but not externally validated.

## 9. Can a fresh checkout reproduce the paper?

Yes, subject to the declared deterministic boundary.

- Inputs: `test/traces/`, `test/final_dataset.json`, and `docs/study/evaluated-policy.json`.
- Analysis: `devenv tasks run keating:study-analysis`.
- Outputs: `docs/generated/study-analysis.{json,md}`.
- PDF: `devenv tasks run keating:paper`.

The claim does not cover live provider calls, deployed browser behavior, audio/video, collaborative rooms, or human outcomes.

## 10. What would a decisive next experiment look like?

A preregistered randomized comparison against a strong AI tutor baseline with human participants, blinded rubric scoring, delayed retention, explicit transfer tasks, and an authorship-style outcome requiring learners to reconstruct the idea without the tutor. Hidden benchmark variants and adversarial policy audits should run in parallel so internal optimization cannot simply overfit the visible score surface.
