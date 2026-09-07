# Teaching evolution and learner measurements

Keating can now execute teaching experiments, propose one teaching skill, and activate its exact revision when independent validation and holdout gates pass. This establishes eligibility for experimental teaching use. It does not establish improved human learning.

The design separates raw executions, a maintained pattern wiki, and deployable teaching procedures, informed by [WikiSkill](https://arxiv.org/html/2608.27454). Failed proposals remain inspectable. The current implementation evolves bounded skill instructions, not its own evaluator, assessment keys, tool permissions, source code, or scoring thresholds.

## Commands

Run these from the project whose teaching state you want to use, inside its Devenv environment:

```bash
keating bench [topic]
keating teaching-bench
keating auto-improve
keating auto-improve --cases ./independent-cases.json
keating auto-improve --cases ./independent-cases.json --force
keating evolve [topic]
```

- `bench` summarizes historical assessment and feedback records. Recorded quiz performance is observed; feedback and inferred conversation signals are proxies. Learning gain, retention, and transfer remain unknown without corresponding measurements. A fixed corpus produces the same scores under different candidate policies or weights.
- `teaching-bench` executes only the training split using the active tutor revision. It never runs a validation or release holdout and never activates a revision. `--cases <file>` selects a case pack.
- `auto-improve` runs one proposal through training, paired validation, and a sealed holdout. Its verdict is `accepted`, `rejected`, or `failed`. A positive score delta cannot override failed criteria. Failure scores can be unavailable.
- `--force` bypasses only the 30-minute cooldown. It cannot bypass evidence gates or reopen a consumed holdout.
- Legacy `evolve` writes unvalidated parameter proposals and a descriptive baseline report. It preserves the active policy and existing policy archive. Its minimum corpus count is a proposal-generation prerequisite, never statistical validation.
- Legacy prompt scores and `prompt-evolve` snapshots remain prompt-quality diagnostics. They do not establish learner outcomes or authorize the teaching revision gate.

The CLI no longer treats a positional topic on `auto-improve` as an experiment specification. Use an independent case pack to choose the experiment's scope.

Devenv exposes the same operations without a separate task runner:

```bash
devenv tasks run keating:teaching-bench
devenv tasks run keating:auto-improve --input cases=./independent-cases.json
devenv tasks run keating:learning-check:start --input topic=fractions
devenv tasks run keating:learning-check:list
devenv tasks run keating:learning-check:show --input id=<check-id>
```

`keating:auto-improve` also accepts `--input force=true`. `keating:learning-check:submit` accepts `id`, `stage`, `answers` (a JSON string), and `assistance`. Task input is passed as an argument array rather than executed as shell text.

## Experiment architecture

The shared implementation is in `shared/evolution/`. Each experiment:

1. Loads and verifies the incumbent's content-addressed revision and its prior activation evidence.
2. Executes fresh tutor responses to training conversation prefixes. It never reuses a historical learner response as the counterfactual reaction to changed teaching.
3. Runs a separate wiki maintainer over fresh training evidence and indexed prior knowledge. It commits pattern refinements and a maintenance log before any skill proposal.
4. Lets the proposer selectively read the wiki and training traces, then create or replace one skill with explicit evidence and pattern references.
5. Runs incumbent and candidate independently on the same validation cases, using the same recorded model/runtime.
6. If validation passes, marks the release holdout consumed before executing it and independently compares both revisions there.
7. Persists the experiment before atomically changing the active revision pointer. Accepted skills apply to subsequent sessions; running sessions keep their revision.

The actor sees the learner conversation prefix and composed teaching instructions. It does not receive the case rubric, validation results, holdout results, the hypothesis ledger, or wiki pages. The judge sees the fixed case and actual execution, not candidate instructions. The maintainer and proposer see training evidence, indexed patterns, maintenance logs, and aggregate skill-impact history, never held-out conversations or their answer criteria.

The promotion gate is fixed: at least six independent case families, no family regression, no failed critical candidate criterion, mean improvement of at least 0.05, and a one-sided paired sign-test p-value at most 0.05. Validation and holdout must each pass. Missing execution/judge results invalidate the comparison. These are behavior-benchmark gates, not a power analysis or causal test of human learning.

The bundled suite has 6 training, 6 validation, and 6 holdout cases. A full successful invocation executes 30 tutor episodes, 30 judgments, one maintenance pass, and one proposal. Maintenance and proposal each allow up to six model calls (twelve extra calls total), including selective reads; they are not a single-call cost estimate. Default episode limits are 90 seconds, six provider calls, eight tool calls, 2,048 output tokens per provider call, and 1 MiB subprocess output. Experiments allow one candidate, at most two repeats, and at most 60 tutor episode executions, counting both incumbent and candidate runs. CLI packs are bounded to 60 cases and 1 MB. Model-backed commands require a configured authenticated provider and incur provider usage.

The Pi evaluator runs the production pedagogical tool implementations in a disposable workspace with in-memory session state. Its allowed tools are `plan`, `map`, `verify`, `quiz`, `grade_quiz`, and `read`; reads stay inside that workspace. It excludes shell execution, source editing, recursive evolution, animation's nested inference, external context files, and user extensions. The judge has no tools. The maintainer and proposer can request up to three allowlisted wiki/training paths per round; they have no filesystem or host tool access. This tests the bounded pedagogical subset; it is not full UI, browser, speech, arbitrary tool, or deployment proof.

The browser adapter uses a fresh Pi Agent, the selected model and thinking level, and a disposable IndexedDB database. Its allowed tools are `deck`, `quiz`, `grade_quiz`, and `grade_question_checks`. It applies a revision to subsequent sessions using the same base persona; changing the persona leaves the old revision archived. Evaluators, sealed cases, assessment keys, and activation modules are excluded from the mutable NodePod boot bundle.

## Maintained wiki

`shared/evolution/wiki.ts` stores immutable, content-addressed knowledge snapshots.
`state.wikiRevisionId` points to the latest one. The generated index advertises
pattern summaries, maintenance logs, impact records, and training trace paths;
full pages and raw executions are read on demand. Every trace is digest-checked.
Neither arbitrary paths nor validation/holdout traces are readable through this
interface.

The maintainer creates or replaces pattern pages using an expected revision and
fresh training evidence. Prior evidence references remain attached. A separate
proposer links its procedure to these patterns through `TeachingSkill.patternIds`.
The loop records the procedure before/after, its verdict, and aggregate validation
delta itself; the model cannot invent an impact record. A failed or rejected
proposal preserves the committed knowledge. Changing the base persona starts a
separate empty wiki while keeping previous snapshots archived.

The implementation is deliberately bounded: 128 patterns, 16 patches per pass,
12,000 characters per page, 2 MB per snapshot, and bounded model inspection. Limits
fail explicitly rather than silently dropping evidence. There is no automatic
archive compaction, page deletion/merging, account-wide wiki synchronization, or
claim to reproduce WikiSkill's published benchmark gains. Long-running curation
will need an explicit archival policy before these limits are reached.

## Case packs and holdout renewal

`--cases` accepts a JSON array of `TeachingCase` records. Each record contains:

```json
{
  "id": "train-example",
  "family": "independent-concept-family",
  "domain": "mathematics",
  "split": "train",
  "messages": [{ "role": "user", "content": "Ask one question to diagnose my confusion about multiplying fractions." }],
  "rubric": [
    { "id": "correct", "description": "The question is mathematically well formed.", "critical": true },
    { "id": "diagnose", "description": "The question distinguishes plausible underlying misconceptions.", "critical": false }
  ]
}
```

Supported domains are `mathematics` and `programming`; splits are `train`, `validation`, and `holdout`. Conversations must end with a user turn. Every case needs a nonempty rubric with at least one critical criterion. IDs must be unique and a family cannot cross splits. An experiment needs all three splits and enough independent families to satisfy both gates; the single record above illustrates the schema only.

Once a run accesses its release holdout, that content and those holdout families are exhausted, including after rejection or a crash. Neither changing record IDs nor `--force` renews the evidence. A subsequent eligible experiment requires genuinely new, independently authored holdout families and tasks. Merely relabeling or changing numbers does not create statistical independence; validation cannot enforce semantic independence by itself.

Freeze the evaluator and release cases before a proposal. Do not let the proposer rewrite the pack or evaluate against held-out tasks during its search. The CLI refuses a `--split holdout` option on `teaching-bench`. Browser experiments currently use the bundled pack; renewing browser evidence requires a new independent suite supplied by an application update.

## Actual learner checks

Independent fixed assessments currently cover `fractions` and `loop-bounds`. Each has distinct three-item precheck, immediate postcheck, delayed recall, and transfer stages. Answers are checked numerically without model judgment. Prompt output and saved learner records exclude answer keys.

```bash
keating learning-check start fractions --learner learner-1
keating learning-check show <check-id>
keating learning-check list
keating learning-check submit <check-id> precheck \
  --answers '{"fractions-precheck-1":"<your answer>","fractions-precheck-2":"<your answer>","fractions-precheck-3":"<your answer>"}' \
  --assistance none
```

Replace the placeholders with the learner's answers. After teaching, submit `immediate` using its displayed item IDs. `delayed` opens one day after that submission; `transfer` opens seven days after it. Actual submission timestamps remain recorded, so a late response is distinguishable from one at the intended horizon. Missing the one-day check does not block the seven-day check.

Use `--assistance none`, `assisted`, or `unknown` honestly. Assisted and unknown-assistance answers are graded and retained, but excluded from unaided gain, recall, and transfer summaries. Assistance is self-reported; revision exposure is operator-recorded. The CLI pins the active revision ID at start. Neither field independently proves what occurred during teaching.

Unanswered stages remain null rather than zero. A measured incorrect answer can be zero. Exact repeated submissions are idempotent; changing an answered stage or its assistance status conflicts. Writes use exclusive locks and atomic replacement. The recorded revision cannot be changed through the submission API.

The immediate score difference is descriptive within-person performance, not a causal treatment effect. The small fixed bank, self-reported assistance, repeated exposure, and lack of randomized learner groups limit interpretation. These records provide an auditable basis for later trials; they are not converted into satisfaction-based retention estimates or mixed into synthetic episode scores.

## Storage and scope

- CLI/Pi revisions, raw episodes, wiki snapshots (`wiki/<digest>.json`), hypotheses, and activation state live under the current project's `.keating/state/teaching-evolution/`. Reports are under `.keating/outputs/benchmarks/teaching-experiments/` and `teaching-episodes/`.
- Learning checks live under `.keating/state/learning-checks/`, separate from disposable tutor workspaces.
- Browser state lives in the current origin's `keating-teaching-evolution` IndexedDB database, with Web Locks coordinating tabs. It is browser-local and currently has no account namespace or cross-device synchronization.

These paths are not yet an account-wide control plane. CLI and browser revisions have different base prompts and separate stores; they are not interchangeable. Clearing browser data loses its local history. A held-out experiment proves only what its recorded runtime and evaluator exercised.

Deterministic tests inject runners, judges, and proposers to verify gating, persistence, exact revision activation, missingness, replay, and failure behavior. Live experiments use model judgments on synthetic learner prefixes; judge calibration against independent human ratings and randomized human learning trials remain separate validation work.
