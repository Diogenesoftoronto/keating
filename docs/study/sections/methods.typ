#import "../preamble.typ": modest-table

= Methods

== Evidence types and the estimand

The revised method asks whether a specified change improves *tutor behavior on fixed cases* before permitting experimental teaching use. It does not estimate learning gain from the tutor's prose. Let $R$ denote a revision, $x_i$ a learner conversation prefix, and $tau_i(R)$ a freshly executed tutor continuation, including any permitted tool use. A fixed rubric $J_i$ assigns binary criterion judgments to that execution. The per-case score is

$ q_i(R) = (1 / m_i) sum_(j=1)^(m_i) J_(i j)(tau_i(R)), $

where $m_i$ is the number of criteria for case $i$. A favorable aggregate cannot compensate for a failed critical criterion. Each criterion includes a rationale in the saved evidence.

The cases stop at a learner turn requiring an instructional decision. The actor generates the subsequent tutor continuation; the benchmark does not append a historical learner answer as if it were a response to the new teaching. It also does not generate an adaptive simulated learner for subsequent turns. The resulting score measures the next teaching decision under a synthetic prefix, not learner uptake, a complete instructional session, or delayed learning.

Retrospective `bench` data have a different meaning. Recorded quiz scores are observed assessment performance. Explicit sentiment and inferred learner-turn signals are labeled proxies. Changing a candidate policy or objective weights cannot change the score assigned to the same recorded corpus. Without independent measurements, mastery gain, retention, and transfer remain unavailable. Legacy numeric compatibility fields may contain zero, but evidence metadata and reports distinguish missingness from a measured incorrect answer. Neither sentiment nor an algebraic policy bonus is converted into retention.

== Case construction and information separation

The bundled `teaching-behavior-v1` suite contains 18 curated cases across mathematics and programming. Each split has six distinct family labels, with three cases from each domain. A family cannot appear in multiple splits. Cases include concrete misconceptions and explicit learner requests, with criteria for subject correctness and the requested instructional act. For example, a learner may need one diagnostic question, a hint without the final answer, or a direct explanation. This prevents a single visible behavior such as asking more questions from defining success everywhere.

Training cases supply examples for reflection. Validation compares incumbent and candidate after the proposal is fixed. A release holdout is consulted only after validation passes. The actor does not receive rubric contents; the proposer does not receive validation or holdout conversations or judgments. The fixed judge sees the actual continuation and its rubric, not the revision's instructions. Separate calls reduce direct leakage without making the judge statistically independent of the actor or immune to persuasion in a response.

The suite and held-out content are public repository material. "Sealed" therefore means withheld from the automated proposal path and tracked for consumption; it does not mean private from developers or absent from model pretraining. Distinct family names are an enforceable schema condition, not proof of semantic or statistical independence. Independent authors must supply genuinely new tasks when renewing the release evidence.

== Reflective proposal and paired gate

Each invocation executes the incumbent on training cases, then requests one skill creation or replacement with an explicit hypothesis and references to training evidence. It preserves earlier hypotheses, including rejected ones, so subsequent proposals can use accumulated observations. The current proposer is a bounded reflective call. It does not train model weights, implement a full GEPA optimizer, or revise the evaluator, scoring thresholds, permissions, or source code.

For each evaluation split, the incumbent and candidate execute on the same fixed cases and repeat count. All case/repeat pairs must be present. Their model and runtime identities must match. Each run has a fresh identifier, and saved aggregate scores are checked against the underlying judgments before they can authorize activation. Failed actor or judge calls produce explicit errors and a null aggregate; the gate never averages only the successful survivors or substitutes a deterministic score.

Let $d_f$ be the mean candidate-minus-incumbent score over all cases and repeats in family $f$. Families receive equal weight in the comparison, so additional variants or repeats do not count as additional independent families. With $F$ families, the reported effect is $overline(d) = (1 / F) sum_(f=1)^F d_f$. Let $w$ and $l$ count positive and negative family differences; ties within a numerical tolerance of $10^(-9)$ are excluded from the sign test. The one-sided tail probability is

$ p = sum_(k=w)^(w+l) binom(w+l, k) 2^(-(w+l)). $

#block(breakable: false)[
When there are no non-tied families, the implementation assigns $p=1$. Acceptance requires all of the following on *both* validation and holdout:

- at least six distinct paired families;
- a mean improvement of at least 0.05 on the 0-1 rubric scale;
- no family regression beyond the numerical tolerance;
- no failed critical criterion in any candidate execution;
- $p <= 0.05$, complete evidence, and compatible execution provenance.
]

These thresholds are fixed engineering eligibility rules, not an empirically calibrated guarantee of better teaching. With six families and no losses, five wins and one tie give $p=0.03125$; four wins and two ties give $p=0.0625$ and fail. The statistical interpretation depends on independent, exchangeable family differences under the null. Authored case labels, shared subject matter, correlated model errors, and repeated proposal selection can violate that assumption. The two gates do not create a human-outcome confidence interval or establish a global false-promotion rate across a lifetime of experiments.

== Experiment lifecycle and holdout accounting

#block(fill: luma(245), inset: 0.8em, radius: 4pt, breakable: false)[
#set text(font: "DejaVu Sans Mono", size: 8.5pt)
```text
lock project or browser evolution state
verify incumbent revision and previous activation evidence
check budget, cooldown, and unused holdout content/families
run fresh incumbent training continuations
save one evidence-linked hypothesis and candidate revision
run paired incumbent/candidate validation
if validation passes:
    persist holdout consumption before any holdout execution
    run paired incumbent/candidate holdout
save raw evidence and accepted/rejected/failed experiment
if both gates pass:
    atomically activate the evaluated candidate revision
retain hypotheses and preserve existing session revisions
```
]

The bundled suite requires 30 tutor executions for a complete run at one repeat: six training executions, 12 validation executions, and 12 holdout executions. Each completed tutor execution also requires a judging call, and the run has one proposing call. This is a planned upper path for the default suite, not a measured runtime or monetary cost. The loop allows at most two repeats and 60 tutor executions, including both revisions. Earlier failure or validation rejection stops the dependent stages.

A 30-minute cooldown limits repeated invocations. `--force` bypasses only that cooldown. Once the holdout is accessed, its fingerprint and family labels remain consumed after acceptance, rejection, or a crash. Reordering cases or changing record identifiers cannot reopen it. A later eligible invocation needs a genuinely new holdout pack; the system does not automatically manufacture independent evidence. CLI users can supply a bounded JSON case pack. Browser experiments currently use the bundled pack and need an application update to renew it. This is controlled, repeated skill evolution with an external evidence-supply dependency, not unlimited autonomous improvement.

== Independent learner assessments

The separate learner-check bank currently covers fractions and loop bounds. Each topic has three distinct items at each of four stages: a precheck, immediate postcheck, delayed recall, and transfer. Numerical answers are graded by fixed code rather than an LLM. A delayed stage opens one day after the immediate submission and the transfer stage opens seven days after it; actual timestamps preserve late participation. The transfer stage does not require completing delayed recall.

Each record identifies the tutor revision selected at start. Assistance is recorded as `none`, `assisted`, or `unknown`. Only stages marked `none` contribute to unaided summaries. If both precheck and immediate scores are eligible, their difference is reported as descriptive immediate gain; eligible delayed and transfer scores are reported separately. Missing or ineligible stages remain null. Exact repeated submissions are idempotent, conflicting resubmissions fail, and persisted grades are checked by replay through the independent grader. Learner-facing prompts and records omit answer keys.

The bank is fixed and small. Its forms are not psychometrically equated, revision exposure is operator-recorded, and assistance is self-reported. The pre/post difference therefore cannot isolate instruction from item difficulty, testing effects, selection, or outside help. These CLI records provide a basis for future trials; they do not currently drive automatic skill promotion or establish a causal effect.

== Historical archive and simulator protocol

For continuity, we retain the earlier diagnostic analyses. The archive contains 22 model-generated teaching traces. Selecting the latest timestamp for each topic and learner-model pair retains 16 sessions across four topics and four learner models, matching `test/final_dataset.json`. One record uses a 0-10 encoding rather than 0-1 and is divided by ten before aggregation. The mean of the archived mastery, engagement, and clarity labels is a descriptive composite. Scorer identity and inter-rater reliability are unavailable. Reported 95% bootstrap intervals use 5,000 resamples with deterministic seeds; they describe variation in this archive and do not repair its selection or labeling limitations.

The legacy simulator maps nine policy controls and eight sampled learner attributes to fit and overload terms, then to algebraic mastery, retention, engagement, transfer, and confusion values. It executes no revised tutor response. Its coefficients are available in `shared/pedagogy/benchmark-real.ts`; the Node module under `src/core/` exposes that implementation. In abstract form, its score is $S = sigma_M M + sigma_R R + sigma_E E + sigma_T T - sigma_C C$. The outcome names designate simulated quantities, not measured human variables. Inspectability makes the mechanism reproducible while also making its preferred policy coordinates available to the optimizer.

The frozen `me-candidate-33` policy originated in Keating 3.3.0 and remains at `docs/study/evaluated-policy.json`. We reevaluate it and `DEFAULT_POLICY` with fixed default weights over seeds 1-200, 14 topics, and three pseudo-learners per topic, with provider judging disabled. One-at-a-time coordinate swaps use the same seeds. Thirty derivative-focused MAP-Elites runs use 24 candidates each and distinct temporary grids. Candidate search co-evolves weights and uses candidate-specific seeds; reported deltas reevaluate each selected policy against default on the same run seed with fixed weights. These analyses diagnose the legacy score model and search procedure; they are not runs of the new teaching-skill loop.

== Reproducibility and implementation checks

The analysis script records the executed package version separately from the historical policy's origin version. It hashes a manifest of the relevant current source, package/lock files, base teaching prompt, suite, archive, and frozen policy. Package version alone does not identify the revised working tree. Generated JSON and Markdown include the case inventory, all historical seed comparisons, ablations, and isolated search reruns. They explicitly record that new-loop live-provider and human-learning results were not collected for this paper.

Local tests exercise fixed-corpus score invariance, evidence completeness, critical failures, revision binding, holdout reuse, concurrent activation, session pinning, and assessment timing and missingness. Runtime fixtures invoke actual Pi and browser Agent tool paths in disposable environments with controlled local responses. Passing those checks establishes behavior under the tested fixtures. It does not measure external model quality, judge agreement, teaching latency in production, or human learning effects.
