# Bind native generation evidence to an executed episode

`scripts/training/native_capture_binding.py` is a local, read-only binder between
the native bridge journal and `native_training` capture/export contracts. It makes
no provider calls, imports no model SDK or tokenizer, and never changes a budget.
The parent owns the shared $100 research allocation and any separately granted
Tinker allowance. This module creates no additional per-provider allowance.

The binder maps a journal response to an exact provider request, terminal Pi
message, actor ledger event, and successful delivery. It requires generation-time
model/tokenizer/renderer provenance, original parser-owned token roles, and verified
actual-sampler probability evidence before creating a capture. The existing journal
without those attestations produces explicit unavailable status, not invented
token roles or renamed probabilities.

## API and CLI

```python
from native_capture_binding import bind_captures, load_journal, summarize
from native_training import build_exports, load_json

episodes = [load_json(episode_path)]
bound = bind_captures(episodes, load_journal(journal_path))
summary = summarize(bound)
exports = build_exports(episodes, bound["captures"], reviews=review_envelope)
```

`bound["captures"]` is a compatible version-1 envelope containing `captures` and
an empty `teacher_captures` array. `bound["bindings"]` preserves all exact binding
references and availability reasons. The complete result has a `binding_hash`.
The Python inputs are copied and remain unchanged. No independent acceptance
review is inferred from a valid capture or successful runtime receipt.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python scripts/training/native_capture_binding.py inspect \
  --episode episode.json --journal raw-captures.jsonl

rtk proxy env -u PYTHONHOME -u PYTHONPATH python scripts/training/native_capture_binding.py export \
  --episode episode.json --journal raw-captures.jsonl \
  --reviews independent-reviews.json --output .keating/native-learning/bound-capture
```

`--episode` and `--journal` can repeat. Scope the supplied journals and episodes to
the same response set; extra or missing responses are rejected rather than silently
ignored. Journals may interleave independent responses, but each response must have
one prepared, sampled, and parsed record in that order. A parser failure that has
no parsed record cannot produce a binding. Preserve that raw diagnostic journal
and use a separate complete selection for export.

`inspect` validates the prospective export and prints counts, reason codes, and
hashes. `export` writes `bindings.json`, `captures.json`, and `exports.json` in a new
private directory. Files use `0600`; the directory uses `0700`. Existing output
paths are rejected. Raw journals and runtime files are never rewritten. Output
contains original training evidence and belongs under ignored private storage.

## Exact runtime join

The binder first calls the existing `native_training.validate_episode`. It checks
that runtime sources were unchanged during execution and that `runtime.requests`
equals the ordered `provider_request` projection of `runtime.receipts`.

For each response:

1. Match the journal `response_id` to exactly one `provider_response.data.response_id`
   and one fresh assistant `responseId` in a runtime step. The same ID cannot identify
   two episodes or branches. Repeated historical messages are excluded using the
   producer’s `message_start_index` and actual actor events.
2. Resolve `provider_response.data.index` to a unique provider request. Preserve both
   that provider call index and its array position in `runtime.requests`; they need
   not be the same number. The response receipt must follow that request receipt.
3. Verify the bridge’s sorted-Python `request_sha256` against the original HTTP body
   and the actual recorded `provider_request.data.payload`. Verify their native
   hashes too. The full `context.messages` must equal the original message prefix
   before this exact actor message, including tool history.
4. Verify `provider_response.data.message_sha256` against the complete Pi message,
   including `responseId`, and match its actor ledger event. The recorded response
   stop reason and runtime provider/model identities must agree.
5. Compare the bridge’s parsed OpenAI message with Pi’s delivered message: exact text
   bytes, function names, call IDs, and parsed JSON argument objects. This supports
   text and function calls, without text similarity or token reconstruction. Pi
   metadata remains pinned by the full message hash. Other content modalities stay
   unavailable in this first binder.
6. Require the successful `delivered_observation` for the actor step before exporting
   tokens. A failed follow-up can still have a bound original response and state
   evidence; without that delivery, its capture stays unavailable. Retrospective
   outcome remains `null`/`unknown`.

The binder preserves source hashes and the full runtime hash. Changes such as the
parent’s inventoried system-prompt hashes remain part of that recorded evidence;
there is no replacement prompt or separately invented execution context here.

## Raw journal compatibility and hash conventions

The existing `native_capture.append_capture` and bridge record format stays intact:

```text
Common: schema_version, captured_at, response_id, request_sha256, base_model,
        renderer, recorder_sha256, capture_helper_sha256,
        training_eligible: false, phase, record_sha256
prepared: original_request, prompt_token_ids, sampling_params, num_samples: 1,
          include_prompt_logprobs: false, topk_prompt_logprobs: 0
sampled: completion_token_ids, provider_logprobs, stop_reason,
         probability_semantics, token_roles
parsed: message, parse_finished
```

Keep the entire SDK `SamplingParams.model_dump(mode="json")`, including defaults.
At minimum the binder requires `max_tokens`, `temperature`, `top_p`, `top_k`,
`seed`, and `stop`; extra settings are preserved and hashed. Explicit request
settings must agree with the sampled settings, and the original completion cannot
exceed the requested token limit. There is no hidden truncation or token filtering.
When sequence cardinality metadata is present, it must identify sequence zero of
exactly one sample. A length stop or the generating adapter's explicit unavailable
decision prevents capture export even when the other attestations are complete.

The current `native_tinker_sampler.py` emits all three inline attestations below:
`generation_attestation` before sampling, `probability_attestation` with finite,
aligned provider probabilities, and parser-owned `token_role_attestation` after
parsing the original sequence. Its probability claim uses `verified_actual_sampler`
under the pinned identity sampling configuration and records the SDK/source audit.
The binder consumes those records directly, while retaining the exact runtime
identity, delivery, and alignment gates. Missing probabilities or unsupported token
roles still produce unavailable status.

Older journals carrying only `pins`, `source_audit`, or
`provider_raw_identity_sampling` do not acquire the new attestations retroactively.
Preserve those raw records. The source audit's stated scope remains identity
transforms, not independent backend weight verification; the binder validates the
producer's recorded assertions and hashes rather than measuring the hosted weights.

Three hash encodings coexist intentionally:

| Object | Producer convention | Binder helper |
| --- | --- | --- |
| Journal record, excluding `record_sha256` | Insertion-ordered Python JSON, compact, UTF-8 | `journal_hash` |
| Original bridge HTTP request | Sorted-key Python JSON, compact, UTF-8 | `bridge_hash` |
| Runtime, attestations, captures | Existing JS-compatible `native_training.native_hash` | `native_hash`, `seal` |

Floating-point formatting differs between Python JSON and JS JSON.stringify.
Never replace one convention with another. Journal reads reject duplicate JSON
keys and non-finite JSON numbers. The binder checks record hashes before using
their contents and checks semantics even when a test attacker recalculates hashes.

## Generation-time attestation schema for the pinned adapter

These are **inline extensions to newly emitted journal records**, not an offline
annotation file that can upgrade old journals. Existing records remain unchanged.
Use `native_training.seal` for each attestation, then let the normal raw journal
writer include it in that phase’s `record_sha256`.

### Prepared record: `generation_attestation`

Create and durably persist this before the original sample call, using the actual
rendered prompt and full sampling parameters:

```python
generation = seal({
    "schema_version": 1,
    "kind": "provider_capture",  # authored_fixture for every invented test vector
    "response_id": bridge_response_id,
    "request_sha256": bridge_request_sha256,
    "recorded_before_sample": True,
    "actor": {
        "provider": actual_runtime_provider,
        "id": actual_runtime_model_id,
        "revision": pinned_behavior_revision,
    },
    "native_model": {"id": actual_native_base_model, "revision": pinned_behavior_revision},
    "tokenizer": {
        "id": tokenizer_id,
        "revision": tokenizer_commit,
        "chat_template_hash": template_sha256,
    },
    "renderer": {
        "id": raw_renderer_id,
        "revision": renderer_commit,
        "parser_revision": parser_commit,
        "source_sha256": renderer_source_sha256,
    },
    "prompt_token_ids_hash": native_hash(original_prompt_ids),
    "sampling_params_hash": native_hash(full_sampling_params),
}, "generation_hash")

prepared_record["generation_attestation"] = generation
```

Revisions must be explicit 40/64-character lowercase commit/content hashes or a
Tinker sampler checkpoint URI. Mutable labels such as `main`, `latest`, or a base
model name alone are rejected. The actor revision and native-model revision must
agree; the native-model ID and renderer ID must agree with the raw journal header.
Hosted run identifiers can include colon-separated components such as
`tinker://run-id:train:0/sampler_weights/frozen-001`. These are opaque run IDs,
not HTTP hostnames. Empty components, extra path segments, and mutable checkpoint
names remain invalid.
The tokenizer and renderer pins describe what actually executed, not what a later
environment happens to have installed.

The actor provider/model must match the original runtime request and assistant
message. A custom bridge alias remains that alias; it is never renamed into a
native Qwen model to satisfy a downstream training check. For the current
`native_tinker_update` consumer, register and execute the desired `tinker` provider
and exact `Qwen/Qwen3.5-9B-Base` identity at the runtime boundary, or explicitly
resolve that downstream compatibility boundary in a separately authorized change.

### Sampled record: `probability_attestation`

Retain original tokens and provider-reported probabilities before parsing. Only
after establishing the provider’s semantics for this exact sampling configuration
may the new adapter emit:

```python
sampled_record["probability_semantics"] = "verified_actual_sampler"
sampled_record["probability_attestation"] = seal({
    "schema_version": 1,
    "recorded_at_sampling": True,
    "semantics": "actual_sampler",
    "generation_hash": generation["generation_hash"],
    "completion_token_ids_hash": native_hash(original_completion_ids),
    "logprobs_hash": native_hash(original_provider_logprobs),
    "sampling_params_hash": native_hash(full_sampling_params),
    "all_generation_transforms_recorded": True,
    "evidence": {
        "source": probability_semantics_evidence_source,
        "revision": evidence_revision,
        "sha256": evidence_content_sha256,
    },
}, "probability_hash")
```

This is an attestation by the generating adapter/operator, not a mathematical
deduction made by the binder. The evidence must establish that these values are
likelihoods under the actual sampler, including applicable transforms. Temperature
1, top-p 1, or top-k -1 alone is not accepted as that evidence. Do not change the
current raw `provider_reported_not_yet_verified_as_actual_sampler` label on an old
record. The binder rejects contradictory claims and leaves absent semantics
unavailable. Null logprobs remain unavailable even if an attestation is supplied.

The binder never rescales, fills, or recomputes probabilities. An available capture
copies the original values into the validated export’s `behavior_logprobs` only
after these gates pass. This first binder also requires verified probabilities for
SFT capture production; it does not manufacture a weaker capture when only token
IDs exist. Greedy temperature-zero sampling remains unavailable under the current
native exporter’s positive-temperature contract.

### Parsed record: `token_role_attestation`

The parser must account for the complete original sequence before any token loss,
text stripping, or reconstructed tokenization. Store the ownership result beside
the actual parsed OpenAI message:

```python
parsed_record["token_role_attestation"] = seal({
    "schema_version": 1,
    "source": "original_completion_token_spans",
    "recorded_at_parse": True,
    "generation_hash": generation["generation_hash"],
    "completion_token_ids_hash": native_hash(original_completion_ids),
    "parsed_message_hash": native_hash(actual_parsed_openai_message),
    "parser_revision": generation["renderer"]["parser_revision"],
    "roles": original_roles_in_token_order,
}, "roles_hash")
```

`roles` must have exactly one entry per original completion token. Supported
entries are `assistant_text` and `assistant_tool_call`. Use `null` for an original
token whose ownership cannot be established; that makes the whole segment
unavailable. No completion token is dropped or reconstructed. Tool-result and
learner tokens are rejected as actor targets. A tool-call role also requires an
actual parsed/runtime tool call under the existing exporter validation.

The sampled record can retain `token_roles: null` because parsing happens later.
A new, inline parse-time attestation can establish ownership of that same original
sequence. Without it, null roles remain unavailable. If sampled roles are already
present, they must agree exactly with the parser attestation. Offline labels or
retokenized strings cannot override either record.
If the parsed record also has a `token_roles` array, that array must agree too.

## Trust and availability boundaries

Hashes ensure consistency and identify the evidence; they are not signatures or
proof that a dishonest operator recorded an attestation at the claimed time.
The caller must trust the journal producer and pinned parser. This binder neither
authenticates arbitrary supplied files nor independently derives tokenizer
semantics from integer arrays. The inline phase contract ensures that normal
operation records the relevant facts at the point where they are available.

Missing, duplicate, reordered, or ambiguous occurrences raise `BindingError` and
make the CLI exit with code 2. Tampered hashes, differing request contexts,
rewritten aliases, conflicting tool IDs, and token/probability misalignment also
reject. Validly bound records without usable attestations produce status
`unavailable`, with reasons such as:

- `missing_generation_attestation`
- `original_parser_token_roles_unavailable`
- `actual_sampler_semantics_unverified`
- `missing_original_behavior_logprobs`
- `unsupported_or_incomplete_parser_output`
- `actor_action_not_delivered`
- `completion_did_not_stop_cleanly`
- `generating_adapter_marked_capture_unavailable`

Authored fixtures keep `kind: "authored_fixture"` and status `fixture_only`, even
with complete arrays and reviews. They cannot claim provider origin when the
runtime measurement is `offline_integration`. A successful provider binding means
the capture contract is available, not that training is approved or the learner
improved. Independent review, family/split admission, and the parent’s shared
budget grant remain separate gates. Every binding’s outcome remains unknown.

The source capture keeps the actual bridge correlation ID in `request_id` and
`response_id`, with `id_namespace: "bridge"`. It does not invent a Tinker SDK
request ID. Renderer/native-model provenance, all attestation hashes, and the
three raw-record hashes remain attached in capture source metadata.

## Verification

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --no-project --with typer --with httpx python -m unittest discover \
  -s scripts/training -p test_native_capture_binding.py
```

Tests exercise the real journal writer and native exporter using authored fixtures;
original-token equality and causal masks; differing call/array indices; exact
payload/context/response joins; tampering and duplicate phases; cross-branch IDs;
unknown roles/probabilities; false origin/retokenization claims; parsed tool-ID and
argument mismatches; sequence cardinality, sampling limits and clean stops;
failed follow-up delivery; private CLI exports and raw-file
preservation. No live model call, tokenizer reconstruction, or budget operation is
performed against the research allocation.

The interoperability tests additionally execute `QwenCaptureBridge.complete`, the
normal journal writer, and `parse_original_completion` with authored provider,
tokenizer, and renderer doubles. They bind the untouched emitted prepared/sample/
parsed records to an authored native ledger, covering a tool-only action, a text
action, actual mock response/tool IDs, repeated context, and a `:train:0` checkpoint.
The emitted fixture captures pass native export validation and preserve causal
completion masks. Missing provider probabilities remain unavailable through the
same path. Temporary authored ledgers under `.keating/tmp` check reservation order;
the real research ledger is never opened. The test requires `typer` and `httpx`
because the bridge imports its existing request validators; it needs no Tinker SDK,
model download, hosted request, or runtime inventory change.

This check caught one binder interoperability gap: its previous checkpoint parser
rejected the hosted colon-bearing run ID. The binder now accepts the producer's
opaque run-ID format. Passing authored tests establishes this local contract path,
not a successful live capture or independently verified probability semantics.
