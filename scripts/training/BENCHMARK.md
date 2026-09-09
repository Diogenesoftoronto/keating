# Keating development benchmark

This is a stable target for improving Keating and comparing other models: 32
authored situations, an 8-case core subset, and nine human-review dimensions.
The [case guide](benchmarks/teaching-v1/README.md) describes coverage and the
relationship to observed failures. The report lets readers explore every case.

Each model generates one assistant continuation from the same fixed conversation
prefix, exact exported application prompt, and 14 tool declarations. The model
never receives the rubric, output expectations, or future-user hints. The suite
contains teaching choices, long histories, OpenUI activities, grading, learner
memory, feedback, and goals. Quiz and flashcard creation use OpenUI.

Three results stay separate:

- **Delivery:** visible responses or appropriate native calls, missing outputs,
  errors, and truncation.
- **Contracts:** actual OpenUI compilation, isolated action execution, tool
  schemas, and pending identifiers. These do not grade subject matter.
- **Teaching:** applicable 0/1/2 human ratings with response evidence or a precise
  observation. Unreviewed dimensions remain null; no overall teaching score.

The public suite is a development target. Tune against it and inspect failures,
but keep its cases and rubric out of training files. Use new conversation
families separately to check whether gains transfer. Repeated evaluation makes
these known cases; it does not establish human learning or general superiority.
Published definitions are immutable. New cases, prompt revisions, output caps,
or scoring implementations require a new benchmark version.

## Offline preparation

Run from the repository root. The examples reuse the existing uv environment:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python \
  scripts/training/benchmark.py validate

rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python \
  scripts/training/benchmark.py plan --subset core \
  --out .keating/outputs/training/benchmark/core-plan.json
```

Use `--subset full` for all 32 cases. Plans contain the exact requests and their
fingerprint, with no provider calls. Add `--input-rate`, `--output-rate`, and
`--max-cost` to examine a reservation using your provider's USD-per-million
rates. This deliberately assumes uncached input and generous token allowances;
it is not an invoice or a provider-enforced spending limit.

## Run another model

`run` supports an OpenAI-compatible `/v1` base URL. Supply a model identifier,
provider label, an environment-variable **name** holding its API key, positive
input/output rate assumptions, and a maximum reservation. Inspect all options:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python \
  scripts/training/benchmark.py run --help
```

The runner preserves the existing shared pilot budget; it does not start another
$100 allowance. Reservations survive errors. A local pilot proxy may also
reserve the same requests, so that route deliberately over-reserves. There are
no automatic retries or live tool side effects in the benchmark.

The default requested settings are temperature 0.1, top-p 1, seed 42, and the
fixed per-case output limit. Unsupported settings remain errors; do not silently
remove tools or shorten the prompt. The full exam allows 6,500 output tokens,
which exceeds the old pilot server's 2,048-token cap. That server also rejects
some frozen generation options, so use the native bridge below for these Tinker
checkpoints. An identical seed does not guarantee reproducibility across
providers; model versions and provider chat templates remain part of the
recorded configuration.

Use `import-responses` for responses generated outside this runner. Its JSON input
must attest the plan fingerprint and source provenance:

```json
{
  "plan_sha256": "COPY_FROM_THE_PLAN",
  "provenance": {"source": "Describe the actual collection and settings"},
  "responses": [
    {"case_id": "direct-const", "response": {
      "content": "ACTUAL_MODEL_RESPONSE", "tool_calls": [], "finish_reason": "stop"
    }}
  ]
}
```

Imports retain omitted cases as missing. Their settings are source-attested,
whereas the runner directly records requests it dispatches. Do not import older
report traces as new benchmark measurements: they used different inputs.

## Run the existing Tinker checkpoints

`benchmark_tinker.py` is a uv/Typer CLI that samples directly through Tinker. It
uses the same benchmark plan fingerprint and frozen prompt, messages, tools,
temperature, top-p, seed, and output caps as the generic runner. Native framing
uses `tml_v0` at effort 0.1. It creates no training clients or weight updates and
does not recreate or replace a checkpoint.

First prepare the native token counts offline, without credentials or provider
calls:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python \
  scripts/training/benchmark_tinker.py --plan-only \
  --output-dir .keating/outputs/training/benchmark/native-preflight \
  --max-cost 4
```

The default arms are untouched Inkling-Small, `identity-sft-run-v2`,
`openui-sft-run`, and `openui-sdpo-run`. The latter three resolve immutable sampler
paths from their existing `result.json` files. Repeat `--arm NAME` to select a
smaller set; use `--subset full` for all 32 cases. Output directories must be new
for each plan or run. The offline tokenizer must already be cached locally.

For a live run, use the private credential loader to place the existing Skate
entry `thinking_machines_api_key` in the `TINKER_API_KEY` environment variable.
The key value is not an argument or a report field. With that environment loaded:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python \
  scripts/training/benchmark_tinker.py \
  --output-dir .keating/outputs/training/benchmark/next-core-run \
  --max-cost 4
```

The bridge checks the complete selected run against both `--max-cost` and the
original shared $100 ledger before creating a service client. It uses exact
native input counts, maximum output counts, and conservative uncached,
undiscounted rates with the existing safety factor. Each actual sample receives
one reservation; there is no local-proxy double reservation. Concurrent spending
can still reduce available headroom, so each sample also checks the shared
ledger. Errors retain their reservation.

Each arm writes a benchmark-compatible JSON file, updated after every case, plus
`native-plan.json`. Undispatched cases remain missing. Native receipts retain
token counts, token hashes, completion tokens, parse status, requested checkpoint,
and output-limit information. These are private evaluation artifacts. Use the
common `contracts`, `review-template`, `score`, and `compare` commands below to
process them; the bridge does not execute model-requested tools live.

## Recorded core run

The four-arm core comparison ran on September 7, 2026. Artifacts are in
`.keating/outputs/training/benchmark-v1-core-20260907/`, including each arm's
responses, checked contracts, review packet, scores, and comparison with base.

| Arm | Delivered | Contract passes | Truncated / errors |
| --- | --- | --- | --- |
| Untouched Inkling-Small | 8/8 | 4/8 | 0 / 0 |
| Identity SFT v2 | 8/8 | 3/8 | 0 / 0 |
| OpenUI SFT | 8/8 | 6/8 | 0 / 0 |
| OpenUI SFT + SDPO | 8/8 | 6/8 | 0 / 0 |

These are contract results, not teaching ratings. All human-review dimensions
remain unscored, and the other 24 cases have not run. Qualitative AI observations
in `observations.json` illustrate why the distinction matters: both OpenUI-trained
checkpoints repeated a question after the learner explicitly requested a worked
example and no more questions. Such observations are not substituted for human
rubric scores.

The run used 505,840 native input tokens and 4,160 output tokens. Its conservative
reservation was $3.705712. The recorded token-cost estimate is approximately
$0.065–$0.299 across all-cached to uncached input assumptions, including the
50% discount once. Cache hits were not measured and no bill was reconciled;
storage is excluded. `cost.json` records the counts, rate source, assumptions,
and post-run shared-ledger headroom of about $7.26. Recheck the ledger before a
later run.

## Review and compare

Run `contracts --run RUN.json --out CHECKED.json`, then
`review-template --run CHECKED.json --out REVIEW.json`. The review packet includes
the fixed history, candidate response, and applicable anchors without the
provider/model labels. For comparisons, give reviewers anonymous packets in
randomized model order and allow ties. It is possible to recognize a model from
its wording; hiding metadata is only partial blinding.

Fill in reviewer identity, timestamp and method, then rate only the applicable
dimensions. Quotes must occur in the response; missing behavior can use a
precise observation. Transport errors stay unscored. A human can assign zero to
an actually empty completion. Run `score --run CHECKED.json --review REVIEW.json
--out SCORES.json`; omitting the review preserves unknown teaching scores.

`compare --left A-SCORES.json --right B-SCORES.json --out COMPARISON.json`
requires matching suite, prompt, tools, subset, generation settings and checker
versions. It reports paired human-rating differences with rated/missing counts,
and separate category-level delivery and contract results. It never removes
difficult cases to manufacture a stronger average.

The review and comparison commands are subcommands of
`scripts/training/benchmark.py`, invoked with the same uv prefix above. Use the
recorded core run for development comparisons; keep the unrun full-suite cases
and unreviewed teaching dimensions visibly separate from those measurements.

## Latest-provider comparison

The September 7 comparison also attempted 18 current model variants through
OpenAI, Anthropic, Gemini, Neuralwatt, and native Tinker sampling. Main artifacts
are in `.keating/outputs/training/benchmark-external-core-20260907/`; additional
native runs are in `benchmark-lightning-core-20260907/` and
`benchmark-qwen38-core-20260907/` under the same training output directory.

`benchmark_providers.py --config CONFIG --output-dir NEW_DIRECTORY --max-cost 20`
uses the same uv invocation above. Configurations select current model IDs and
native controls, referencing a private credential file or environment variable
name. `benchmark_lightning.py` handles the additional native model renderers.
Credentials come from Skate; never commit values or private key paths.

This comparison has its own explicitly authorized **$20 total** allowance. The
main batch received $19.50; Lightning and Qwen shared the remaining $0.50.
Allocation amendment and settlement receipts preserve the original reservations.
The earlier $100 training ledger is unchanged. Successful usage settles at
conservative uncached prices; missing usage retains reservations. These
estimates are not reconciled invoices.

Adapters preserve the frozen prompt, histories, tool schemas, and output caps.
Native sampling and reasoning controls differ and are recorded separately, so
these are descriptive comparisons. HTTP failures remain unscored. Human
teaching dimensions remain unknown until reviewed.

Timing measures the whole request, including provider scheduling and prompt
processing. It is not time to first token or isolated decoding speed. The unit
ends at the first assistant output or native tool call: a call-only result does
not establish what the model would teach after the tool returns. Neither long
trajectory adaptation nor harness self-evolution is measured. Passing every
contract check does not establish a ceiling on teaching quality.
