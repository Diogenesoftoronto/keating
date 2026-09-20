# Separate instruction-model learner

`scripts/training/native_tinker_learner.py` serves **only the simulated learner** through the existing `JsonChatLearner` HTTPS interface. It selects `Qwen/Qwen3.5-9B`, leaving the actor and frozen observer on their existing Base checkpoints. This addresses the observed Base learner role-fidelity failure by making the simulator model an explicit experimental change. A live canary and independent role-fidelity review are still required; the offline tests do not establish improved learner behavior.

The adapter does not install an actor, change prompts or surfaces, produce training examples, or perform a policy update. Import, `draft`, `audit`, and `plan` create no Tinker service and retrieve no credential. Only a request to a separately launched server can dispatch, after validating funding and reserving its full bound.

## Verified pins

Source check: 13 September 2026. Tinker lists the post-trained `Qwen/Qwen3.5-9B` separately from `Qwen/Qwen3.5-9B-Base`, with prefill/sample prices of $0.66/$1.995 per million tokens. The adapter uses those undiscounted rates and a 5× reservation factor. [Tinker model catalog](https://tinker-docs.thinkingmachines.ai/tinker/models/)

| Component | Pin |
| --- | --- |
| Hosted model selection | `Qwen/Qwen3.5-9B` |
| Public HF model/tokenizer revision | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` |
| Tinker SDK | `0.27.1` |
| Cookbook | `0.5.7` |
| Transformers | `5.3.0` |
| Torch environment dependency | `2.10.0`, CPU wheel |
| Renderer | `qwen3_5_disable_thinking` |
| Renderer source bundle hash | `41591874715ca998dea01f5d3e06ad7dcbce7f1c36e2d7d765905f63f40d266b` |
| `tokenizer.json` SHA256 | `5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42` |
| `tokenizer_config.json` SHA256 | `316230d6a809701f4db5ea8f8fc862bc3a6f3229c937c174e674ff3ca0a64ac8` |
| `chat_template.jinja` SHA256 | `a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715` |

The HF card identifies pretraining and post-training and documents non-thinking mode. The pinned cookbook renderer supplies the empty thinking prefix; a local test checks its token IDs against the pinned HF template with `enable_thinking=False`. This is a text-only adapter. No image or visual-observation support is implied. [Pinned Qwen card and files](https://huggingface.co/Qwen/Qwen3.5-9B/tree/c202236235762e1c871ad0ccb60c8ee5ba337b9a)

**The HF revision is not proof of the hosted weight revision.** SDK `create_sampling_client(base_model=MODEL)` accepts a model name, with no HF revision argument. The adapter checks the returned base-model identity. Every config and journal explicitly says `not_attested_by_tinker_base_model_api`. The server's provenance revision is its sealed deployment config hash, not a claim about immutable hosted weights.

## Funding contract

The operator must already have a completed allocation in the single shared $100 research ledger and initialize a dedicated child ledger. The server never creates either ledger from a config cap. A child cap is an allocation inside the shared cap, not additional authority.

Required shared ledger identity:

```json
{
  "project_id": "keating-native-research-2026-09-13",
  "model_id": "shared-runpod-and-tinker",
  "cap_usd": "100"
}
```

The parent grant must exist at `runs[allocation.id]`, have status `complete`, have dispatched all declared phases, and reserve at least the child cap. Total parent reservations must stay within $100. The child model must be exactly `Qwen/Qwen3.5-9B`; it must carry this extra field in its sealed ledger:

```json
{
  "parent_allocation": {
    "ledger_path": "/absolute/path/inside/repo/.keating/native-learning/research-budget-v1.json",
    "plan_hash": "64-character-completed-parent-grant-hash"
  }
}
```

The parent owns allocation uniqueness: use one dedicated child ledger per grant, never initialize several ledgers against the same grant. Both files must preexist, be private, and reside in the actual gitignored `.keating/` tree. Symlink paths are rejected. Any child run that is not complete blocks a new request, including a restart in another state directory.

For an already completed parent grant, the parent can prepare the child/config with the existing modules:

```python
from pathlib import Path
import native_training as nt
from native_tinker_update import BudgetLedger, write_private
from native_tinker_learner import learner_config, MODEL

# grant, shared_path, child_path, config_path, child_project, child_cap are
# supplied by the parent. child_cap is a decimal string, for example "1".
cfg = learner_config()
cfg["allocation"] = {
    "id": grant["plan_hash"], "ledger_path": str(Path(child_path).resolve()),
    "budget_project_id": child_project, "cap_usd": child_cap,
    "parent_ledger_path": str(Path(shared_path).resolve()),
}
child = BudgetLedger(child_path, child_project, MODEL, child_cap)
with child.locked() as value:
    value["parent_allocation"] = {
        "ledger_path": str(Path(shared_path).resolve()), "plan_hash": grant["plan_hash"]
    }
cfg = nt.seal(cfg, "config_hash")
learner_config(cfg)
write_private(config_path, cfg)
```

Each valid request is rendered locally and rejected if prompt plus maximum completion exceeds context. The reservation is `5 × (prompt_tokens × 0.66 + max_tokens × 1.995) / 1_000_000`, rounded up to eight decimal places. The first request reserves before `ServiceClient` and `create_sampling_client`, then marks sampling as a separate phase. Later requests reuse the checked client with a new reservation. Setup currently has a declared zero token charge. Reservations are retained on success and failure; they are not invoices or a provider-side cap.

## Commands and parent integration

The new script has the same PEP-723 SDK environment pins as the actor sampler. Use the existing warm environment for the current checkout:

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH .keating/cache/uv/environments-v2/native-tinker-sampler-4adb9e6fa92dcd07/bin/python3 scripts/training/native_tinker_learner.py draft
rtk proxy env -u PYTHONHOME -u PYTHONPATH .keating/cache/uv/environments-v2/native-tinker-sampler-4adb9e6fa92dcd07/bin/python3 scripts/training/native_tinker_learner.py audit
rtk proxy env -u PYTHONHOME -u PYTHONPATH .keating/cache/uv/environments-v2/native-tinker-sampler-4adb9e6fa92dcd07/bin/python3 scripts/training/native_tinker_learner.py plan --config CONFIG.json --request REQUEST.json
```

For a fresh machine, `rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_tinker_learner.py audit --download-tokenizer` permits only three public tokenizer/template downloads. Without the flag the audit is cache-only. Model weights are never downloaded. `seal-config --config DRAFT.json --output SEALED.json` validates all fields and writes a private sealed config inside `.keating/`.

After parent review and funding, the parent launches:

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH -u TINKER_PROJECT_ID .keating/cache/uv/environments-v2/native-tinker-sampler-4adb9e6fa92dcd07/bin/python3 scripts/training/native_tinker_learner.py serve --config CONFIG.json --state NEW_IGNORED_STATE --port 0
```

`serve` creates fresh loopback TLS material via `benchmark_tinker_bridge.create_material`, writes `learner-server.json`, and prints metadata containing the endpoint, token-file path, certificate path, config revision and journal path. It does not print the token. The API key is read from `TINKER_API_KEY` or the named Tinker Skate entry only when a funded request reaches `connect`. `account_default` rejects an inherited `TINKER_PROJECT_ID`; explicit project selection requires the matching config field.

The parent reads `token_file` privately into a **separate learner bearer environment variable**, then supplies the manifest fields to the existing `JsonChatLearner`:

```json
{
  "endpoint": "https://localhost:PORT/v1/chat/completions",
  "api_key_env": "KEATING_NATIVE_LEARNER_TOKEN",
  "model": "Qwen/Qwen3.5-9B",
  "revision": "native-instruction-learner-config:CONFIG_HASH",
  "temperature": 1,
  "max_tokens": 2048,
  "json_mode": "prompt_only"
}
```

Trust the new certificate alongside the actor bridge certificate; using one bridge's certificate alone does not trust the other. Pass secrets through child environment/in-memory values, never shell literals. Shut down this server when the experiment finishes. For in-process use, `LearnerBridge(config, token, state, sampler_factory=...)` and `.server(cert, key, port=0)` expose the same boundary; the injected factory is for offline tests.

## Request, response and journal boundaries

The HTTP interface accepts text-only system/user/assistant messages, a final user message, the exact model ID, bounded `max_tokens`, temperature 1, and absent/empty tools. Streaming, storage, tool requests, arbitrary provider parameters and `response_format` are rejected before dispatch. There is no structured-decoding claim. The real sampled text, including malformed JSON, is returned unchanged except for removing one terminal `<|im_end|>` token. The existing controller decides whether its one bounded repair is appropriate.

SDK 0.27.1 serializes the **full** sampling contract as `max_tokens`, `seed: null`, `stop: [248046]`, `temperature: 1.0`, `top_k: -1`, and `top_p: 1.0`. An actual SDK test verifies these defaults without a service. Prepared journal records include the null seed; supplied seed overrides are not accepted.

`learner-journal.jsonl` is a separate private append-only hash chain. It preserves the original request, rendered prompt IDs, source pins, reservation, every original returned sequence's token IDs and available provider log-probabilities, plus the exact returned completion. Missing log-probabilities stay null; nonfinite provider values have a hexadecimal diagnostic. Records carry `origin: simulated_learner`, `training_eligible: false`, and `actor_training_eligible: false`. They are never passed through actor capture attestation or upgraded into actor training data. Raw token IDs remain available even when output overruns the requested limit or fails parsing. JSON syntax errors do not trigger an adapter rewrite or retry.

The journal is created exclusively. Restarting in an existing state cannot truncate it. The state is 0700 and journal/token files are 0600. Authorization headers, API keys and exception messages are not journaled or reflected in HTTP errors. Original input/output is private experiment data and may contain source text; it is not a public report.

## Deadline and retry scope

There is one application dispatch per reservation. `ServiceClient(max_retries=0)` and `RetryConfig(enable_retry_logic=False)` disable the corresponding public retry layers. **They do not disable every SDK retry.** The inspected SDK source still invokes holder retries, loops on sampling backpressure/billing responses, and polls asynchronous results. The sampled submission loop retains its request identity; this does not establish exactly-once billing or remote cancellation. The eight checked source files and their hashes are emitted by `audit`.

A deadline covers client creation and sampling. On timeout or any uncertain provider failure the bridge retains the reservation, marks `failed_unknown`, and rejects all further work. A late client creation cannot start a sample after that deadline. A sample already submitted may still be running remotely: the parent must terminate the process and reconcile provider state before granting more work. The adapter does not patch undocumented internals, automatically refund, reset its halt, or retry a generation.

## Verification

Run the focused suite with the pinned warm Python:

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH .keating/cache/uv/environments-v2/native-tinker-sampler-4adb9e6fa92dcd07/bin/python3 -m unittest discover -s scripts/training -p test_native_tinker_learner.py
```

23 tests passed locally. They cover absent funding, parent/child identity, cap and context rejection before paid boundaries, fixed model/tokenizer/renderer/pricing, raw malformed JSON, original arrays, missing probabilities, immutable journals, failed-call retry refusal, deadline behavior, loopback TLS/authentication, secret-free errors, real tokenizer/template equivalence and actual SDK sampling serialization. The TLS test uses an injected sampler; no hosted request or credential access occurred. A live instruction-model learner canary remains the parent's next verification step.
