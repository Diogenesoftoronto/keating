#let study = json("../../generated/study-analysis.json")

= Code and Reproducibility Availability

Keating is available under the Mozilla Public License 2.0 at #link("https://github.com/Diogenesoftoronto/keating")[github.com/Diogenesoftoronto/keating]. This September 6, 2026 revision describes the implementation in release #study.protocol.softwareVersion and its generated source manifest. Use the matching release tag and manifest hashes to identify the evaluated source; older releases do not contain the new implementation. The frozen policy's historical origin remains version #study.protocol.frozenPolicyOriginVersion.

The manuscript entry point is `docs/study.typ`. Current experiment contracts, cases, fixed scoring, hypotheses, skill revisions, and assessment logic are in `shared/evolution/`; runtime adapters and durable stores live under `src/core/`, `src/runtime/`, and `web/src/keating/`. `docs/teaching-evolution.md` documents commands, budgets, case-pack renewal, activation, and local storage scope. The analysis script and generated artifacts contain the exact source manifest and suite digest; manuscript inventory values are read from that generated JSON.

Run `devenv tasks run keating:study-analysis` to regenerate `docs/generated/study-analysis.json` and its Markdown companion. Run `devenv tasks run keating:paper` to regenerate the analysis and compile `web/public/keating-metaharness.pdf`. `keating:paper-check` compiles to a temporary PDF without replacing the web asset. These paper commands disable optional provider judging and perform no live-model experiment. Compare generated payloads without `generatedAt` for a deterministic rerun; compare their source manifests before attributing changed results to a method.

The root and browser test tasks are `keating:test` and `keating:test-web`. Focused fixtures include observed-benchmark, teaching-cases, teaching-evolution, teaching-prompt, teaching-episode-runner, and learning-check tests. The browser additionally checks disposable stores and persona/revision loading. These tests can run with local fixtures independently of provider access.

= Data Availability

The 22 raw model-generated traces remain under `test/traces/`, the 16-record curation snapshot is `test/final_dataset.json`, and the historical policy is frozen in `docs/study/evaluated-policy.json`. Generated analysis records the curation manifest, score correction, archive summaries, 200-seed policy comparisons, ablations, and 30 isolated legacy optimizer reruns. It also records the current 18-case suite inventory, source hashes, and the absence of new-loop live-provider and human-learning results in this paper.

No private learner records or account credentials are inputs to the reproducible analysis. Future actual experiment traces and learner checks are stored separately in the project or browser, and require their own consent, data-management, and reporting decisions before research use.
