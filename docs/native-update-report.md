# Paired native PPO update report

`scripts/training/native_update_report.py` reads a frozen evaluation suite, actual
paired responses, independent reviews and the acknowledged update record. It
produces one self-contained `index.html`, three PNG/SVG chart pairs, and a sealed
`report.json`. It makes no provider requests, creates no ratings and changes no
input files or budget ledgers. Reports contain private evaluation criteria and
responses; output must be a **new, gitignored directory under `.keating/`**.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 MPLBACKEND=Agg \
  uv run --script scripts/training/native_update_report.py \
  --suite .keating/native-learning/model-stage-zero/evaluation-suite-ppo-v1.json \
  --evaluation .keating/native-learning/model-stage-zero/paired-evaluation-v1/results.json \
  --reviews .keating/native-learning/model-stage-zero/paired-evaluation-v1/reviews.json \
  --update .keating/native-learning/model-stage-zero/negative-ppo-v1/executed-v1/result.json \
  --output .keating/native-learning/model-stage-zero/native-update-report-v1
```

Python dependencies are inline PEP 723 metadata. A first `uv` invocation may
install them; report execution itself is local and offline. Plotting imports are
deferred, so evidence validation works with the existing lightweight Python test
environment. The reporter imports only the pure hash helper from `native_training`;
it never imports the sampler, updater, Tinker or a tokenizer.

## Input and join contract

The suite supplies the exact tasks, private criterion IDs, family IDs, two arms
and one planned generation per case/arm. Every planned slot remains in the report.
The evaluation's `suite_sha256` must match the **original file bytes**, including
whitespace. `arms` maps `original_checkpoint` and `updated_checkpoint` to distinct
immutable Tinker sampler URIs. The updated URI must match the update result's
saved sampler URI when supplied. Non-null suite checkpoint bindings must agree.

Evaluation schema 1 has `rows` containing exactly:

```json
{"case_id":"authored-case","arm":"original_checkpoint","status":"returned",
 "response":{"choices":[{"message":{"role":"assistant","content":"Observed text"}}]},
 "error_type":null,"source_file":"local provenance pointer"}
```

`status` is `returned` or `failed`. Failed rows have a null response and a nonempty
`error_type`. `source_file` is provenance text; it is never opened or interpreted
as a URL. An absent row is unattempted. Returned usage comes from the OpenAI
completion's `usage`; missing counts remain null. No token counts are estimated
from text. Status and usage contradictions reject the report.

Reviews schema 1 has `rows` containing exactly:

```json
{"case_id":"authored-case","arm":"original_checkpoint",
 "criteria":{"declared_criterion":true},"rationale":"Supplied independent review"}
```

Criterion values must be boolean or null. Missing criteria, review rows, or the
entire review file remain unknown. Judgments cannot attach to failed or absent
responses. Duplicate/unknown case-arm rows, unknown criterion IDs and duplicate
JSON keys reject the report. Top-level reviewer metadata is preserved; the tool
does not certify reviewer independence. Optional review `suite_sha256` and
evaluation `result_hash` seals are checked when supplied.

Counts separate planned, attempted, returned, failed, unattempted, review-missing,
partial-review and known-token-usage denominators. Each case has matched criterion
deltas only where both values are observed. Cases sharing a family stay in one
family group; criteria, tokens and repeated aliases do not become independent
observations. No confidence interval or causal effect is inferred from three tasks.

## Completion diagnostics and provider metrics

The updater's `result_hash` is verified with its own insertion-ordered native
JSON hash convention. An adjacent `plan.json`, when present, must have a valid
`plan_hash` matching `result.plan_hash`. Its recorded `config.epsilon` supplies
the clipping bounds. If the plan is absent, ratios are still available, but
threshold-dependent metrics remain null. A mismatched or malformed plan fails.

For each original completion position, the report computes:

- Log-probability difference: `student_logprob - behavior_logprob`.
- Probability difference: `exp(student_logprob) - exp(behavior_logprob)`.
- Ratio: `exp(student_logprob - behavior_logprob)`.
- Fraction outside `[1-epsilon, 1+epsilon]`.
- Fraction where the PPO surrogate clips favorable movement: positive advantage
  above the upper bound, or negative advantage below the lower bound.

Token IDs, both score vectors and detached advantages must align exactly and be
finite. No prompt positions are included. The half mean squared log-ratio is
explicitly a sampled diagnostic, **not exact distribution KL**. These are the
student scores collected **before the optimizer step**, not a measurement of the
updated checkpoint's probability changes. Raw `loss_metrics` are displayed in a
separate section: their provider reduction scope is unverified and may include
masked prompt positions and zero-padded behavior scores.

## Read the rubric and its blind spots together

When every paired criterion is observed and tied, the headline says **no detected
improvement on the frozen rubric**. It does not say that the responses are correct
overall. Full supplied rationales appear prominently as separate post-hoc reviewer
observations, alongside the unchanged counts. The report does not classify those
rationales, invent observations, add criteria or revise scores. Full response
objects and private criteria remain available beneath each task.

In the first three-case comparison, the reviewer identified factual side-count
errors in both perimeter responses even though the narrow frozen criteria were
all satisfied. This is a rubric blind spot, not an overall pass. Correctness
coverage can be revised for a future separately frozen evaluation; the current
criterion counts must remain as reviewed.

## Notebook and checks

`analysis/native_update.py` reads the generated `report.json`, verifies its seal,
and displays the same charts, case selector, raw outputs and caveats. Its default
path is the report directory in the command above. Set
`KEATING_NATIVE_UPDATE_REPORT` or use the notebook's path field for another report.
Its PEP 723 environment includes marimo, pandas, NumPy and matplotlib. It has no
network, inference or artifact-writing cells. Missing files show an empty-state
instruction instead of fabricated sample outcomes.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uvx marimo edit --sandbox analysis/native_update.py

rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 -m unittest discover \
  -s scripts/training -p test_native_update_report.py
```

The standard-library tests exercise missingness, exact joins, family grouping,
hashes, clipping signs and provider-metric separation. The rendering test runs
when pandas/NumPy/matplotlib are installed and otherwise explicitly skips. No
sampler/updater tests or provider calls are needed to verify this reporting code.
