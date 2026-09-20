# Native Qwen sampler and original-token capture

`scripts/training/native_tinker_sampler.py` serves one immutable Qwen actor checkpoint
through the existing local TLS/OpenAI handler. It does not create checkpoints, run
an optimizer, allocate research funds, or call a provider while drafting, inspecting,
or auditing. The parent owns `native_tinker_bootstrap.py` and supplies its actual
saved sampler URI. The observer remains a separate model role.

## Parent integration contract

Register the actual Pi endpoint with **provider `tinker`**, **model ID
`Qwen/Qwen3.5-9B-Base`**, and the bridge's `/v1` URL. Keep `public_model_id` equal to
that model ID. Captures copy the request model ID; they never relabel another actor.
The bridge accepts a caller-selected alias for other consumers, but the native
training consumer expects these exact names. An alias would require an explicit
consumer mapping and must not be substituted silently.

Generate a config draft without resolving the heavyweight environment:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_tinker_sampler.py draft \
  --output .keating/native-learning/qwen-sampler.draft.json
```

The following fields require actual parent-supplied values:

```json
{
  "project_selection": "account_default",
  "project_id": null,
  "public_model_id": "Qwen/Qwen3.5-9B-Base",
  "model": {
    "id": "Qwen/Qwen3.5-9B-Base",
    "hf_revision": "68c46c4b3498877f3ef123c856ecfde50c39f404",
    "sampler_checkpoint": null
  },
  "allocation": {
    "id": null,
    "ledger_path": null,
    "budget_project_id": null,
    "cap_usd": null
  }
}
```

This excerpt is not a complete runnable config. The draft command includes all
fixed tokenizer, renderer, SDK, sampling, limits, and pricing fields. Replace the
null checkpoint with the immutable `tinker://RUN/sampler_weights/NAME` returned by
bootstrap, and fill the separately funded allocation. The bridge rejects missing
checkpoint URIs and mutable `latest` / `current` names; it never falls back to
`create_sampling_client(base_model=...)`.

`project_selection: "account_default"` requires `project_id: null` and **omits** the
SDK's `project_id` argument. This deliberately selects the authenticated account's
Default project. `project_selection: "explicit"` requires the actual supplied
Tinker project ID. The ledger's `budget_project_id` is a **local accounting
identity**, never inferred to be a Tinker project ID. Both the selection and ID are
recorded in each capture. No API key is stored in config or capture.

Seal and inspect a filled config (both commands are offline):

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_tinker_sampler.py seal-config \
  --config .keating/native-learning/qwen-sampler.draft.json \
  --output .keating/native-learning/qwen-sampler.config.json
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_tinker_sampler.py inspect \
  --config .keating/native-learning/qwen-sampler.config.json
```

The `config_hash` uses `native_training.seal`. It binds the configuration; it does
not authenticate an operator or certify funding. The bridge takes an immutable
copy and rejects request-time sampling/model overrides.

## Allocation and paid boundaries

The parent creates a **dedicated sampling allocation** from the shared research
budget, separate from bootstrap, observer and update allocations. There is no
default cap. The bridge requires an existing sealed `BudgetLedger` with matching
local project identity, model and exact cap. It never initializes that ledger.
Parent accounting is responsible for ensuring the grants together fit the shared
$100; this module cannot infer grants made elsewhere.

Every accepted request follows this sequence:

1. Validate alias, text/tool history, identity sampling and explicit output limit.
2. Locally render/tokenize the actual request and enforce the context bound.
3. Reserve full prompt plus maximum output cost in the funded ledger.
4. Pass the ledger's `create_client` gate before the first `ServiceClient` /
   immutable sampling-client creation. Check the provider's reported base model
   against the requested Qwen model; persist `prepared` with its generation
   attestation before sampling.
5. Pass the `sample` gate; make exactly one application-level `sample` request.
6. Persist every original sampled sequence before parsing; persist parsed evidence.

The draft uses parent-verified September 13 pricing of **$0.66/M prefill** and
**$1.995/M output**, with a **5× factor**, rounded up to eight decimal USD places.
No cache discount or expected early stop reduces the reservation. The exact cost is
`5 × (prompt_tokens × 0.66 + max_output_tokens × 1.995) / 1,000,000`.
An optional explicitly supplied setup upper bound is charged on first connection.
The default setup amount is zero because this adapter only attaches to existing
weights; checkpoint creation/storage are the parent's separate allocation.
See the [official model pricing](https://tinker-docs.thinkingmachines.ai/tinker/models/).

`QwenCaptureBridge.cost_plan(response_id, request_sha256, prompt_count, settings)`
returns the sealed reservation without reserving or dispatching. It uses the full
actual rendered prompt count, not a characters-to-tokens estimate. `funded_ledger`
validates the supplied allocation. These are callable parent seams; `complete`
owns their order for live requests.

Failures retain the entire reservation. A timeout or parser error halts that bridge
instance; no automatic retry or refund occurs in this module. SDK 0.27.1 still has
internal transport/backpressure retry loops despite `max_retries=0` and
`RetryConfig(enable_retry_logic=False)`. Those loops retain the sampling request's
sequence ID. A timed-out request may still be running: reconcile provider state
before starting another process. The ledger is a conservative application guard,
not a provider-side billing limit.

## Pins and local audit

The isolated PEP-723 environment pins `tinker==0.27.1`, `tinker-cookbook==0.5.7`,
`transformers==5.3.0`, and CPU `torch==2.10.0`. Heavy imports are deferred. It does
not revive or change the shared training environment and does not download model
weights.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script \
  scripts/training/native_tinker_sampler.py audit --download-tokenizer \
  --output .keating/native-learning/qwen-sampler.audit.json
```

Audit is account-free and does not need fictional checkpoint or funding fields.
It checks installed distribution versions, audited SDK/renderer source hashes,
and the pinned public HF tokenizer files. `--download-tokenizer` permits only the
public pinned tokenizer fetch; omit it for cache-only operation. Ordinary serving
is cache-only. The HF revision is
`68c46c4b3498877f3ef123c856ecfde50c39f404`; its template hash is
`a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715`.

Rendering uses the inspected cookbook `qwen3_5_disable_thinking` implementation.
Its generation prefix closes the empty thinking block before sampling. The capture
records both the HF template hash and a digest of the cookbook rendering sources;
they are different artifacts. `native_conversation` preserves the actual system
prompt, schemas, history, tool-call IDs and result-name associations. The renderer
applies its published formatting/whitespace conventions. The capture retains the
original OpenAI request alongside the actual rendered prompt token IDs.

Audited SDK evidence:

- `types/_pydantic_types/sampling_params.py`: temperature 1, top-p 1, top-k −1
  means no configured scaling/nucleus/top-k restriction.
- `proto/response_conv.py:deserialize_sample_response`: copies the provider's
  int32 tokens and float32 logprobs directly, without rescoring or normalization.
- `types/sampled_sequence.py`: exposes those same arrays as lists.
- `lib/public_interfaces/sampling_client.py`: passes the supplied sampling params
  through the sample request; it does not retokenize the completion.

Only this audited identity-transform configuration is attested as
`verified_actual_sampler`. Raw-model versus post-sampling probabilities
coincide under these settings; no such equivalence is claimed at other settings.
No logit bias, penalty, steering, constrained tool decoding or forced tool selection
is accepted. Token logprobs still must be finite, nonpositive and aligned. This is
a source-backed interface interpretation, not an independent audit of the hosted
backend's weights or implementation. The pinned HF revision identifies the local
tokenizer/reference model; hosted actor identity is the immutable sampler URI plus
the provider's base-model report.

Sources: [SDK v0.27.1 package](https://pypi.org/project/tinker/0.27.1/),
[cookbook v0.5.7 package](https://pypi.org/project/tinker-cookbook/0.5.7/),
[pinned Qwen tokenizer config](https://huggingface.co/Qwen/Qwen3.5-9B-Base/blob/68c46c4b3498877f3ef123c856ecfde50c39f404/tokenizer_config.json),
[SamplingClient API](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/samplingclient/).
Exact audited file hashes are constants in the sampler and copied to capture.

## Raw capture and binding

`STATE/raw-captures.jsonl` is appended through `native_capture.append_capture` with
private file permissions and its existing record hash. State, configs, reports and
ledgers must resolve inside gitignored `.keating/`; escaping symlinks are rejected.
Private prompts/tool results belong only there.

| Phase | Additional evidence |
| --- | --- |
| All | Exact `response_id`, bridge-compatible `request_sha256`, actor/provider, model/tokenizer/renderer/SDK pins, config hash, project selection, allocation reservation, recorder/helper hashes and source audit |
| `prepared` | Original request, exact `prompt_token_ids`, full serialized `sampling_params`, one requested sample, no prompt logprobs; sealed `generation_attestation` |
| `sampled` | Unmodified `completion_token_ids`, `provider_logprobs`, sequence identity/count/index, stop reason; inline `probability_attestation` when values are valid; roles remain null before parsing |
| `parsed` | Actual OpenAI message/tool-call IDs, `parse_finished`, original `token_roles`, eligibility/rejection reasons, role-assignment policy; sealed `token_role_attestation` |
| `failed` | Error class and unavailable flag; no exception text that could disclose credentials or request data |

`provider_logprobs_hex` retains the exact float values, including a diagnostic
representation of nonfinite provider output that cannot be encoded as valid JSON
numbers. Missing logprobs stay null. No rescoring reconstructs them.

The three inline attestations follow
[the binder's generation-time contract](native-capture-binding.md). They use
`native_training.seal` and bind the exact prompt IDs, complete sampling parameters,
original completion IDs/probabilities and parsed message. The generation
attestation records the actor's real request identity, immutable sampler URI,
tokenizer and rendering pins after local verification and the provider's base-model
check. The parser revision binds both this recorder's content hash and the pinned
renderer sources. Probability evidence points to the versioned SDK and the full
hashed source audit in the same journal. Invalid/missing probabilities produce no
probability attestation. Unknown roles produce one null per original token in the
role attestation, never invented ownership. Test doubles default to
`kind: "authored_fixture"`, even if the other fields are fully populated.

The attestations are emitted at the original boundaries; there is no helper that
upgrades a historical raw journal. The binder validates them directly and still
requires the actual execution/receipt join. This first binder requires verified
probabilities even for an SFT capture; absent probabilities remain unavailable.

`parse_original_completion` consumes the **original** token list. Clean text-only
sequences get `assistant_text`; clean, homogeneous tool-call sequences get
`assistant_tool_call`. Whitespace and the actor's terminal `im_end` token retain
that action's role. Original token counts/positions never change. Tool-call IDs
are assigned for transport after parsing and are explicitly not sampled tokens.

Mixed text/tools, reasoning, unknown special tokens, normalization mismatches,
duplicate XML parameter names, incomplete stops and malformed calls remain
unavailable. Clean mixed responses may still be delivered to Pi, but their token
capture is not training-eligible. Parsing failures preserve sampled records and
return an error; no replacement answer or successful outcome is synthesized.

`original_token_capture_eligible: true` means this record has usable native token
evidence. **`training_eligible` remains false in every raw record**: the binder must
still establish the actual Pi request, response, delivered event, branch and causal
feedback. Do not turn an original-token capture into an assessment or fabricate
runtime receipts. A raw record is local recorder evidence, not an authenticated
provider signature.

## Parent-operated serving

Only after the parent supplies the saved checkpoint, funded allocation and key:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script \
  scripts/training/native_tinker_sampler.py serve \
  --config .keating/native-learning/qwen-sampler.config.json \
  --state .keating/native-learning/qwen-sampler-run
```

The CLI prints the loopback TLS URL, public model ID, bearer-token file,
certificate file and raw journal path, never the key or bearer value. It reuses
`serve_pilot.make_server` for authenticated requests and buffered SSE; `/v1/models`
advertises this config's actual alias and bounds without touching `MODELS`.
No inference is triggered merely by opening the server or listing models.
`TINKER_API_KEY` must already be in the operator's environment.

### Using this bridge as the baseline learner

`JsonChatLearner` in `scripts/training/native_simulator.ts` supports explicit
`json_mode: "prompt_only"`. This retains the same learner prompt and evidence but
omits `response_format` from the request. The default, or explicit
`json_mode: "response_format"`, still sends `{ "type": "json_object" }` for
compatible providers. The pinned Qwen bridge requires prompt-only mode because
constrained JSON decoding is outside its audited sampling configuration.

For the parent's first bounded model episode, set these fields on the existing
learner config, keeping its supplied TLS endpoint, key environment variable and
immutable checkpoint revision:

```json
{
  "model": "Qwen/Qwen3.5-9B-Base",
  "json_mode": "prompt_only",
  "temperature": 1,
  "max_tokens": 2048
}
```

Set the existing episode limit `max_decisions: 1` separately. Preserve the selected
source scenario and its initial evidence. The bridge records the actual generation
probabilities under its fixed temperature/top-p/top-k settings; the JSON mode does
not alter those settings or add tool constraints. Malformed JSON remains the exact
returned string for the controller's bounded invalid-output repair. Missing or
oversized text keeps its existing bounded diagnostic. No parser cleanup invents a
valid learner decision, and learner-generated tokens remain learner evidence, not
tutor-policy training targets.

## Verification

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --no-project --with typer \
  python -m unittest discover -s scripts/training -p test_native_tinker_sampler.py -v
```

Authored offline fixtures cover budget ordering/caps, absent grants, immutable
config and model pins, project-default omission, preserved history, raw-before-
parse ordering, missing/nonfinite logprobs, ambiguous roles, timeout retention,
alias agreement, hash drift and output containment. A localhost TLS round trip
uses mocked sampling and verifies auth, model listing, SSE IDs and usage. These
checks do not establish a paid actor run, checkpoint creation, pedagogical quality,
or a successful training export.

The local pinned-package audit also passed. Authored round trips through the real
HF tokenizer and cookbook parser passed for plain text, Unicode text and a pure
tool call (5, 11 and 25 original fixture tokens respectively). These were local
token fixtures; no sampler client or hosted inference was constructed.
