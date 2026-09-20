# Native hindsight signals

`native_hindsight.py` closes the feedback/prefix construction gap for the existing
`native_tinker_update` **SDPO** path. It reconstructs the original actor prompt
with the pinned Base renderer, appends actual retrospective evidence as a
teacher-only user message, and preserves the captured completion IDs verbatim.
It returns sealed signals only after the real `prepare_update` accepts them.

**Version 3 corrects a teacher-conditioning confound.** The completed SDPO v1
canary included the full delivered actor response inside teacher feedback.
That supplies a copying route before scoring those same target tokens. New
preparations use `native-hindsight-teacher-feedback/v1`: actual next learner
intent, delivery reference, reviewed verdicts and bounded citation references.
They do not render the delivered action, artifact text, unrestricted review
reasoning, source transcript history or private future into the added message.
This is a confound correction, not evidence of improved teaching or training.
Completed v1 inputs, result, checkpoints and report remain unchanged.

There is no separate scorer, trainer, budget, credential loader or hosted call.
Actor, capture, surface, learner-adapter and shared training modules are unchanged.

## Preparation contract

```python
import native_hindsight as nh

prepared = nh.prepare_signals(
    episodes,          # list of original native episode.json objects
    captures,          # native_training captures envelope
    reviews,           # native_training independent reviews envelope
    split_manifest,    # externally admitted, sealed for these exact exports
    update_config,     # EXISTING sealed updater config, method="sdpo"
)
nh.write_prepared(new_private_directory, prepared)
```

`prepare_signals` calls `native_training.build_exports`, renders selected
captures in config order, and calls `native_tinker_update.prepare_update` with
the full bundle, unchanged split manifest/config, and its sealed signals.
No export-hash rebinding or admission is invented. To obtain the export hash for
an independently reviewed split manifest, call `build_exports(episodes,
captures, reviews)` with these same inputs first. A different retrospective
review changes the export hash: obtain the corresponding admission manifest.
Do not relabel a delivered-only review as retrospective.

The returned mapping contains `exports`, `signals`, `prefix_proofs` and
`update_plan`. `signals` is the existing schema:

```text
{schema_version: 1, export_hash, signals: [
  {capture_hash, review, teacher_prefix: {
    prompt_token_ids, completion_token_ids, tokenizer,
    original_request_hash, feedback_hash,
    conditioning: "original_context_then_feedback_then_original_completion",
    teacher_feedback_projection: {kind, contract_hash, source_feedback_hash,
      next_learner_event, learner_delivery_evidence, review, projection_hash, ...},
    rendered_messages_hash,
    renderer: {id, revision}, prefix_hash
  }}
], signals_hash}
```

No new config is required. Use the existing updater config with these pins and
its ordinary bounded settings, rates, project selection and capture allowlist:

| Field | Required value |
| --- | --- |
| `method` | `sdpo` |
| `model.provider` | `tinker` |
| `model.id`, `tokenizer.id` | `Qwen/Qwen3.5-9B-Base` |
| `model.revision` | Parent's immutable `tinker://…/weights/…` initial checkpoint |
| `allowed_behavior_revisions` | Actual captured actor revisions |
| `tokenizer.revision` | `68c46c4b3498877f3ef123c856ecfde50c39f404` |
| `tokenizer.chat_template_hash` | `a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715` |

Re-seal an intentionally changed updater config with `nt.seal(config,
"config_hash")`. The instruction-tuned learner model is not the actor or teacher.
The observer remains separate.

## Exact prefix and event proof

The default renderer delegates to `native_tinker_sampler.PinnedQwenSampler` in
local-only mode. It audits the existing SDK/cookbook source and cached tokenizer
files, then uses `benchmark_tinker_bridge.native_conversation` through that
sampler's `prepare` method. No service or secret is needed for construction.
The environment is Tinker **0.27.1**, cookbook **0.5.7**, Transformers **5.3.0**.
The renderer is `qwen3_5_disable_thinking`, source revision
`41591874715ca998dea01f5d3e06ad7dcbce7f1c36e2d7d765905f63f40d266b`.

1. Validate the original episode/capture/review using shared contracts. Require
   generation-time behavior probabilities, original token roles, request binding
   and raw-journal provenance hashes. Missing fields fail closed.
2. Require one actor message at the reviewed action boundary and one delivered
   next learner event. Ambiguous multi-action boundaries fail closed.
3. Reconstruct the original provider payload's messages and tools. Rendering
   must reproduce **every original prompt token ID**. A mismatch is an error,
   never an invitation to retokenize the actor completion.
4. Build `nt.feedback_packet` from the retrospective feature and its independent
   review as **private provenance**. Project a teacher view from the same validated
   ledger and review; do not render the full packet.
5. Append the projected feedback after the original context and before the
   original completion. Save exact rendered teacher messages, tools, prefix IDs,
   projection policy/content hashes, source/audit hashes and separate causal masks.

## Teacher feedback projection

The projection resolves the one actual next learner intent using the validated
`learner_delivery_evidence` reference. Its sequence must follow the reviewed
delivery and precede the latest permitted receipt/step. Its observation hash
must identify that delivery. Only the intent itself is copied: message text,
or actual UI action ID and submission payload. Runtime step messages, tutor
continuations, receipts containing arbitrary payloads, previous observations,
artifact bodies and state are not serialized into this view. An intent over
16,384 UTF-8 JSON bytes fails before rendering; it is never truncated or repaired.

The independent review contributes its accepted/rejected decision, optional
bounded role-fidelity/status/purpose tags, and up to 24 named checks. Check names
are lowercase codes, at most 64 characters. Verdicts use the explicit vocabulary
in `PROJECTION_CONTRACT`; reasoning and arbitrary labels/notes remain private.
Missing tags are not filled with invented judgments. Contradictory top-level
and `scope` tags, unsupported verdicts and malformed checks fail closed.
The vocabulary is a versioned contract, not an automatic prose summarizer.

Each check may retain citations from its original independently sealed review:

```json
{"verdict":"pass","citations":[
  {"event_id":"actual-event-id","event_hash":"actual-event-hash",
   "quote":"short exact evidence span"}
]}
```

Each quote must resolve uniquely inside an allowed public text field of an
event available at the review boundary. Ambiguous repeats require explicit
`field_path`, `start` and `end` (Python character offsets, end exclusive).
Allowed sources are the feature's initial/learner/delivered observations and
the captured actor message's text blocks. Tool arguments/results, raw runtime
steps, private state, other branches and later events are not citation sources,
even when their hashes or strings are known. Artifact citations can reference
delivered heading/body text. Individual spans are at most 160 characters, with
16 citations and 1,024 cited characters total across the projection.

**The teacher receives offsets and SHA-256 references, not the quoted text.**
It receives the check name/verdict but cannot recover a quoted action from its
reference. The original quotes and full reasoning remain in the private review.
Checks without citations retain their verdict with an empty citation list;
the preparer does not invent support or turn a verdict into a checked learning
outcome. Review labels are trusted independent judgments under the existing
contract; hashes do not establish their semantic validity.

There is no global string-overlap prohibition. A learner can legitimately repeat
`5`, or even repeat an entire earlier response. That actual consequence remains
intact with its source and role-fidelity finding. Such repetition remains a
possible copying confound. The correction removes the automatic delivery-text
copying route; it does not establish an exposure-free ablation. Original actor
context is reproduced exactly, including history already present at generation.

`PROJECTION_CONTRACT` pins the field policy, limits, verdict/tag vocabulary and
feedback introduction hash. Its hash and version are in the sealed projection;
`projection_hash` binds that content to full source-feedback/review/feature and
capture hashes and the latest event/hash. The sealed teacher prefix carries the
projection and exact rendered-messages hash. The proof additionally stores the
contract, original reconstructed prefix IDs, original completion hash and masks.
Changing the policy or content changes these hashes and the update plan identity.

The existing updater accepts this extra renderer metadata and sends only
`ModelInput.from_ints(prefix + original_targets)` to `compute_logprobs`.
Its `feedback_hash` still binds the **full source packet**, which remains in
the local plan/scoring journal; it is not a claim that every provenance field
was rendered. `teacher_feedback_projection.projection_hash` binds the actual
added view. The updater validates source feedback and target identity, but does
not independently rerender or validate this projection policy. Use the sealed
preparation and its exact renderer proof; do not manufacture prefix arrays.
No change to `native_training` or `native_tinker_update` is required.

For student prefix `P`, teacher prefix `Q`, and original completion `Y`, the
student uses `(P+Y)[:-1]`, `(P+Y)[1:]` and mask `0*(len(P)-1)+1*len(Y)`.
The teacher proof has the corresponding `Q` arrays. Selecting masked target
positions in either yields exactly `Y`; only actor targets are eligible. The
teacher scores will later be sliced at `len(Q)` from `compute_logprobs(Q+Y)`.
This module bounds `len(Q)+len(Y)+1 <= 32768` because SDK 0.27.1 internally
requests one extra sample token for prompt log probabilities.

The prefix proof leaves `teacher_snapshot` and `teacher_scores` null. The existing
updater freezes the initial trainer before its update, pins the returned sampler
snapshot and records actual teacher log probabilities. It checks alignment,
current-student scores and exact forward/backward agreement, computes detached
advantages with `prepare_advantages`, then uses its existing PPO path.

The HF revision proves local tokenizer material only. It does **not** attest
hosted model weight contents. Source/journal hashes bind supplied records but
are not signatures or independent authentication. The injected renderer is a
trusted offline test seam, not a hosted-evidence validator.

## Acceptance and interpretation

`prepare_hindsight(episode, capture, review, update_config, renderer=...)` exposes
one diagnostic prefix proof, including for a rejected actor action. Such a proof
is not a training export. `prepare_signals` requires the existing accepted SFT
projection used by SDPO and retains all independent-review, family admission,
original-behavior and temporal-boundary guards. Rejected actions remain available
for diagnosis and the shared explicit negative-PPO route where applicable;
this module does not promote them to SFT or SDPO.

A successfully delivered learner reply can still violate the learner role.
Preserve a finding such as `learner_role_fidelity=failed` and
`status=requires_audit` in the independently supplied review feedback. It is
retained in the projected tags and full private review, never repaired or
recast as a learning gain. Free-form scope/qualification text stays in private
provenance; downstream consumers must retain and enforce those restrictions.
`outcome` stays null and `outcome_status` stays `unknown`. Accepted tutor-action
review and faithful simulated learner behavior are separate judgments.

## Parent commands and execution boundary

Preparation only, from the repository root with the pinned environment already
available (replace the paths with the parent's reviewed inputs):

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --script scripts/training/native_hindsight.py signals \
  --episode .keating/native-learning/RUN/episode.json \
  --captures .keating/native-learning/RUN/captures.json \
  --reviews .keating/native-learning/RUN/retrospective-reviews.json \
  --splits .keating/native-learning/RUN/splits.json \
  --config .keating/native-learning/RUN/sdpo-config.json \
  --output .keating/native-learning/RUN/hindsight-prepared
```

Repeat `--episode` for multiple episodes. PEP-723 may resolve public dependencies;
tokenizer loading uses only the already verified cache. An absent cache fails.
The parent can instead invoke its existing sampler environment's Python directly.

Output is a new ignored directory with mode 0700 and exclusive 0600 entries:
`exports.json`, `signals.json`, `prefix-proofs.json`, `update-plan.json`, then
`prepared.json` containing their file hashes. Existing files/directories and
symlink output paths are rejected. A missing final manifest means an incomplete
write; never auto-resume it. This prevents accidental overwrite, not owner-level
filesystem tampering or deletion. Keep all trace material private.

After reviewing the complete preparation, the **parent** uses the existing funded
updater entry point, not a new hindsight scoring command:

```python
# Parent integration, potentially paid; NOT executed by this module.
result = native_tinker_update.execute_update(
    prepared["exports"], split_manifest, update_config, prepared["signals"],
    budget_path=existing_funded_child_ledger,
    cap_usd=approved_child_cap,
    output_dir=new_update_directory,
)
```

The parent must keep that child allocation within the pre-existing shared funded
ledger. The existing updater owns reserve-before-dispatch, snapshot/scoring
journals, unknown-outcome handling, SDK retry audit and optimizer execution.
Preparation performs no reservation and confers no spend authority. Do not treat
an SDK timeout as remote cancellation, or an HF tokenizer pin as hosted-weight
proof. `compute_logprobs` exposes scores, not provider receipt IDs; the updater
records local operation IDs with provider IDs null.

For **S**, this completes the signal construction needed by existing SDPO; the
parent still runs and reviews the bounded actual update. **F** uses independently
validated feature advantages through the existing PPO signal contract. **F+S**
needs a separately specified combination/normalization and evaluation; no combined
loss or fabricated feature score is introduced here.

## Verification

Run the focused offline tests in the existing environment:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH \
  .keating/cache/uv/environments-v2/native-tinker-sampler-4adb9e6fa92dcd07/bin/python3 \
  -m unittest discover -s scripts/training -p test_native_hindsight.py
```

All 32 focused offline tests passed. They inject an explicitly authored renderer
and exercise real export, review, split and updater planning contracts, exact
targets/masks, unknown learning, provenance rejection and exclusive writes.
Projection contrasts check that full actor text and unrestricted review prose
remain outside the teacher message while actual next learner content survives,
including a short answer identical to the actor's. They cover UI submissions,
exact cited spans, private and future-event rejection, bounds, contradictory
tags and the unmodified updater's acceptance of the new metadata.

A read-only in-memory check using the actual pinned renderer and existing
chat-canary-v3 inputs reproduced all **1,823 original prompt IDs** and **196
original completion IDs**. The new teacher prefix has **4,044 tokens**, five
reviewed check verdicts and six citation references; the full delivered actor
response is absent from its feedback message. The projection retains
`learner_role_fidelity=failed`, `status=requires_audit` and unknown learning.
The local check blocked service creation, networking, reservation and execution,
wrote no new preparation journal, and verified all 34 completed v1 files and
four shared runtime modules unchanged. Projection contract hash:
`0912a4c75f99aef1123cf5708df1b2e8f7380ce4f60a6f251bb5e2abf9bcae58`.

The parent previously executed the v1 SDPO plan once: optimizer acknowledged,
result `b1ff1996fc35b2d7e57c0ceb5d099f82b2a568b7ecbc820fa91b21747d7197b8`.
The private report verifies exact target identity and recorded advantages, while
flagging full-response exposure, failed learner-role fidelity, unknown learning
and raw provider metric scope mismatch. It is a mechanics canary only, with no
qualifying warm start, efficacy or promotion claim. New projection code does not
rewrite that run or authorize its repetition. No new provider call, reservation,
score or update is part of this correction.
