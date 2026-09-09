# Local Keating checkpoint pilot

This serves one account's saved Inkling-Small checkpoint through Keating's
OpenAI-compatible provider path. Authentication is an operator-issued local
bearer token. This does not deploy a production Not Organic inference route,
prove browser sign-in, or establish teaching improvement.

Prerequisites:

- A completed run directory containing `result.json` and an existing shared
  budget ledger. The result must identify the expected account DID,
  `thinkingmachines/Inkling-Small`, `tml_v0`, native effort `0.1`, and an immutable
  `tinker://.../sampler_weights/...` checkpoint.
- The locked uv training environment (Python 3.12, Linux x86_64). The project
  pins Tinker, its cookbook, TML renderers, CPU PyTorch, and Typer.
- `TINKER_API_KEY` loaded into the server environment. Do not put it in browser
  settings, command arguments, source files, or logs.
- An operator-owned, mode-0600 `pilot-token` file containing an opaque token.

From the repository root, install or check the locked dependencies in the
existing training environment. Do not synchronize an environment while its
training or serving processes are running:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv sync --project scripts/training --locked
```

All Python entrypoints use Typer and provide `--help`. Start the server with the
actual completed run path. `--no-sync` preserves the running environment:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python scripts/training/serve_pilot.py \
  --run-dir /absolute/path/to/completed-run \
  --token-file .keating/outputs/training/pilot-token
```

It listens only on `http://127.0.0.1:8789/v1`. It snapshots the checkpoint at
startup; restart deliberately to serve a different completed run. Shared budget
reservations are recorded before generation and retained after failures. Their
amounts are conservative estimates, not provider invoices.

For a child SFT run, explicitly reuse the original training ledger with
`--budget-file`; serving refuses a missing ledger and never creates a new cap:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python scripts/training/serve_pilot.py \
  --run-dir .keating/outputs/training/identity-sft-run-v2 \
  --budget-file .keating/outputs/training/inkling-pilot/budget.json \
  --token-file .keating/outputs/training/pilot-token
```

The optional `result.json` field `public_model_id` controls the discovered and
accepted API model alias. `keating-bot-latest` displays as **Keating Bot (latest)**.
Older results without this field retain `keating-pilot`. Renaming the public
alias does not change the base model, sampler checkpoint, or system prompt.

Use a local Keating web session at `http://localhost:3000`. In Settings, add an
OpenAI-compatible custom provider with that API base URL and the **pilot token**
as its API key, discover models, and select the advertised alias. Model discovery
advertises a 2,048-token output limit and text input. The server accepts up to
32,768 prompt tokens and 512 KiB per request. For a different local web origin,
restart with an exact `--origin` value. Production `https://keating.help` is not
the default allowed origin.

The native TML adapter retains the supplied Keating system prompt and function
schemas. It returns tool calls to Keating; it never executes tools itself. It
accepts `auto` and `none` tool selection. Forced tool selection, strict
constrained decoding, and request-level reasoning overrides are unsupported.
The checkpoint's native effort remains `0.1`.

The SDK smoke script uses the exact installed dependency imported by
`web/src/hooks/keating-stream.ts`: `@earendil-works/pi-ai/compat`. It reads the
exported `system-prompt.txt` and `tool-schemas.json` without rewriting them.
Its default is a zero-network payload preflight:

```bash
rtk bun scripts/training/smoke_keating_sdk.mjs \
  --run-dir /absolute/path/to/completed-run \
  --owner-did did:plc:EXPECTED_ACCOUNT
```

After the server is ready, add `--execute` for one generation with at most
1,024 completion tokens and no client retries. Use `--message-file` to provide
the user turn; otherwise the script uses a short fractions question. It stops
after the first assistant response, records any returned tool calls, and
executes none of them. The private `keating-sdk-smoke.json` artifact contains
the response, token usage, request hashes, and checkpoint/account association.
Console output contains only metadata.

For the SDPO follow-up, `run_tinker.py --parent-run` branches from the saved SFT
training state with fresh optimizer moments. It requires the same account,
prompt, tools, base model, and explicit shared `--budget-file`. The child result
advertises `keating-bot-sdpo`; keep the SFT endpoint on 8789 and serve the child
on 8790 for a direct comparison:

```bash
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache \
  UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python scripts/training/serve_pilot.py \
  --run-dir .keating/outputs/training/identity-sdpo-run \
  --budget-file .keating/outputs/training/inkling-pilot/budget.json \
  --token-file .keating/outputs/training/pilot-token --port 8790 \
  --origin http://127.0.0.1:3001
```

This requires a completed child `result.json`. Use the SDK smoke command with
the child run directory and `--port 8790 --origin http://127.0.0.1:3001 --execute`
to test it. Both endpoints
use the same local bearer token and spend ledger. `comparison-probes.json`
contains paired SFT/SDPO responses; `evaluation.json` contains the case-study
validation comparison. These are response comparisons, not learner outcomes.

The local UI for this experiment runs at `http://127.0.0.1:3001`. Port 3000 is
occupied by Not Organic. Do not start a second UI on the same port; open the
existing one. To restart after it has stopped, use:

```bash
rtk proxy env KEATING_WEB_DEV_PORT=3001 devenv tasks run keating:web
```

In Settings > Custom Providers, add an **OpenAI Completions Compatible** provider
with base URL `http://127.0.0.1:8790/v1` and the contents of `pilot-token` as its
API key. Select `keating-bot-sdpo` after saving. Discovery and inference to local
providers use Keating's same-origin chat proxy. The endpoint supports that
transport and direct requests from the exact configured UI origin.

Provider-free adapter tests:

```bash
rtk proxy env UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked --no-sync python \
  -m unittest discover -s scripts/training -p test_serve_pilot.py -v
```

The HTTP tests require permission to open loopback sockets. Passing these tests
or the payload preflight is not evidence of a paid generation or browser UI
verification.

## Tool-call execution boundary

The saved pilot receipts distinguish a text response from a generated `quiz`
call. Receiving a correctly parsed call through the SDK proves tool-call
transport; it does not prove the browser executed or displayed that quiz.

The real handler is `createAssessmentTools(...).quiz` in
`web/src/keating/browser-tools/assessment.ts`. It validates authored questions,
calls the deterministic quiz builder, then awaits
`KeatingStorage.saveLessonPlan(...)` before returning the saved artifact link
and interactive quiz payload. `KeatingStorage` in
`web/src/keating/storage.ts` persists that record through IndexedDB. A
constructor-only storage object is insufficient for execution.

Complete this additional gate in an available authorized Keating browser:
execute the returned call through the real tool executor, verify its persisted
artifact and quiz UI, then let the SDK send the actual tool result back to the
same checkpoint. Do not substitute an invented tool result or an in-memory
storage double and label that browser persistence proof. The selected browser
runtime was unavailable during this pilot, so this gate remains unverified.


## OpenUI curriculum checkpoints

The later interaction experiment has separate endpoints on 8791 (`keating-bot-openui`, two SFT epochs) and 8792 (`keating-bot-openui-sdpo`, six fresh-feedback updates). Use the same private pilot token. Keep historical 8789/8790 checkpoints distinct when comparing results.

For the SDK smoke, pass the current exported prompt and schemas from `.keating/outputs/training/openui-training-context/`, plus `--port 8791` or `--port 8792`. The smoke now defaults to `--temperature 0.1`, matching Keating; `--temperature 1` remains available for a higher-entropy probe. Transport success does not imply valid OpenUI. The SFT smoke at temperature 1 returned malformed source; its 0.1 follow-up compiled and completed a four-card review in isolated memory. Both outputs are retained.

The servers remain capped at 2,048 output tokens. The standalone exam evaluation allows 4,096 tokens, so its results cannot establish successful exam serving under the endpoint's smaller output limit.

The fresh SDPO SDK smoke also returned four valid equivalent-fraction cards at temperature 0.1. Its `sdk-openui-check.json` records a successful canonical review in isolated memory. This is transport and contract execution evidence, not browser persistence. The public report preserves all seven cases and every failure for each of the three interaction checkpoints.
