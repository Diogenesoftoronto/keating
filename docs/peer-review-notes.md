# Peer Review Notes for `docs/study.typ`

This support memo accompanies the September 6, 2026 revision. It is not part of the manuscript.

## What changed in the claim?

The active method is now teaching-skill evolution through fresh runtime executions and fixed evaluation gates. MAP-Elites, PROSPER selection, and the algebraic simulator remain historical research mechanisms. Five feedback records, a favorable prompt diagnostic, or rescoring an unchanged transcript cannot authorize a new teaching revision.

The paper assesses Keating along separate axes: implemented capabilities, measured teaching behavior, and human learning efficacy. It deliberately does not turn missing outcome evidence into a single numerical product rating.

## What is implemented and what is measured?

Implemented: a fixed 18-case suite, bounded real Pi/browser Agent execution adapters, a reflective proposer, separate rubric judging, persistent hypotheses, immutable revision/evidence records, validation and single-use holdout gates, atomic activation, and session pinning. Separate learner checks cover fractions and loop bounds at precheck, immediate, one-day recall, and seven-day transfer stages.

Local fixtures test the code and actual tool paths with controlled responses. No live-provider performance results for the new loop or human learning effects are reported. Authored cases are an inventory, not completed model experiments or human participants.

## What is borrowed from WikiSkill?

The separation of raw experience, persistent knowledge, and active procedures informed the architecture. The citation is Tang et al. (2026), arXiv:2608.27454. Keating now has a bounded wiki maintainer, indexed pattern pages, maintenance logs, programmatic skill-impact history, and selective training-evidence reads before one skill proposal. Knowledge persists independently of skill acceptance. This implements the maintenance separation but does not reproduce WikiSkill's benchmark results or provide an unbounded, autonomously curated knowledge base. It is also not a completed GEPA implementation.

## What does the new gate establish?

Eligibility for experimental teaching behavior. Both validation and holdout require complete paired evidence, at least six distinct families, mean improvement of at least 0.05, no family regression, no critical candidate failure, and a one-sided family-level sign-test p-value at most 0.05. The comparison fixes scoring and requires compatible tutor model/runtime provenance.

The statistical assumptions are not established by distinct family labels. With six families, five wins and one tie pass the sign-test cutoff; four wins and two ties fail. These rules are not calibrated human-outcome guarantees or lifetime false-promotion control.

## Is the holdout actually secret?

No. It is public repository content withheld from the automated proposer and tracked for consumption. The store blocks ordinary reuse, including reordered cases and changed identifiers, and consumes the holdout before execution so crashes cannot reopen it. Semantic variants can still overlap. Independent authorship and genuinely new packs are required after consumption; the browser currently requires an application update for a new pack.

## Could the judge or hypothesis ledger be wrong?

Yes. Separate actor/judge calls can share a model and its biases. The judge is instructed to ignore transcript attempts to manipulate evaluation, but there is no completed adversarial robustness or human agreement study. Evidence records include tutor model/runtime attribution and criterion rationales, not a full independently versioned judge-calibration manifest. Retained hypotheses may preserve mistaken explanations; their value needs a ledger ablation.

## What happens to the historical numbers?

They remain reproducible diagnostics. Regeneration reproduces the prior archive and simulator results exactly: 22 traces curated by latest timestamp to 16 pairs, one 10x score correction, archive composite 0.61, and five heuristic student-role contamination cases. The frozen policy improves the algebraic score by 3.982 points over 200 seeds. Thirty isolated, standardized optimizer reruns yield 11 wins, four ties, and 15 regressions, with mean delta -0.014.

The frozen policy originated in 3.3.0. The executed package version and source manifest are now recorded separately, so a current rerun is not mislabeled as execution of the historical release. None of these results evaluates the new skill loop.

## Are learner checks causal or automatically part of promotion?

No. They use small fixed numerical banks, self-reported assistance, and operator-recorded exposure. Their forms are not equated, and missingness can be systematic. They preserve unavailable results as null and exclude assisted/unknown stages from unaided summaries. They do not randomize learners or control outside help, and they do not currently decide automatic promotion.

## Reproducibility and the next study

`devenv tasks run keating:study-analysis` regenerates the inventory, source manifest, archive summaries, seed comparisons, ablations, and isolated legacy optimizer runs without model calls. `keating:paper` then compiles the PDF. Compare payloads excluding `generatedAt` and inspect source-manifest differences before attributing changes to the method.

The next behavior study should compare the base tutor, a fixed expert skill, proposals without persistent hypotheses, and proposals with the ledger under equal budgets, independently authored cases, and blinded human calibration. A randomized human study should then use equivalent assessments, delayed recall, novel transfer, unaided reconstruction, prespecified outcomes, and explicit missing-data reporting. Neither proposed study has been completed here.
