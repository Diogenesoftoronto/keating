# Instruction actor baseline

`native_instruction_actor.py` serves **Qwen/Qwen3.5-9B** as a separately named,
evaluation-only strong-prompt condition through the production Pi OpenAI transport.
It preserves the runtime's supplied policy, messages and tool schemas and adds a
versioned tutor instruction at the end of the leading system messages. That
instruction asks for evidence-grounded teaching, the requested level of help, and
claims about capabilities or state only when supported by actual runtime receipts.

This is a model-and-prompt baseline, not an isolated estimate of the prompt's
effect. It does not change the Base actor, its initial/SFT/PPO checkpoints, the
observer, the learner adapter, or the production source prompt. Hold the scenario,
surface, learner, tool profile and resource limits fixed for comparisons; report
this condition separately. A completed adapter or plumbing test does not establish
teaching improvement.

## Reproducible local mechanics

The adapter reuses `native_tinker_learner.PinnedInstructionSampler` for the
instruction tokenizer, audited cookbook renderer and SDK sampling mechanics. It
does **not** inherit `LearnerBridge` or its journal format. It uses the existing
`native_conversation` converter for OpenAI tool history and the cookbook's
`parse_response` on original sampled token IDs.

| Component | Pin / behavior |
| --- | --- |
| Hosted catalog model | `Qwen/Qwen3.5-9B` |
| HF tokenizer revision | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` |
| Tokenizer files | Exact hashes in `native_tinker_learner.HF_HASHES` |
| Local renderer | `qwen3_5_disable_thinking`, audited source hashes |
| Libraries | Tinker 0.27.1, cookbook 0.5.7, Transformers 5.3.0 |
| Actual SDK sampling | temperature 1, top-p 1, top-k -1, **seed null**, stop `[248046]`, one sample |
| Condition | `qwen-instruction-strong-prompt/v2` |
| Strong prompt | `ACTOR_PROMPT`; SHA-256 stored in the config, journal and server manifest |
| Hosted weight revision | **Unattested**: the catalog API checks the model name, not immutable weight identity |

Version 2 adds short turns, one interactive question at a time, explicit support
for the current surface, and feedback tied to the submitted work. It prohibits
invented histories, diagnoses and mastery claims. Its prompt SHA-256 is
`1e38e155f04e2fe4f9a4f0f7ef5eff048f55a6effceb11fe333b49ad36c59e4c`.
Earlier v1 episodes retain their original condition and source pins.

Pinning the HF tokenizer does not attest the hosted model's weights. The cookbook
also applies its published whitespace and XML parameter serialization rules;
the original request, effective messages, effective tool schemas and exact rendered
prompt IDs are all retained so this transformation is reviewable.

## Funding contract

All files containing experiment data must be in ignored, non-symlink paths under
the repository's `.keating/` directory. State directories use mode 0700 and journals,
configs, TLS keys and ledgers use mode 0600. Each server uses a new state directory.

The actor consumes a **dedicated child allocation within the existing shared
USD100 cap**, not another USD100 budget. Before launch, the parent must have:

1. Reserved and completed an allocation grant in the shared ledger with project
   `keating-native-research-2026-09-13`, model `shared-runpod-and-tinker`, cap `100`.
   Completion here means the allocation is committed, not that an episode ran.
2. Created the child ledger with model `Qwen/Qwen3.5-9B`, its distinct project ID,
   and the allocated cap. The grant must cover that cap.
3. Set the child ledger's `parent_allocation` to the **absolute** parent ledger
   path and grant plan hash, then resealed `ledger_hash` using the existing ledger
   writer. Never reuse the learner's or Base actor's child ledger.

The config's allocation has these exact fields:

```json
{
  "id": "<completed-parent-grant-plan-hash>",
  "ledger_path": "/absolute/repo/.keating/native-learning/<new-actor-child>.json",
  "budget_project_id": "<distinct-actor-allocation-id>",
  "cap_usd": "<allocated-dollars>",
  "parent_ledger_path": "/absolute/repo/.keating/native-learning/research-budget-v1.json"
}
```

The child binding is `{"ledger_path": "<absolute-parent-path>", "plan_hash":
"<same-grant-hash>"}`. The grant's cap must not be reused to fund additional children
whose aggregate exceeds that grant: child allocation remains the parent's job.

Each request verifies the parent and child before constructing even the local
sampler. It renders locally, bounds prompt plus maximum completion, and reserves
the full conservative cost **before credentials, ServiceClient, sampling-client
creation or sampling**. Each remote phase is durably recorded first. The sampler
rechecks the funding and recorded phase immediately before dispatch. Pricing is
the same pinned September 13 model assumption as the instruction learner: USD0.66
input and USD1.995 output per million, with the local 5× safety factor and no cache
discount. These are planning assumptions, not invoices.

Default limits are 32,768 total context tokens, 2,048 output tokens, four provider
calls and 120 seconds per provider operation. Config validation caps the call
horizon at twelve, output at 4,096 and deadline at 300 seconds. Choose smaller
canary limits and cap the Pi harness independently. Completed requests still retain
their conservative reservations. A timeout, malformed completion or other uncertain
failure halts the bridge and retains the entire reservation. A new state directory
cannot bypass an unreconciled child ledger or its accumulated call horizon.

## Prepare and launch

These account-free commands use the pinned CPU environment already used by the
native sampler. `audit --download-tokenizer` permits only public pinned tokenizer
downloads; omit the flag to require cached files.

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_instruction_actor.py draft
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_instruction_actor.py audit
```

Save the draft privately, fill the already-funded allocation, then seal it. `plan`
renders an actual saved OpenAI request and reports its maximum reservation; it
neither funds nor dispatches that request.

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_instruction_actor.py seal-config --config .keating/native-learning/actor-draft.json --output .keating/native-learning/actor-config.json
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_instruction_actor.py plan --config .keating/native-learning/actor-config.json --request .keating/native-learning/actor-request.json
```

The following starts the funded loopback listener; valid requests to it can spend
from that child allocation. Account-default selection requires no conflicting
`TINKER_PROJECT_ID`. Credentials are loaded inside the funded client path from
`TINKER_API_KEY` or the existing Tinker Skate helper. Never list or print secrets.

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH -u TINKER_PROJECT_ID UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_instruction_actor.py serve --config .keating/native-learning/actor-config.json --state .keating/native-learning/new-actor-server --port 0
```

The emitted manifest contains `base_url`, `endpoint`, `model`, `token_file`,
`cert_file`, `raw_captures`/`raw_journal`, `config_hash` and the distinct condition.
Its `revision` is a **configuration identifier**, not a hosted weight revision.
Load the local bearer file into a private process environment variable and use its
name as the harness `apiKeyEnv`. Add the certificate to `NODE_EXTRA_CA_CERTS` (combine
it with the learner certificate when both bridges run). Do not disable TLS checks.

The corresponding existing harness transport is:

```typescript
{
  kind: "provider",
  provider: "native-instruction-actor",
  model: "Qwen/Qwen3.5-9B",
  endpoint: manifest.base_url,
  apiKeyEnv: "KEATING_INSTRUCTION_ACTOR_TOKEN",
  thinking: "off",
  modelMetadata: { contextWindow: 32768, maxTokens: 2048, reasoning: false }
}
```

Match model metadata and the harness output bound to the actual config. The
bridge accepts explicit `max_tokens` **or** `max_completion_tokens`, OpenAI text
messages/parts, tool schemas, completed tool history, optional `seed: null`, and
the exact sampling settings above. It supports `tools: []` and `tool_choice:
"none"` as explicit text-only conditions. It rejects forced/strict tool decoding,
non-null seeds, sampling overrides, images, JSON-mode requests and unresolved or
mismatched tool history before a provider call.

## Tool identity, delivery and failure evidence

The pinned Qwen XML format carries function names and parameters but normally no
OpenAI call ID. A parser-provided ID is preserved; otherwise the bridge assigns
one transport ID once and records its origin. That exact ID appears in the journal,
JSON/SSE response and subsequent runtime tool-result history. It is never described
as a sampled token or an execution receipt. Duplicate XML parameter names, malformed
calls, undeclared tools and duplicate call IDs halt the request without repair.
The runtime remains responsible for argument-schema validation, workspace access,
execution, UI delivery and persisted receipts; this bridge only proposes calls.

`stream: true` uses **buffered SSE**: one complete assistant delta, a finish chunk,
optional usage chunk and `[DONE]`. It preserves tool IDs and arguments and reports
actual prompt/completion token counts, including the sampled terminator. It does
not promise token-by-token streaming latency. A returned journal record means a
response was prepared; it does not establish that Pi received it or a tool ran.
A detected local delivery failure persists a halt for manual reconciliation.

The private hash-chained `actor-journal.jsonl` records original requests, effective
prompt inputs, prompt and completion IDs, provider log-probabilities when available,
SDK sampling settings, source audit, parse outcomes and failures. Every record has
`origin: "actor"`, `training_eligible: false`, `actor_training_eligible: false` and
`original_token_capture_eligible: false`. Missing log-probabilities remain unknown.
There is no generation/probability attestation for the training binder. Do not
reinterpret this catalog-model journal as a checkpointed training capture.

Application dispatch is single-attempt. SDK HTTP retries are configured to zero
and the outer sampling retry logic is disabled. The audited SDK still contains
holder retry, backpressure and billing loops: this is **not** an exactly-once
provider guarantee. A local deadline does not confirm remote cancellation. Preserve
the failed reservation and reconcile it before any subsequent allocation.

## Verification

```bash
rtk proxy env -u PYTHONHOME -u PYTHONPATH .keating/cache/uv/environments-v2/native-tinker-sampler-4adb9e6fa92dcd07/bin/python3 -m unittest discover -s scripts/training -p test_native_instruction_actor.py -v
```

Tests use authored responses, temporary private ledgers and injected clients. They
exercise funding-before-dispatch, strict requests, immutable pins, call/deadline
limits, failed raw captures, tool IDs, exact SDK defaults, actual local tokenizer/XML
parsing, loopback TLS/SSE and the **production Pi runtime executing a real local
`read`** and returning its receipt. The hosted sampling boundary is replaced by an
explicit fixture, so this is plumbing proof, not hosted role-fidelity or pedagogical
quality evidence. Tests retrieve no credentials and perform no paid calls.

Three [interactive model canaries](native-interactive-canaries.md) now have actual
provider responses and event ledgers. The first accepted two submissions; the
second exposed a timestamp bug now fixed locally; the third stopped on invalid
formats. Their timelines and reviews identify the next format and teaching fixes.
