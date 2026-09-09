# Learning While Building Keating

Local creator-as-learner case study combining selected teaching episodes, application development history, and an audit of two overlapping exports. Raw exports are not included.

Reproduce the aggregates using the exact local snapshots identified by SHA-256 in `aggregates.json`:

```sh
rtk proxy python3 scripts/analyze-single-learner.py --portable /path/to/portable.json --training /path/to/training.zip --output docs/case-study/aggregates.json
rtk proxy python3 scripts/render-case-study-figures.py
rtk proxy python3 scripts/render-case-study-charts.py
rtk proxy python3 scripts/verify-case-study-code.py
rtk proxy python3 scripts/verify-case-study-quotes.py --portable /path/to/portable.json
rtk proxy typst compile docs/case-study.typ output/pdf/keating-creator-case-study.pdf
```

`episode-ledger.json` locates the selected dialogue spans in the hashed portable snapshot. Findings distinguish immediate assisted reasoning, informal later recall, tutor assertions, creator repairs, and unverified technical claims. Selection is purposive; it does not estimate theme prevalence. The repository commits named in the paper document implementation history, not exact deployment exposure.

The five SVG figures and native Typst model-context diagram show a learning trajectory, parallel development chronology, daily activity calendar, evidence pathways, and training-data lineage. These are editable vectors generated locally; the calendar is derived from the aggregate analysis. Other diagrams use the explicitly documented selected findings and counts.

Four additional SVG figures use line, donut, horizontal-bar, and stacked-bar charts to show weekly interaction, model mix, teaching materials, card-review ratings, feedback provenance, and question-check status. The chart renderer requires Matplotlib and reads aggregate-only `chart-data.json`. Pass `--portable /path/to/portable.json` to reconstruct weekly counts from the hashed snapshot; the script checks them against the existing daily and role totals.

The subject-coverage chart adds a fifth quantitative figure. It uses `subject-data.json` to group retained conversation families into eight primary subjects, distinguishing discussion or practice from openings. `subject-coding.md` records the family grouping and coding procedure. Generic topic examples appear beneath the bars; the public ledger contains hashed membership identifiers and no transcript text.

`related-work.typ` connects the case to prior learning, tutoring, autobiographical-design, and agent-evaluation research. `references.bib` provides the cited bibliography, including the earlier Keating methods paper. `literature-review.md` records the primary sources, relevant locations, interpretation changes, and short research-quotation checks.

`lesson-quotes.typ` renders eight exact excerpts directly from `quote-ledger.json`, which records message indexes, text-block indexes, substring offsets, roles, timestamps, and the input hash. The quotation verifier checks those fields against the local snapshot and excludes thinking content. The training-audit page also quotes the judge-enabled field from the original ZIP's `manifest.json`.

`future-research.typ` sets out a prospective creator study, comparisons across teaching revisions and model configurations, measurement of repair burden, judge calibration, and replication with independent learners. These are proposed studies, separate from the retrospective findings.

Both algorithms follow [John Dalbey's Pseudocode Standard](https://users.csc.calpoly.edu/~jdalbey/SWE/pdl_std.html): structured English, uppercase control keywords, explicit block endings, indented nesting, one action per line, and `CALL ... RETURNING` for named routines. Algorithm 1 expands the implemented event-counting loop; Algorithm 2 specifies a proposed evaluation cycle with explicit missing-outcome and promotion-gate branches.

The draft is separate from `docs/study.typ` and the production PDF. It has not been published. The supplied training ZIP has not been rescored or uploaded to a provider.
