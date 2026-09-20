# Teaching v4 — changing evidence, changing help

**keating-teaching-v4 4.1.0** is a frozen public development challenge: 12 original agent-authored cases, 73 learner messages, 59 independent rubric dimensions, and 10 families. It preserves v3.2 and uses its native CLI harness. These cases were authored for this suite, not copied from source datasets, private conversations or human traces. The local CSV, task and deliberately incorrect answer keys are original fixtures embedded in `cases.json`.

Version 4.1 removes teaching instructions and evaluator-style questions from the learner turns. Learners supply attempts, confusion and ordinary requests; private rubrics judge how the tutor responds. The [complete dialogue audit](../../../../docs/teaching-v4-dialogue-audit.md) records every before/after pair. The [original v4.0 freeze](versions/4.0.0/README.md) is preserved byte for byte for the published pilot. Its scores apply only to v4.0.

**Teaching judgment is the target.** A tutor can give an explanation, worked example, correction or assessment without being asked when the situation calls for it. It can also pause, ask a diagnostic question or leave work to the learner. Judge the timing, amount and usefulness of that support from the available evidence. Neither withholding nor explaining earns credit automatically. Learners must not supply the tutor's decision rule in their dialogue.

[Automatic response grading](../../../../docs/teaching-v4-response-grading.md) now classifies need from the preceding context, then localizes and judges the tutor's moves. `grade RUN_DIRECTORY --grader-config PATH` adds this component to existing outputs; `run --grader-config PATH` performs it after execution. Exact spans, context, classifier identity and coverage remain inspectable. The model-judge adapter is executable; broader activation classifiers require their own fitted, calibrated artifacts.

“Harder” describes the intended demands, not an established difficulty ranking. There are no candidate results yet. Publication and repeated development use rule out any claim of an untouched holdout. Exclude the entire family from training, including both members of each context pair, fixture content, references, generated trajectories, reviews and paraphrased descendants. This policy requires enforcement by the parent's training-data registry; this directory alone cannot enforce it. Do not pool scores with v3.2.

## Cases

| Cases | Family | Main demand |
| --- | --- | --- |
| `help-hint-then-flip`, `help-worked-then-flip` | affine-help-context | Same target and final attempt, different preceding work; new confusion or a valid next move changes the support needed; algebra error |
| `source-elapsed-time`, `source-equal-phase` | reservoir-task-semantics | Same log and wrong key, different task-defined denominators; task and timestamp corrections |
| `question-and-artifact-leak` | rational-question-integrity | Question/title/hint/adjacent example must not expose the answer; domain exclusions; retry |
| `confident-feedback-is-not-authority` | discount-composition | Independent check of an emphatic wrong key; first-error localization; changing percentage bases |
| `conditional-count-correction` | conditional-counts | Conditioning group, task switch, corrected counts, insufficient summary statistics |
| `unavailable-activity-repair` | activity-repair | Text fallback, no fabricated click or submission, notebook label is not a graded activity ID |
| `memory-evidence-correction-forget` | scoped-learner-memory | Scoped reports, correction, reopen versus fresh session, evidence memory and selective forgetting |
| `assisted-success-is-not-knowledge` | assistance-assessment | Copied answers, supplied explanations, independent knowledge and honest next checks |
| `delayed-affine-near-far` | affine-transfer | Interference and fresh session, near transfer to a new fee problem, far transfer to packet overhead |
| `delayed-weighting-near-far` | weighted-transfer | Interference and fresh session, near transfer to crate means, far transfer to average speed |

Each case has at least four learner messages. Allowed fixed-core steps are exactly `message`, `reopen` and `new_session`, all supported by the native v3 harness. Tutor inputs are only steps, authored seed files and optional learner context. Rubrics, reference answers, arithmetic checks, context labels and transfer annotations never enter the request. The learner supplies their own concrete problem or reasoning on each turn; they never assume a perfect prior tutor answer or an unseen UI action occurred.

Delayed probes include intervening unrelated tasks and an actual `new_session` event. There is **no wall-clock delay**. The labels describe a scripted session-gap probe, not measured long-term retention. Fixed correct answers test how the tutor responds to supplied evidence; they do not establish that the tutor taught the learner successfully. Independent knowledge, human learning effects and real delayed retention remain unknown.

## Freeze and offline commands

Run from the repository root. `-B` avoids bytecode writes. Validation and planning require only Python's standard library and print JSON to stdout. They neither create output directories nor call models.

```sh
rtk proxy python -B scripts/training/benchmark_v4.py validate
rtk proxy python -B scripts/training/benchmark_v4.py plan
rtk proxy python -B -m unittest discover -s scripts/training -p test_benchmark_v4.py
```

Integration/review tests require the existing training environment's `typer` dependency through v3. The tests perform no filesystem writes and no inference. A missing legacy dependency is reported as a skipped integration boundary, not a passing native execution.

The default commands use v4.1. To inspect or replay the original pilot inputs, supply `--suite scripts/training/benchmarks/teaching-v4/versions/4.0.0`. Validation, plans, run bindings, reviews and diagnostic reports retain the selected version. The archived README is historical documentation; its original default commands predate this version switch.

The manifest is mandatory and hashes the exact bytes of both `cases.json` and this README. The loader rejects missing files/hashes, unknown manifest members, duplicate JSON keys, mismatched identities, unsafe fixture paths, malformed references, wrong rational arithmetic, malformed rubrics and invalid temporal ordering. It records the manifest hash in plans. A manifest hash is a reproducibility identifier, not a signature: pin it externally to detect coordinated edits to both source and manifest. Version subsequent changes; preserve this freeze and previous outputs. Adapter and native runtime hashes are separately recorded at execution, since the parent owns ongoing runtime integration.

## Bounded native execution handoff

No paid calls were made to develop this suite. `request` generates JSON for the existing `runHarnessEpisode` entry point or `benchmark_harness_v3.ts` CLI. It calls v3's allowlisted `request_for`, then sets supported native limits. Defaults are **1,024 output tokens per provider call, 12 provider calls per episode, 16 tool calls per episode and 120 seconds per learner turn**. These are caps, not a guarantee of successful completion. A capped/incomplete episode cannot receive a teaching-quality score.

```sh
rtk proxy python -B scripts/training/benchmark_v4.py request --case-id help-hint-then-flip --transport TRANSPORT_JSON --max-output-tokens 1024 --max-provider-calls 12 --max-tool-calls 16
```

`TRANSPORT_JSON` is a parent-owned native transport object, e.g. a registered provider/model or tape. Endpoint credentials must be environment-variable references, never credential values. The adapter rejects unknown transport members. It does not discover or invent checkpoint identities, start a bridge or silently substitute a sampler. The native harness validates custom-endpoint compatibility. Stop if the chosen sampler is unsupported.

**v3 request transport has no temperature or seed fields.** Supplying `--temperature`/`--temp` or `--seed` to this generator fails explicitly. The parent must set temperature 1 in the existing Tinker TLS sampler bridge and capture its effective configuration/receipt; seed support must likewise be verified there. Do not claim either was forwarded by v3. Preserve the default bounded local-tool profile; no shell or new external tools are enabled by this adapter.

The requested first run of saved **current F-only and F+S Base checkpoints** is a two-checkpoint model-baseline comparison, separate from the four-role design below. Its selected cases are exactly `help-hint-then-flip` and `help-worked-then-flip`, run on both checkpoints. Parent settings: temperature1, seed null,2,048 output tokens per provider call,8 provider calls and8 tool calls per case,120-second turns, default native tools; parent-enforced child capUSD2 and total capUSD4. Those funding/lifecycle caps are not enforced by this suite. Record actual checkpoint IDs, weight/training hashes, effective decoding settings, native requests/results, tool profile and runtime hashes. Until training histories and budgets are matched, differences are descriptive, not isolated causal effects of hindsight self-distillation. This is a slice, not the full benchmark. Pairing is across checkpoint arms on identical case inputs and across the two contexts within one family.

The native provider-call limit is **per episode**, not per arm. If the parent requires at most12 calls total per arm over multiple cases, its orchestrator/bridge must enforce a shared arm budget, subtract actual calls and stop before exhausting it. A two-case slice requires at least12 learner replies per arm before any tool follow-up; three full cases generally exceed that minimum. Do not silently truncate cases to fit, claim full-case coverage, or interpret unstarted cases as failures. Use one full transfer case per arm under12 calls, increase the explicitly authorized arm budget, or report the resulting incomplete slice honestly. Parent funding and lifecycle controls remain external.

The convenience `run OUTPUT --provider ... --model ...` delegates to unchanged `v3.run`, including its provider restrictions, immutable output convention, full receipts and inspector. **It retains v3's legacy limits (3,000 tokens,48 provider calls,64 tool calls); use `request` plus the parent native runner for the bounded experiment.** `--tape-directory` is supported by this convenience path for later offline plumbing runs. No tape run is teaching-quality evidence. `v4-binding.json` records the freeze alongside the legacy plan. Direct parent harness runs must retain an equivalent freeze binding and pass the exact frozen case/result to `validate_review`; do not use the less strict legacy review command as v4 validation.

## Independent review contract

Use each dimension's distinct0/1/2 anchors. There is no keyword score, single preferred teaching strategy, question-count target or reward for calling a tool. Unrequested explanations can be necessary and excellent teaching. Assess whether giving or withholding information addresses the current need; do not score either behavior by its presence alone. Discussing uncertainty, assistance, memory or retention is appropriate when it matters to the learner's situation, but reciting these limits is not a universal requirement. Every numeric dimension must cover **all** its zero-based `evidence_steps`, including explicit early and late behavior where listed. Review each reply only against information available then. Later feedback cannot retroactively make an earlier appropriate response wrong. Missing evidence, clipping and unavailable assessment stay `null`; runtime failure and unknown quality are separate.

V4 accepts the v3 receipt envelope (`case_sha256`, `result_sha256` over canonical JSON; reviewer kind/ID; ratings). A rating has `dimension`, integer `score` in0..2 or `null`, and `reason`. Null also requires nonempty `uncertainty`. Numeric ratings contain one `evidence` object plus `additional_evidence` for the remaining scoped turns, exactly once per turn. Each evidence is either a quote with `step_index`, original `message_index` and exact visible-text `quote`, or `missing_behavior` with `step_index` and a specific `observation`. Quote only new assistant/tool-result text; never learner messages, repeated history, thinking or tool arguments. A visible complete tutor response is required to score missing behavior; absent output is unknown.

`persisted_state` dimensions additionally require `state_evidence` at every scoped step: `{step_index, path, sha256, observation}`. It must bind an actual captured active-state JSON file, not a promise, history log or fabricated path. The reviewer must inspect its contents and provenance; a valid hash proves binding, not correct semantics. Missing state capability is unknown, not success or an automatic semantic zero. Conversation can separately be judged for visible false storage claims. A local active-preference deletion does not prove erasure of historical sessions, replicas, training data or logs.

`review RUN_DIRECTORY REVIEWS_DIRECTORY` validates independently authored receipts and prints results; it does not create or call a judge. Missing reviews remain unknown. V3 `summarize` is reused for operational accounting with unsupported assessment fields explicitly null in the v4 wrapper. Full-episode quality is null if any dimension abstains. Report dimension coverage rather than silently normalizing over only the observed dimensions. Actual reviewer independence, calibration, blinding and semantic truth need external review; the validator proves structural/evidence consistency only.

Question leaks concern actual learner-visible prompts, titles, hints, explanations and artifacts. Evaluator-only answer keys or genuinely hidden grading metadata are not automatically leaks. Fixed core can inspect generated text/source but cannot prove terminal pixels, browser rendering, delivery or successful submission. The separate adaptive condition must bind a versioned observation-driven controller, real emitted source document and task semantics, available actions, actual submission/repair receipts and stop rules. Do not invent actions in fixed learner text or pool adaptive scores with the fixed core. The parent owns that source/OpenUI integration.

## Versioned matched checkpoint comparison

`matched-checkpoints-1.0.0` defines four roles: initial (neither objective), F (feature reward only), S (hindsight self-distillation only), F+S (both). S denotes the project's SDPO hindsight objective, **not direct source SAR supervision**; source selection in these cases is a behavioral challenge, not the definition of S. `plan` emits null checkpoint slots until real identities are supplied. Optional `--checkpoints PATH` accepts an object with exactly those four keys; each value has `checkpoint_id`, `weights_sha256`, `base_checkpoint_id` and `training_manifest_sha256` (null only for initial). All arms must identify the same initial base. Supplied hashes are identifiers, not proof the weights are available or training was matched. The plan never invents weights, measured outcomes or readiness.

Match base/tokenizer, eligible data, family exclusions, update/token budget, training seed blocks, objective versions/weights, runtime source AND built artifacts, prompt, tools, surface, per-call/per-episode limits and supported decoding controls. Freeze these before measured execution. Use fresh workspaces per case/arm. The plan rotates arm order deterministically across cases/repeats; order rotation is not a provider sampling seed. Default three repetitions are planned only. Record failed/unstarted runs with reasons, without selecting convenient retries.

Blind checkpoint identities from independent reviewers; calibrate on separate nontraining material, record disagreements and adjudicate without rewriting the suite. Report per-dimension and per-case results, then average paired context members within each family before a family macro average. Compare F−initial, S−initial, F+S−initial and the interaction (F+S)−F−S+initial on jointly observed evidence. Preserve nulls and full denominators; report coverage and paired family-level uncertainty. Ten public families are a small, development-exposed sample. This can reveal behavioral regressions; it cannot establish human learning efficacy, an untouched generalization result or a safe promotion decision by itself.
