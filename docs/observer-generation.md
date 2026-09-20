# Controlled observer generation sidecar

`scripts/training/observer_generation.py` is a local, pure PyTorch generation
kernel for a **supplied causal model, post-block module and admitted token
batch**. It emits actual autoregressive token IDs. It does not load checkpoints,
tokenize text, infer feature semantics, score behavior, write artifacts, or own
a cloud job. Importing it does not import Torch.

The existing `observer_core.py` and `observer_experiment.py` are unchanged.
`core.intervene` supplies the post-block patch. The experiment's
`forward_intervention` remains a forward-only measurement, not generation.
Likewise, `observer_extract.load_observer` uses `AutoModel`, which omits the
vocabulary projection and may report the unused LM head among checkpoint keys.
Its hidden states cannot be treated as token logits.

## Local API

```python
import observer_core as core
from observer_generation import GenerationConfig, generation_preflight, generate_controls

# All of these are supplied locally by the admitted experiment:
# model, block, batch, state, selected_feature, reviewed_unrelated_feature,
# unrelated_review_ref, selected_token_calibration_residuals, logits_adapter.
core.validate_sae(state)
scale = core.residual_scale(selected_token_calibration_residuals)

config = GenerationConfig(
    max_new_tokens=32,
    max_context_tokens=1024,
    max_forward_passes=160,       # Aggregate across the five conditions.
    max_forward_tokens=200_000,  # Example ceiling, not a budget authorization.
    pad_token_id=pad_id,
    eos_token_id=eos_id,          # None disables EOS stopping.
    seed=17,
    overflow="reject",
)
flight = generation_preflight(batch, config, conditions=5)
result = generate_controls(
    model, block, batch, config=config,
    selected_direction=state["W_dec"][:, selected_feature],
    unrelated_direction=state["W_dec"][:, reviewed_unrelated_feature],
    unrelated_review=unrelated_review_ref,
    epsilon=0.02, scale=scale, random_seed=19,
    forward=logits_adapter,
)
```

Add `scripts/training` to the importing process's module search path, or run
the local adapter from that directory. There is no dynamic module-path CLI,
Hugging Face loading fallback, or provider entry point in this sidecar.

`batch` must contain **exactly** `input_ids` (nonnegative int64 `[B,T]`) and
`attention_mask` (binary bool/int32/int64 of the same shape and device).
Labels, raw/future text, supplied position IDs, caches and arbitrary extra
fields are rejected. This structural check cannot detect future text that a
caller already encoded into IDs: upstream source and temporal admission are
still required.

Each mask row must have one nonempty contiguous attended span. Left, right,
and both-sided padding are accepted; internal holes and empty rows are rejected.
Padding is stripped for logical accounting, then prefixes are **left-padded**
to a common width on each forward. Real tokens therefore end at the last column.
Position IDs are `max(cumsum(attention_mask)-1, 0)`, so real positions start at
zero independently for each row. IDs and masks supplied by the caller are not
mutated. Attention masks, not equality to the pad ID, determine real tokens.

The default rejects any prompt whose real length plus `max_new_tokens` exceeds
`max_context_tokens`. Local callers may explicitly select `truncate_left`:
only the oldest prompt tokens are dropped, with every removed ID retained in
the result. All requested generation space is reserved before any forward;
no rolling window or mid-generation truncation occurs. **The existing sealed
job requires untruncated prompts; integration must keep `overflow="reject"`.**

## Causal model / logits adapter contract

The optional local callable has this exact invocation contract:

```python
logits = forward(
    model,
    input_ids=input_ids,
    attention_mask=attention_mask,
    position_ids=position_ids,
    use_cache=False,
)
```

It must run the supplied model's chosen block exactly once, preserving its
floating residual shape `[B,T,H]`. Both tensor block output and tuple output
with the residual first are supported; tuple tails survive intervention.
The block must belong to `model.modules()`. All associated neural modules,
including a separate head if used, should be registered under the supplied
model so their training flags are covered.

The callback must return finite floating causal next-token scores in either
of these forms:

| Shape | Meaning |
| --- | --- |
| `[B,V]` | One vocabulary distribution per row at its current prediction frontier |
| `[B,T,V]` | Full vocabulary distributions; the helper gathers each row's last attended position |

For `[B,V]`, rows are used directly; there is no expansion or fake broadcast
over token positions. For `[B,T,V]`, batch and token dimensions must match the
current full prefix. Wrong rank, singleton batch broadcasting, empty vocabulary,
integer scores, non-finite frontier scores, or out-of-vocabulary prompt/pad/EOS
IDs fail. The helper can validate tensor structure, but the caller must establish
that scores are vocabulary logits from the verified model rather than hidden
features that happen to have a compatible shape.

Without a callback, the model receives the same keyword arguments and may
return tensor logits, `{"logits": tensor}`, or an object with `.logits`. A
hidden-state-only result is rejected. A tuple **model result** or architecture
requiring different arguments needs an explicit adapter; tuple **block output**
is supported directly.

For the intended efficient adapter, run the verified backbone through its
normal final normalization, then project **only**
`last_hidden_state[:, -1, :]` using the verified same-checkpoint `lm_head.weight`
and the checkpoint's actual head semantics. Return the resulting `[B,V]`.
This avoids materializing `[B,T,248320]` for the reference model. Do not project
the L12 residual directly: all downstream blocks and final normalization must
still execute. Do not create a randomly initialized head or silently accept
missing/mismatched weights. This document specifies the seam; it does not
implement or establish fidelity of that checkpoint wrapper.

The callback must be stateless between calls and use only the supplied causal
prefix inputs. `use_cache=False` is passed on every call; no past-key-values,
generation API, retained recurrent state or model-specific cache is managed
here. The parent must verify that its concrete architecture adapter actually
honors this contract.

## Intervention timing and paired controls

At step zero, patch the post-block residual at the **last unpadded prompt
position** before computing next-token logits. Append the emitted ID to that
row's real prefix. At step one, patch the just-emitted token's post-block
residual before predicting the next ID; repeat up to the bound. Every earlier
history position is recomputed normally, with no retained residual patch.
This is a last-decision-position intervention, not a persistent edit to history.

Only active rows receive a patch. EOS is included exactly once in generated
IDs and stops that row; stopped rows remain in subsequent batched forwards
but receive no patch or appended padding/EOS emissions. The loop stops when
all rows emit EOS or after `max_new_tokens`. EOS already present in the prompt
is ordinary prompt context. There is no sampling or beam search: argmax uses
Torch's first-index tie behavior. The same forward seed is reset for each
condition.

The fixed order is `baseline`, `selected_positive`, `selected_negative`,
`random`, `unrelated`. Nonzero patches use
`epsilon * scale * unit_direction` with a nonnegative suite epsilon. Positive
and negative directions are exact opposites. The random direction uses its
own seeded CPU generator. The unrelated direction must be separately supplied
with a nonempty reviewed-declaration reference and cannot duplicate either
selected direction. This prevents accidental reuse, but does not prove semantic
unrelatedness. Review references never enter model inputs. Vectors are
normalized in float32; finite-precision application uses the residual dtype.
Small amplitudes may round away; effective checkpoint effects need measurement.

Scale is supplied by the caller and fixed across conditions. For integration,
derive it from **actual selected-token residual vectors on calibration
families**, using `core.residual_scale` (median vector L2 norm). A pooled raw
mean is not an acceptable substitute. The helper does not select families or
estimate a new scale on the prompt being evaluated. A probe coefficient alone
does not establish a feature's meaning or a useful intervention sign.

`generate(...)` also exposes one condition directly, including signed epsilon.
Baseline and epsilon zero install no additive hook, preserving exact baseline
hidden values and emitted IDs under the same forward seed.

## Bounds, state restoration and records

For `C` conditions, `B` rows, `N` requested new tokens and maximum retained
prompt length `W`, admission reserves:

```text
forward passes = C * N
forward tokens = C * B * (N * W + N * (N - 1) / 2)
```

This counts all padded full-prefix work, including rows already stopped by
EOS. It is deliberately conservative; early stopping can reduce actual usage.
`generate_controls` checks the complete five-condition budget before starting
baseline. `generation_preflight` exposes the same accounting without a model.
These bounds are not a runtime, memory, result-byte or monetary guarantee;
the enclosing sealed job must retain its external deadline and size/cost caps.

Results are JSON-serializable dictionaries containing supplied padded IDs and
masks, original real `prompt_ids`, retained `used_prompt_ids`,
`dropped_prompt_ids`, exact `generated_ids`, and retained-prompt-plus-generation
`sequence_ids`, with per-row stop reasons. Each step records batch width,
real prefix lengths, decision positions, actual intervention positions
(`null` when unpatched), and emitted IDs (`null` for finished rows). Positions
index that step's canonical left-padded batch. Those lengths and positions
fully specify the attention and intervention masks; reconstruct an intervention
mask as all false except each non-null row/position. Outputs also retain
direction vectors, epsilon, supplied scale, seeds, config, upper bounds and
actual usage. They set `behavior_evaluated: false`; they are not worker receipts
or validated sealed-job results.

Success and failure restore every original module training flag, Python's
global RNG, Torch's CPU RNG and all already initialized CUDA RNGs. CPU calls
do not initialize CUDA or enqueue lazy CUDA seeds. Added hooks are removed;
preexisting hooks remain installed. No gradients or parameter updates occur.
The adapter must not mutate weights, persistent buffers, hook registries or
external state, lazily initialize another accelerator, or consume unhandled
RNG systems. Such arbitrary adapter side effects cannot be undone here. Calls
require exclusive access to this model and these global RNGs while running;
this is not a concurrent model-serving API. CUDA restoration is implemented
but not exercised by the CPU-only tests.

## Parent integration requirements

The chosen reference is **Qwen3.5-9B-Base** revision
`68c46c4b3498877f3ef123c856ecfde50c39f404`, with matching tokenizer revision,
SAE release `7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8`, and
`layer12.sae.pt` SHA256
`2cea61ef74a4d33d59329f7e3d1ddfb4a8cdf3c24acdbc05fc26209679a262d8`.
The current observer selects `language_model.layers.12`; a causal wrapper
may prefix that module path, so resolve and validate the actual L12 post-block
module on the supplied wrapper. The selected probe reference is the frozen
**premature-answer probe with 19 nonzero coefficients**. Do not substitute the
earlier MathDial6432moveprobe. No probe artifact/hash is inferred by this helper;
the parent must bind the exact chosen artifact and its source/split provenance.

The parent owns train-only feature selection, separate unrelated-feature review,
calibration-family residuals, and independent new-task behavioral evaluation.
No SAE feature semantics or learning-effectiveness claim follows from these
toy tests or from that probe's coefficients.

`observer_runpod.py` now admits an explicit `generation` mode through
[`observer_generation_job.py`](observer-generation-job.md). The wrapper embeds
an unchanged valid readout job for its pinned assets and dependency overlay;
the generation specification supplies the actual workload. The original
`extract`, `readout` and forward-only `intervention` paths retain their contracts.
**Generation cannot be labeled readout or intervention to bypass those
validators.** Preparation, execution, export and import checks live in the
generation wrapper rather than this model-level helper.

The sealed path binds the helper, verified causal/head adapter and
source hashes; exact model/tokenizer/SAE/head bytes; reviewed feature/control
declaration; actual selected-token calibration provenance; admitted prompt IDs
and masks; seeds, epsilon, timing/masks, EOS/pad IDs and no-cache bounds. Verify
the same local/remote untruncated prompt preflight before any forward. Account
for all five autoregressive trajectories, calibration work, full-prefix tokens,
step records, direction vectors and output size. Preserve source registry and
family splits, temporal boundaries, private local joins and label separation.

Retain the existing digest-pinned image
`runpod/pytorch@sha256:0a360022e8de4375af99430f84e8b38951acc397252163a37ceac7204d01be35`,
sealed Python 3.12/image-Torch overlay and verified wheel policy. Do not add a
new Torch/CUDA installer, arbitrary model download, implicit credentials,
unverified head or fallback image. Retain the parent's rate/cost reservation,
original deadline, process-group timeout, cleanup reserve, archive/file/log
caps, durable partial-result rules and owned-pod collection/termination. New
generation work needs newly prepared artifacts with accurate accounting; an
existing forward-only seal does not authorize it. See
[the generation job contract](observer-generation-job.md) for its explicit
candidate/comparator semantics and
[the base job contract](observer-experiment-job.md) for inherited boundaries.
The implemented transport and offline preflight do not establish that a real
checkpoint generation job has run or that either direction improves behavior.

## Verification

Run the standalone CPU toy suite from the repository root:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 PYTHONDONTWRITEBYTECODE=1 \
  uv run --offline --python 3.13 --script scripts/training/test_observer_generation.py -v
```

This uses the already cached CPU Torch environment; it fails rather than
fetching missing dependencies. The tests cover causal changes in actually
emitted authored toy tokens, feedback of those emitted IDs into later forwards,
epsilon-zero identity, tensor/tuple block outputs, full/frontier logits, mask
and position handling, row-wise EOS, explicit truncation, budget admission,
malformed/label/future-input rejection, and success/failure restoration.
**All tests establish mechanics only.** No real checkpoint generation, GPU
execution, provider operation, independent behavior evaluation or learning
effectiveness has been established by this implementation.
