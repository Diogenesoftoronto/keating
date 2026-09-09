# Keating Teaching Check v2

A public development benchmark for comparing models and improving Keating’s teaching behavior. It contains **48 original authored cases**, a **16-case core subset**, and **eight fixed conversations of 13–15 messages**. These are fictional evaluation scenarios, not copied Downloads conversations or measured learner outcomes. Version 1 remains unchanged.

The harder cases combine realistic demands: a learner changes the help they need, a fluent explanation contains a misconception, two alternatives need a defensible tradeoff, an activity must collect reasoning, or a native tool call must lead back to useful teaching. Difficulty comes from the task and conversation, rather than unrelated puzzle complexity.

## Coverage

| Case category | Full suite | Core |
| --- | ---: | ---: |
| Teaching | 15 | 7 |
| Application identity and teaching philosophy | 1 | 0 |
| Long conversation context | 8 | 4 |
| OpenUI activities | 12 | 2 |
| Submitted-answer grading | 6 | 2 |
| Native tools and evidence boundaries | 6 | 1 |
| Total | 48 | 16 |

Subjects and tasks include Python object references; JavaScript data modeling; SQL joins; algebra and functions; proportions and percentages; probability; sampling and observational inference; thermal physics; seasons; rates, units and energy; conditional logic; reading and source criticism; experimental design; caching and data retention; accessible project planning; and learner memory and goal evidence. The `family` labels identify narrower scenario skills, not 48 independent subject domains.

The core IDs are:

- `predict-python-alias`
- `predict-ice-equilibrium`
- `worked-equation-negative`
- `fluent-simpson-error`
- `reading-evidence-inference`
- `transfer-cache-policy`
- `transfer-sampling-design`
- `long-python-nested-copy`
- `long-stats-switch-support`
- `long-goal-scope`
- `long-privacy-note-revision`
- `openui-quiz-mixtures`
- `openui-deck-logic`
- `grade-quiz-heat`
- `grade-question-percent`
- `memory-followthrough-notation`

`difficulty` is an authored label: **intermediate** concentrates on one conceptual repair or bounded follow-through; **hard** combines subject reasoning with instruction, evidence or interaction constraints; **advanced** adds demanding context reconciliation, submission boundaries, or complete varied exams. These labels are not empirically calibrated item difficulty.

## Case and episode contract

`cases.json` retains the v1 case fields: `id`, `family`, `category`, `title`, `tier`, `messages`, `max_tokens`, `expect`, and `rubric`. V2 adds `difficulty`, optional reviewer-only `reference`, `expect_v2`, and `episode`.

Every case allows at most three assistant turns. Approved native tools execute against isolated deterministic state; their results can return to the candidate before its final reply. No synthetic learner answer is inserted. All cases require a final learner-facing response, including grading, memory and goal cases. A valid intermediate tool call is therefore not automatically an empty-answer failure.

Most cases permit feedback and non-sensitive learner-memory calls when justified by the actual conversation. Explicit privacy and no-retry cases narrow this allowance. Required native calls use actual supplied identifiers. `goal-step-evidence` supplies its existing goal state under `episode.tool_fixtures.goals`, so the tool’s returned title and step match the conversation. The historical failed feedback receipt is an authored failure fixture, not a production incident.

Question submission envelopes are produced by Keating’s actual serializer. Quiz fixtures are compiled through the canonical OpenUI compiler, submitted through the isolated action dispatcher, and serialized with their receipts. Their question IDs are the compiled IDs, including prefixes such as `activity-heat-mass`. Pending, objective and skipped entries remain distinct. The mixed-preference fixture contains an ungraded preference alongside pending comprehension answers.

Exact component, item, choice and quiz-kind counts are explicit user requirements. A choice-and-justification activity contains a choice question **and a separate text response**: a bare choice click does not collect an explanation merely because a declaration says `requireReasons`. Numeric simulation checks use parameter and readout IDs specified in the learner’s natural brief. The full suite includes two 20-question exams with larger output allowances to avoid making completeness primarily a short-token-limit test.

## Scoring and evidence

The model receives the fixed conversation plus the separately frozen application system prompt and tools. It does **not** receive `expect`, `expect_v2`, reviewer references, case rubrics, difficulty labels or grading targets. Existing answer keys inside historical quizzes and the application’s structured submission instructions are ordinary conversation fixtures, not hidden benchmark hints.

Deterministic checks cover delivery, activity structure, supported actions, exact submitted identifiers, selected clear verdict fixtures, numeric simulation probes, and prohibited state writes. They do not establish that explanations are helpful or that a learner understands. For example, a technically valid activity may still offer a strawman alternative or reveal an answer in its hint.

`rubric.json` defines nine dimensions, each scored only when relevant to the case. The per-case `zero`/`one`/`two` anchors accept equivalent prose and other sound approaches. They distinguish direct help from a useful independent attempt: asking a question is not inherently better, and withholding a requested explanation is not generative learning. Reviewer-only arithmetic checks are derived from the quantities supplied in the fictional cases.

An optional AI judge is **uncalibrated** until compared with independent human ratings. Record its model, prompt and version; keep its judgments separate from deterministic contracts and human ratings. Authored contrast controls test intended distinctions and are not human validation. Missing responses, transport failures, incomplete tool episodes and unrated dimensions must remain visible in denominators.

Cross-provider comparisons share the fixed cases but must disclose differences in effective sampling, reasoning, native templates and adapters. These descriptive comparisons do not imply identical generation behavior. Tool execution here does not prove production writes, paid media execution, browser rendering, accessibility, or real learner retention and transfer.

## Version and training separation

Freeze this case set, rubric, context, execution definition and checker dependencies together before running candidates. Do not silently edit cases or expectations after viewing results; publish a new identified version and retain previous definitions and artifacts. The coordinator owns `context.json` and `manifest.json`; case authors do not rewrite them.

Keep these prompts, references, rubrics and candidate responses out of training targets. Repeated evaluation and tuning still make this a known development target. Fresh held-out conversations and actual learner assessments are needed for claims about generalization, learning gains, long-term retention or causal benefits of training.
