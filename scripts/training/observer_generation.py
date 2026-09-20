"""Local, no-cache greedy generation with controlled post-block interventions.

No loader, tokenizer, labels, provider access, or writes. The caller supplies a
causal model (or a local logits adapter) and already admitted prompt IDs. See
docs/observer-generation.md for the semantics and the sealed-job integration seam.
"""
from collections.abc import Mapping
from contextlib import ExitStack, contextmanager
from dataclasses import asdict, dataclass
import math
import random

import observer_core as core


@dataclass(frozen=True)
class GenerationConfig:
    max_new_tokens: int
    max_context_tokens: int
    max_forward_passes: int
    max_forward_tokens: int
    pad_token_id: int
    eos_token_id: int | None = None
    seed: int = 0
    overflow: str = "reject"

    def __post_init__(self):
        for key in ("max_new_tokens", "max_context_tokens", "max_forward_passes", "max_forward_tokens"):
            if type(getattr(self, key)) is not int or getattr(self, key) < 1:
                raise ValueError(f"{key} must be a positive integer")
        if self.max_new_tokens >= self.max_context_tokens:
            raise ValueError("Context must reserve at least one prompt token plus all new tokens")
        for key in ("pad_token_id", "eos_token_id"):
            value = getattr(self, key)
            if key == "eos_token_id" and value is None:
                continue
            if type(value) is not int or not 0 <= value < 2**63:
                raise ValueError(f"{key} must be a nonnegative int64 token ID")
        if type(self.seed) is not int or not 0 <= self.seed < 2**31:
            raise ValueError("seed must be an integer in [0, 2**31)")
        if self.overflow not in ("reject", "truncate_left"):
            raise ValueError("overflow must be reject or explicit truncate_left")


def _prepare(batch, config, *, conditions):
    import torch
    if not isinstance(config, GenerationConfig):
        raise ValueError("GenerationConfig required")
    if not isinstance(batch, Mapping) or set(batch) != {"input_ids", "attention_mask"}:
        raise ValueError("Batch must contain exactly input_ids and attention_mask; no labels or extra inputs")
    ids, mask = batch["input_ids"], batch["attention_mask"]
    if (not isinstance(ids, torch.Tensor) or ids.dtype != torch.long or ids.ndim != 2
            or not ids.numel() or bool((ids < 0).any())):
        raise ValueError("input_ids must be nonempty nonnegative int64 [batch, tokens]")
    if (not isinstance(mask, torch.Tensor) or mask.shape != ids.shape
            or mask.dtype not in (torch.bool, torch.int32, torch.int64)
            or bool(((mask != 0) & (mask != 1)).any()) or mask.device != ids.device):
        raise ValueError("attention_mask must be binary bool/int [batch, tokens] on the input device")
    if ids.device.type not in ("cpu", "cuda"):
        raise ValueError("Only CPU/CUDA inputs have a supported RNG preservation contract")
    original_ids, original_mask = ids.tolist(), mask.tolist()
    prompts, used, dropped = [], [], []
    capacity = config.max_context_tokens - config.max_new_tokens
    for row, attended in zip(original_ids, original_mask):
        positions = [i for i, bit in enumerate(attended) if bit]
        if not positions or positions != list(range(positions[0], positions[-1] + 1)):
            raise ValueError("Each prompt needs one nonempty contiguous attended span; mask holes are rejected")
        prompt = row[positions[0]:positions[-1] + 1]
        if len(prompt) > capacity and config.overflow == "reject":
            raise ValueError("Prompt plus reserved generation exceeds context; truncation was not authorized")
        prompts.append(prompt)
        used.append(prompt[-capacity:])
        dropped.append(prompt[:-capacity])
    width, count = max(map(len, used)), config.max_new_tokens
    passes = conditions * count
    tokens = conditions * len(used) * (count * width + count * (count - 1) // 2)
    if passes > config.max_forward_passes or tokens > config.max_forward_tokens:
        raise ValueError("Worst-case full-prefix generation exceeds the declared aggregate forward budget")
    return {"input_ids": original_ids, "attention_mask": original_mask,
            "prompts": prompts, "used": used, "dropped": dropped, "device": ids.device,
            "upper_bound": {"forward_passes": passes, "forward_tokens": tokens}}


def generation_preflight(batch, config, *, conditions=1):
    """Pure token accounting; counts padded full-prefix work, including stopped rows.

Use conditions=5 for generate_controls. Admission reserves all requested new
tokens even if EOS might stop early. No model invocation or tokenization occurs.
"""
    if type(conditions) is not int or conditions < 1:
        raise ValueError("conditions must be a positive integer")
    prepared = _prepare(batch, config, conditions=conditions)
    return {"upper_bound": prepared["upper_bound"],
            "prompt_ids": prepared["prompts"], "used_prompt_ids": prepared["used"],
            "dropped_prompt_ids": prepared["dropped"]}


def _unit(direction):
    import torch
    if (not isinstance(direction, torch.Tensor) or direction.ndim != 1 or not direction.numel()
            or not direction.is_floating_point() or not bool(torch.isfinite(direction).all())):
        raise ValueError("Direction must be a finite nonempty floating vector")
    vector = direction.detach().to(device="cpu", dtype=torch.float32, copy=True)
    norm = vector.norm()
    if not bool(torch.isfinite(norm)) or norm.item() <= 0:
        raise ValueError("Direction must have a finite nonzero float32 norm")
    return vector / norm


def _strength(epsilon, scale):
    if (isinstance(epsilon, bool) or isinstance(scale, bool)
            or not isinstance(epsilon, (float, int)) or not isinstance(scale, (float, int))
            or not all(math.isfinite(x) for x in (epsilon, scale, epsilon * scale)) or scale <= 0):
        raise ValueError("Finite epsilon and positive scale with finite product required")


@contextmanager
def _execution_state(model, seed):
    """Restore heterogeneous module flags, Python RNG and Torch CPU/initialized CUDA RNGs."""
    import torch
    flags = [(module, module.training) for module in model.modules()]
    python_rng = random.getstate()
    # Do not initialize CUDA or enqueue lazy seeds during a CPU-only call.
    devices = list(range(torch.cuda.device_count())) if torch.cuda.is_initialized() else []
    try:
        with torch.random.fork_rng(devices=devices), torch.inference_mode():
            random.seed(seed)
            torch.random.default_generator.manual_seed(seed)
            for device in devices:
                torch.cuda.default_generators[device].manual_seed(seed)
            model.eval()
            yield
    finally:
        random.setstate(python_rng)
        for module, training in flags:
            module.training = training


def _pack(sequences, config, device):
    import torch
    width = max(map(len, sequences))
    ids = torch.full((len(sequences), width), config.pad_token_id, dtype=torch.long, device=device)
    attention = torch.zeros_like(ids)
    for row, sequence in enumerate(sequences):
        ids[row, -len(sequence):] = torch.tensor(sequence, dtype=torch.long, device=device)
        attention[row, -len(sequence):] = 1
    positions = (attention.cumsum(-1) - 1).clamp_min(0)
    return ids, attention, positions


def _forward_logits(model, **inputs):
    """Default contract: tensor logits, mapping['logits'], or an object with .logits."""
    import torch
    output = model(**inputs)
    if isinstance(output, torch.Tensor):
        return output
    if isinstance(output, Mapping):
        return output.get("logits")
    return getattr(output, "logits", None)


def generate(model, block, batch, *, config, direction=None, epsilon=0.0, scale=1.0, forward=None):
    """Emit actual tokens, intervening only at each active row's prediction frontier.

forward(model, *, input_ids, attention_mask, position_ids, use_cache=False) must
    return floating logits [B,V] at the prediction frontier OR full [B,T,V], from
    exactly one invocation of the supplied block. Prefixes are left-padded, so
    hidden[:, -1, :] is the frontier; [B,V] scores are used directly, not broadcast.
It must be stateless between calls and use only these inputs. Without a callback,
the same inputs go to model and its logits are extracted by _forward_logits.
"""
    import torch
    prepared = _prepare(batch, config, conditions=1)
    _strength(epsilon, scale)
    unit = _unit(direction) if direction is not None else None
    if epsilon != 0 and unit is None:
        raise ValueError("A direction is required for a nonzero intervention")
    if not isinstance(model, torch.nn.Module) or not any(module is block for module in model.modules()):
        raise ValueError("Selected block must belong to the supplied torch model")
    if forward is not None and not callable(forward):
        raise ValueError("forward must be a local callable logits adapter")
    forward = forward or _forward_logits
    sequences = [list(row) for row in prepared["used"]]
    generated = [[] for _ in sequences]
    active = [True] * len(sequences)
    stops = ["max_new_tokens"] * len(sequences)
    steps = []
    passes = tokens = 0
    with _execution_state(model, config.seed):
        for _step in range(config.max_new_tokens):
            ids, attention, positions = _pack(sequences, config, prepared["device"])
            last = torch.arange(ids.shape[1], device=ids.device).expand_as(ids).masked_fill(~attention.bool(), -1).amax(-1)
            target = torch.zeros_like(attention, dtype=torch.bool)
            rows = torch.arange(len(sequences), device=ids.device)
            target[rows, last] = torch.tensor(active, dtype=torch.bool, device=ids.device)
            calls = 0

            def validate_block(_module, _args, output):
                nonlocal calls
                calls += 1
                residual = core.residual_tensor(output)
                if calls != 1 or tuple(residual.shape[:2]) != tuple(ids.shape):
                    raise ValueError("Expected one full-prefix block invocation with unchanged [batch, tokens]")
                if unit is not None and residual.shape[-1] != unit.numel():
                    raise ValueError("Direction does not match residual width")

            with ExitStack() as hooks:
                if epsilon != 0:
                    hooks.enter_context(core.intervene(block, unit, epsilon=epsilon, scale=scale,
                                                       token_mask=lambda _h: target))
                # Also validates the patched residual, catching finite-dtype overflow.
                handle = block.register_forward_hook(validate_block)
                hooks.callback(handle.remove)
                logits = forward(model, input_ids=ids, attention_mask=attention,
                                 position_ids=positions, use_cache=False)
                if calls != 1:
                    raise ValueError("Expected exactly one selected-block invocation")
            if (not isinstance(logits, torch.Tensor) or logits.ndim not in (2, 3)
                    or logits.shape[0] != ids.shape[0]
                    or (logits.ndim == 3 and logits.shape[1] != ids.shape[1]) or logits.shape[-1] < 1
                    or not logits.is_floating_point()):
                raise ValueError("Adapter must return floating causal logits [batch, vocabulary] or [batch, tokens, vocabulary]; hidden states are not logits")
            vocab = logits.shape[-1]
            if (config.pad_token_id >= vocab or (config.eos_token_id is not None and config.eos_token_id >= vocab)
                    or bool((ids >= vocab).any())):
                raise ValueError("Prompt/pad/EOS token ID is outside the output vocabulary")
            scores = logits if logits.ndim == 2 else logits[rows.to(logits.device), last.to(logits.device)]
            if not bool(torch.isfinite(scores).all()):
                raise ValueError("Non-finite next-token logits")
            emitted = scores.argmax(-1).tolist()
            decision_positions = [int(last[row]) if running else None for row, running in enumerate(active)]
            steps.append({"step": _step, "batch_width": ids.shape[1],
                          "prefix_lengths": list(map(len, sequences)),
                          "decision_positions": decision_positions,
                          "intervention_positions": decision_positions if epsilon != 0 else [None] * len(sequences),
                          "emitted_ids": [token if running else None for token, running in zip(emitted, active)]})
            passes += 1
            tokens += ids.numel()
            for row, token in enumerate(emitted):
                if active[row]:
                    sequences[row].append(token)
                    generated[row].append(token)
                    if token == config.eos_token_id:
                        active[row] = False
                        stops[row] = "eos"
            # Never retain vocabulary logits across decoding steps.
            del logits, scores
            if not any(active):
                break
    return {"schema_version": 1, "evidence": "local_autoregressive_tokens",
            "decoding": "greedy_no_cache", "intervention_scope": "last_active_token_each_forward",
            "intervention_timing": "post_block_before_next_token_logits; prior_history_recomputed_without_patch",
            "config": asdict(config), "epsilon": epsilon, "scale": scale,
            "direction": None if unit is None else unit.tolist(),
            "input_ids": prepared["input_ids"], "attention_mask": prepared["attention_mask"],
            "rows": [{"prompt_ids": prompt, "used_prompt_ids": used, "dropped_prompt_ids": dropped,
                      "generated_ids": emitted, "sequence_ids": sequence, "stop_reason": stop}
                     for prompt, used, dropped, emitted, sequence, stop in zip(
                         prepared["prompts"], prepared["used"], prepared["dropped"], generated, sequences, stops)],
            "usage": {"forward_passes": passes, "forward_tokens": tokens},
            "steps": steps, "upper_bound": prepared["upper_bound"], "behavior_evaluated": False}


def generate_controls(model, block, batch, *, config, selected_direction, unrelated_direction,
                      unrelated_review, epsilon, scale, random_seed, forward=None):
    """Paired baseline, selected +/-, seeded random, and separately reviewed unrelated.

Budgets cover ALL FIVE conditions. The review is a required opaque reference to
the caller's reviewed unrelated-feature declaration, never forwarded to the model.
Semantic unrelatedness and source admission remain the caller's responsibility.
"""
    import torch
    flight = generation_preflight(batch, config, conditions=5)
    _strength(epsilon, scale)
    if epsilon < 0:
        raise ValueError("Control-suite epsilon must be nonnegative; signs are paired internally")
    if not isinstance(unrelated_review, str) or not unrelated_review.strip():
        raise ValueError("Separate reviewed unrelated-control reference required")
    if type(random_seed) is not int or not 0 <= random_seed < 2**31:
        raise ValueError("random_seed must be an integer in [0, 2**31)")
    selected, unrelated = _unit(selected_direction), _unit(unrelated_direction)
    if selected.shape != unrelated.shape:
        raise ValueError("Selected and unrelated directions must have the same width")
    if torch.allclose(selected, unrelated) or torch.allclose(selected, -unrelated):
        raise ValueError("Unrelated control cannot duplicate either selected direction")
    random_direction = _unit(torch.randn(selected.numel(), generator=torch.Generator(device="cpu").manual_seed(random_seed)))
    conditions = (("baseline", None, 0.0), ("selected_positive", selected, epsilon),
                  ("selected_negative", -selected, epsilon), ("random", random_direction, epsilon),
                  ("unrelated", unrelated, epsilon))
    results = {}
    for name, direction, strength in conditions:
        results[name] = generate(model, block, batch, config=config, direction=direction,
                                 epsilon=strength, scale=scale, forward=forward)
    return {"schema_version": 1, "evidence": "controlled_local_autoregressive_tokens",
            "random_seed": random_seed, "unrelated_review": unrelated_review,
            "norm_rule": "unit_direction_times_epsilon_times_fixed_calibration_scale",
            "upper_bound": flight["upper_bound"],
            "usage": {key: sum(result["usage"][key] for result in results.values())
                      for key in ("forward_passes", "forward_tokens")},
            "conditions": results, "behavior_evaluated": False}
