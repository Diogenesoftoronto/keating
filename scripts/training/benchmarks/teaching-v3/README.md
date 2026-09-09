# Keating teaching v3: actual CLI conversations

Version 3.0.0 contains **12 authored episodes, 62 learner messages and 48 behavioral rubric dimensions**. Each episode has five or six learner messages. Three episodes reopen the same Pi session; two start a new session with the same local learner state. Four authored files supply inspectable lesson material. These are public development cases, not a sealed promotion set.

The measured path is `launchRpcClient` through the actual Keating Pi runtime, teaching extension, local tool handlers and disposable filesystem. The broader [harness design](../../../../docs/plans/teaching-benchmark-v3-harness.md) describes a separate browser track; this case pack measures **headless CLI/TUI behavior**. It cannot establish browser Flue behavior, terminal pixels, human learning gains or deployment readiness.

| Episode | Main challenge |
| --- | --- |
| `fraction-whole-repair` | Correct result from an unreliable rule; worked help, prediction and changing units |
| `array-bounds-reopen` | Recover a loop investigation; empty arrays and adjacent-pair transfer |
| `cancel-domain-alternatives` | Preserve domain restrictions and accept another valid method |
| `tank-rate-quantity` | Separate amount from rate; change representation and bound a physical model |
| `alarm-key-denominator` | Correct an authored wrong key; conditional probability and ambiguous accuracy |
| `closure-help-new-session` | Stop ineffective questioning; persist only supported feedback across sessions |
| `cache-changing-priorities` | Compare viable designs, then revise them under a stricter freshness requirement |
| `sql-null-fixture-repair` | Inspect an authored fixture, reason through NULL and accept equivalent repairs |
| `survey-mean-inference` | Weighted averages, sampling limitations and competing causal explanations |
| `goal-evidence-new-session` | Persist a real goal; update progress only as the evidence permits |
| `reading-revision-privacy` | Competing text-grounded interpretations and temporary learner beliefs |
| `worksheet-injection-grade-gap` | Mixed/partial/missing work, hostile submission text and unavailable quiz persistence |

## What the scripts mean

`steps` contains learner messages, `reopen` and `new_session`. Indices in `evidence_steps` and `after_step` are **zero-based over all steps**, including session events. Only messages and authored `seed_files` become learner input. Rubrics, references and expected state remain outside model requests.

The learner's attempts are fixed authored evidence, not reactions selected by a semantic judge. Later messages introduce their own code, arithmetic or interpretations; they do not assert that an unpredictable tutor question was asked or answered. A request to continue a topic describes the prior learner discussion, not successful instruction. These fixed scripts cannot show that a learner improved because of a candidate's teaching. They also do not test an adaptive learner policy or every possible conversational branch.

The runtime's actual prompt/tool schemas remain authoritative. Current CLI interactions use canonical JSON in `keating-ui` fences. This pack does not require browser JSX, a web quiz tool or a simulated web pending-response queue. Source inspection can assess a question's content and structure; it does not prove that its controls rendered or were submitted. No case fabricates UI clicks. Native `quiz` dialogs are not completed by this text-only script, and `grade_quiz` cannot persist a plain-text worksheet under an invented pending result ID.

Code and SQL tasks permit reasoned traces, but this local profile has no shell or database execution tool. A generated `verify` checklist is not independent external verification. Reading tasks use fictional authored passages with no external biography. Assessment facts are self-contained; sound equivalent reasoning is welcome.

Only explicitly requested durable feedback and goal updates have literal `state_checks` (seven checks across two episodes). These checks establish narrow file evidence, not all relevant semantics: for example, finding a `done` status alone cannot prove that the correct step was updated. Reviewers must inspect tool results and full state for that. Automatic session bookkeeping is not a forbidden profile write; the privacy rubric targets unsupported beliefs, traits and false persistence claims.

## Run and review

From the repository root, validate without model calls:

```sh
rtk uv run --project scripts/training python scripts/training/benchmark_v3.py validate
```

Run one registered, available provider/model through the actual harness. `OUTPUT_DIRECTORY` must be new; replace the uppercase arguments with actual values. This command makes model calls:

```sh
rtk uv run --project scripts/training python scripts/training/benchmark_v3.py run OUTPUT_DIRECTORY --provider PROVIDER_ID --model MODEL_ID
```

Use `--case-id CASE_ID` for a single episode. An offline transport uses `--tape-directory TAPE_DIRECTORY`, with one `CASE_ID.json` response tape per selected case; it establishes integration behavior only. Custom HTTPS endpoints require `--endpoint`, `--api-key-env`, `--context-window` and `--model-max-tokens`; keep credential values in the environment. The runner enforces the current experiment's provider exclusions. See `run --help` for its current interface.

Validate separately authored evidence-bound review files:

```sh
rtk uv run --project scripts/training python scripts/training/benchmark_v3.py review RUN_DIRECTORY REVIEW_DIRECTORY REVIEW_OUTPUT_JSON
```

Each dimension uses 0/1/2 behavioral anchors and specified evidence steps. Reviewers may abstain when evidence is unavailable. Equivalent wording and alternative sound strategies count. A question earns pedagogical credit only when useful in context; refusing direct help, verbosity, token count, cost and number of tool calls are not quality surrogates. Tool delivery, local state checks, domain correctness and teaching judgments remain distinct. Agent/model judgments require their actual reviewer provenance and are not human ratings or assumed calibrated scores. Incomplete episodes are unavailable for whole-episode quality judgment, not automatic bad-teacher examples.

Cases are original evaluation material, with no private Downloads excerpts or copied training trajectories. Keep them excluded from training corpora, but acknowledge that repeated tuning makes them known development targets. Freeze case/source hashes for a run; changes require a new version and explicit disclosure. Do not silently overwrite v1/v2 or previous v3 results. Claims about generalization, real retention or real transfer need separately collected evidence.
