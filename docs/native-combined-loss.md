# Separate feature and hindsight losses on original actor targets

[`native_combined_loss.py`](../scripts/training/native_combined_loss.py) implements
the local sampled-token part of research-plan sections 10, 11, 17.3, and 19.4.
It returns a differentiable Torch loss and inspectable components for `F-only`,
`S-only`, or `F+S`, optionally with a declared reference-anchor surrogate.
Importing the module does not import Torch; computing a loss does. It has no
provider client, credential access, budget operation, optimizer, or file I/O.

This is a math interface, not an evidence admission authority. Its declarations
and token checks cannot authenticate generation provenance. The caller must use
the existing native capture, review, family, visibility, and eligibility checks.
The examples and tests below contain **authored tensors, zero real people, and no
measured learning outcomes**.

## Objective and normalization

For action `n`, let `T_n` be its number of original actor completion tokens. All
scoring paths select those same token IDs in the same order. Write `s`, `q`, `b`,
and `r` for current-student, teacher, actual-behavior, and reference log
probabilities of a selected token. Each call recomputes:

```text
A_S[n,t] = stopgrad(clip(q[n,t] - s[n,t], -sd_cap, sd_cap))
A_F[n,t] = stopgrad(clip(feature_advantage[n], -feature_cap, feature_cap))
rho[n,t] = exp(s[n,t] - stopgrad(b[n,t]))

PPO(A, rho) = min(rho * A, clip(rho, 1-epsilon, 1+epsilon) * A)
L_F = -(1/B) * sum_n (1/T_n) * sum_t PPO(A_F[n,t], rho[n,t])
L_S = -(1/B) * sum_n (1/T_n) * sum_t PPO(A_S[n,t], rho[n,t])
L_anchor = (1/B) * sum_n (1/T_n) * sum_t 0.5 * (s[n,t] - stopgrad(r[n,t]))**2
L = feature_coefficient * L_F + sd_coefficient * L_S + anchor_coefficient * L_anchor
```

F receives **one fixed action-level advantage**, already constructed from the
accepted feature reward, horizon, and baseline by an external estimator. The
kernel does not turn a classifier probability into an advantage. Its scalar is
repeated over the action's eligible targets and averaged once. A three-token
action and a thirty-token action receive the same aggregate weight. No padding,
prompt length, or external batch scaling enters this mean.

F and S are clipped separately before combining their losses. Combining their
advantages first is a different objective: opposite-sign advantages can cancel
even though one PPO term is saturated and the other still has a gradient.
For a positive advantage above the upper ratio threshold the favorable update
saturates; for a negative advantage below the lower threshold it saturates.
The opposite tail retains its corrective gradient. Teacher scores, feature
advantages, behavior scores, and reference scores never receive gradients.
The current score inside the S advantage is detached too; only the ratio and
optional anchor provide current-score derivatives.

### Explicit bounded settings

| Setting | Contract |
| --- | --- |
| `mode` | `F-only`, `S-only`, or `F+S` |
| `feature_coefficient`, `sd_coefficient` | Required, finite in `[0, 1]`; positive exactly for the components named by the mode |
| `anchor_coefficient` | Finite in `[0, 1]`, default `0` |
| `epsilon` | Finite in `[0.01, 0.3]`, default `0.2` |
| `feature_cap`, `sd_cap` | Independent finite fixed caps in `[0.01, 100]`, each default `3` |
| `max_abs_log_ratio` | Finite in `[0.01, 10]`, default `10`; rejects a stale batch before exponentiation |
| `anchor_assumption` | Exactly `logged_target_logprob_mse` when the anchor is enabled; `None` otherwise |

Coefficients are explicit loss scales, not probability weights: they need not
sum to one and are never silently normalized. An all-zero F/S configuration is
invalid. The anchor is optional within these three modes, not a fourth mode.

The returned recipe identifier is `independent_fixed_caps/v1`. This **does not
replace or reproduce** [`sdpo_math.prepare_advantages`](../scripts/training/sdpo_math.py):
that existing function updates a mean-absolute-advantage EMA with alpha `0.1`
and clips at three times its scale. The current native updater also applies its
configured absolute cap afterward. Comparing this new kernel with that path
requires reporting the different clipping recipes; a fixed cap of `3` is not
the EMA recipe simply because both contain the number three.

### What the anchor assumes

The reference anchor is squared log-probability drift **on the logged original
targets**, under the declared empirical action/token weighting. It is not
importance-weighted, does not score unobserved vocabulary entries, and is not
full-vocabulary KL. The caller must supply independently frozen reference scores
on those exact targets and bind the checkpoint, tokenizer, and scoring prefix.
This surrogate supplies a restoring gradient on observed target probabilities;
it makes no trust-region guarantee for the full policy.

Likewise, the F/S ratio requires probabilities from the distribution that
actually sampled the response, including any temperature or truncation. Later
base-model rescoring cannot recover that denominator. Clipped sampled-action
ratios do not correct state-occupancy or future-feedback distribution changes.

## Inputs, masks, and abstention

`combined_loss(actions: list[ActionInput], config: LossConfig)` takes one action
per item. Action IDs must be unique; original completion IDs must be a nonempty
integer list. Each action has a separate differentiable `current.logprobs`
tensor. `behavior_distribution` must explicitly equal `actual_sampler`.

Each `TargetScores` contains its own full target IDs, roles, boolean completion
mask, and aligned one-dimensional floating tensor. Different scoring prefixes
can have different lengths. Applying each mask must yield exactly the action's
`original_target_ids`, in order. The current vector must require gradients and
use float32 or float64 storage.
Enabled S requires teacher scores; an enabled anchor requires reference scores.
Disabled components do not require their inputs.

Only `assistant_text` and **actor-authored** `assistant_tool_call` tokens can be
targets. Prompt, `tool_result`, learner, and padding roles must be masked out.
The tool-call distinction preserves policy-authored actions without training on
environment answers. Masks are actual booleans, not arbitrary numeric weights.
Selection happens before subtraction, multiplication, or exponentiation:
masked NaNs are safe and their current-score gradients are zero. Selected
log probabilities must be finite in `[-1e6, 0]`, matching the updater's score
range; invalid probabilities are rejected rather than clipped into validity.
Detached half-precision scores are promoted for arithmetic; float64 is retained.
Low-precision current tensors are rejected: promoting just the loss arithmetic
cannot prevent overflow when autograd writes a derivative back to float16.

Abstention does not authorize a partial update:

- Unknown feature advantage is `None`. If F is enabled and any action is unknown,
  the **whole batch** returns `status: abstained`,
  `reason: unknown_feature_advantage`, the missing action IDs, and no loss.
  It does not silently become S-only or discard actions and reweight the rest.
- A known feature advantage of zero is valid. That action stays in the batch
  denominator, and another component or action may still provide a signal.
- If every enabled advantage and reference residual is exactly zero, the result
  abstains with `zero_training_signal`. Nonzero advantages with saturated PPO
  gradients still return a computed loss; gradient diagnostics reveal the zero
  derivative rather than mislabeling the inputs as missing.
- Empty batches, all-zero masks, misalignment, nonfinite enabled inputs,
  invalid settings, and excessive log ratios raise `ValueError`. A supplied
  NaN feature value is invalid, not an unknown or a zero.

## Authored local example

Run from a Python environment with Torch installed and `scripts/training` on the
module search path. These invented IDs and scores do not describe any person or
captured model response.

```python
import torch
from native_combined_loss import (
    ActionInput, LossConfig, TargetScores, combined_loss, logprob_gradient_diagnostics,
)

def scores(values):
    return TargetScores(
        target_ids=[101, 102],
        token_roles=["assistant_text", "assistant_text"],
        completion_mask=[True, True],
        logprobs=torch.tensor(values, dtype=torch.float64, requires_grad=True),
    )

action = ActionInput(
    action_id="authored-example", original_target_ids=[101, 102],
    current=scores([-2., -2.]), behavior=scores([-2., -2.]),
    behavior_distribution="actual_sampler",  # Authored declaration, not a capture.
    feature_advantage=0.5, teacher=scores([-1., -1.]),
)
result = combined_loss([action], LossConfig("F+S", feature_coefficient=0.4, sd_coefficient=0.6))
assert result["status"] == "computed"
assert abs(result["metrics"]["loss_total"] - (-0.8)) < 1e-12
diagnostics = logprob_gradient_diagnostics(result, [action])
assert diagnostics["full_parameter_gradients"] is False
result["loss"].backward()  # Local tensor gradients only; no optimizer or SDK.
assert torch.allclose(action.current.logprobs.grad, torch.tensor([-0.4, -0.4], dtype=torch.float64))
```

Computed results contain the scalar loss, raw `components`,
`weighted_components`, detached numeric `metrics`, full config, recipe, and
normalization identifier. Per-action records expose original IDs, token weights,
clipped advantages, ratio ranges, out-of-range fractions, and sign-dependent
clipping fractions. Missing components are `None` rather than fabricated zeros.

`logprob_gradient_diagnostics` accepts the same result and original action
objects before backward. It uses `autograd.grad` without populating `.grad` and
retains the graph for the caller's subsequent backward. It reports per-action
full-vector derivatives and L2 norms for raw F/S/anchor components and the
weighted total. The F/S cosine is `None` when either norm is zero. These are
**d(loss)/d(supplied current target logprob)** diagnostics. A full parameter
gradient includes the model Jacobian; its norms and cosine cannot be inferred
from these values. This module does not compute or claim them.

## Proposed integration seam; updater unchanged

The inspected [`native_tinker_update.py`](../scripts/training/native_tinker_update.py)
and [its documentation](native-tinker-update.md) currently admit SFT, PPO, and
SDPO, then call built-in `forward_backward`. They do not accept this module's
three modes or anchor. No updater/SDK change or hosted validation is included
here.

Tinker's documented `forward_backward_custom` callback receives the batch and a
list of differentiable target-log-probability tensors, returning a scalar loss
and numeric metrics. The SDK performs a forward pass, evaluates the callback
locally, and propagates its log-probability derivatives back to the training
service. This is the future callback boundary for the kernel.
[Primary custom-loss documentation](https://tinker-docs.thinkingmachines.ai/tinker/losses/custom/).

The future adapter needs the following explicit mapping:

| Existing source | Kernel input or required change |
| --- | --- |
| Validated `row["record"]["segment"]` | `completion_token_ids` become `original_target_ids`; preserve capture/event/branch/family bindings outside the loss |
| Callback's live score tensor | Current `TargetScores.logprobs`; full IDs are `segment["target_tokens"]`, mask is the validated `loss_mask` converted to booleans |
| Original prompt and completion roles | Prefix roles are `prompt` for `len(prompt_token_ids)-1` shifted targets, followed by `segment["completion_token_roles"]` |
| `segment["behavior_logprobs"]` | Completion-only behavior packet with original IDs, completion roles, all-true mask, and the captured actual-sampler declaration |
| Existing frozen teacher scoring | Completion-only teacher packet; the current path checks `len(prefix)+len(completion)` and takes `raw[len(prefix):]` from `compute_logprobs` |
| External action-feature estimator | One independently supported action scalar plus estimator, baseline, horizon, aggregation, review, and temporal-boundary provenance |
| Optional reference scoring | New frozen reference capture with exact original completion IDs and independently bound scoring context; do not substitute feedback-conditioned teacher scores |

`completion_scores(output, rows)` currently converts SDK outputs into Python
lists for validation and strips the shifted prefix. **Do not use it on the
custom callback's current tensors:** that would lose the autograd connection.
Construct `TargetScores` directly from those tensors and the admitted metadata.

`datum(sdk, segment, batch_size, advantages)` already divides advantages by
`completion_count * batch_size` for the built-in PPO path. This kernel does its
own per-action completion mean. Do not pass those scaled advantages into F or S
or multiply the custom loss by another inverse batch/token count. Construct
custom target datums from the original `input_tokens` and `target_tokens` using
the pinned SDK's custom-loss contract. Verify its weights handling with a local
callback adapter check before dispatch. Current PPO signals are token-level
lists; collapsing them into a single F scalar without an explicit action-level
estimator would change the contract and is not implemented here.

Inside a future custom callback, after assembling the packets above, the local
return is `combined_loss(actions, config)["loss"]` and its `metrics`. Check for
abstention first and stop the operation; do not fabricate a zero loss and proceed
to an optimizer step. Compute S from that callback's **current** tensor, not the
earlier `student_forward` result or precomputed EMA-clipped advantages. Keep the
existing original-token, freshness, eligibility, review, and teacher-feedback
boundaries; a combined run needs eligible inputs for both enabled signals.

The integration would also extend the sealed method/config and signal schema,
score report, operation plan, reservation calculation, and single-attempt SDK
audit to account for the custom SDK's forward/local/backward sequence. Preserve
the existing optimizer and checkpoint sequencing and score-consistency checks.
The current updater's built-in backward phase is the replacement point, not a
second update appended after it. This proposal adds no human approval flow and
does not assert that the existing execution plan already supports custom losses.

## Local verification

With Torch available in the chosen Python environment:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python -m unittest discover \
  -s scripts/training -p 'test_native_combined_loss.py'
```

The tests cover gradient signs and detachment, favorable and corrective tails
for F and S, separate component clipping, fixed caps, ragged action means,
reference restoring gradients, exact original IDs with different prefixes,
masked NaNs, excluded context roles, invalid values, stale behavior, unknown
feature abstention, and local gradient diagnostics. Torch-dependent tests skip
explicitly when the optional dependency is absent; import/config tests still
run. All data are authored. These checks establish local math behavior, not a
provider update, model-parameter gradient measurement, or human outcome.
