= Code and Reproducibility Availability

Keating is available under the Mozilla Public License 2.0 at `https://github.com/Diogenesoftoronto/keating`. The system snapshot targeted by this revision is version 3.3.0. Study logic is contained in `scripts/study-analysis.mjs`, `analysis/study_analysis.py`, `src/core/benchmark.ts`, `src/core/benchmark-real.ts`, `src/core/map-elites.ts`, and `src/core/policy-judgement.ts`.

The evaluated policy is frozen at `docs/study/evaluated-policy.json`; analysis no longer reads mutable `.keating` state. Run `devenv tasks run keating:study-analysis` to regenerate `docs/generated/study-analysis.json` and `docs/generated/study-analysis.md`. Run `devenv tasks run keating:paper` to regenerate the analysis and compile the published PDF at `web/public/keating-metaharness.pdf`. `keating:paper-check` performs a compile-only check to a temporary path.

= Data Availability

The 22 raw model-generated traces are versioned under `test/traces/`, and the deterministic 16-record curation snapshot is `test/final_dataset.json`. The archive contains no human-participant data. `docs/generated/study-analysis.json` records the curation manifest, the one score normalization, all external summaries, the frozen protocol, every synthetic seed comparison, ablations, and all 30 isolated optimizer reruns.

The paper's quantitative claims can therefore be regenerated from a fresh checkout without provider credentials. Live provider calls, deployed browser behavior, audio/video transport, collaborative-course operation, and human-learning outcomes are outside that reproducibility claim.
