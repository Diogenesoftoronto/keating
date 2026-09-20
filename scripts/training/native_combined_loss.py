"""Offline sampled-target F/S losses. Torch is imported only when computing.

This module neither admits native evidence nor dispatches a training update.
Original-token and actual-sampler declarations must come from the native capture
validator. They are checked for consistency here, not authenticated by this math.
"""
from dataclasses import asdict, dataclass
import math
from typing import Any


ACTOR_ROLES = frozenset({"assistant_text", "assistant_tool_call"})
CONTEXT_ROLES = frozenset({"prompt", "tool_result", "learner", "padding"})
ANCHOR_ASSUMPTION = "logged_target_logprob_mse"
ADVANTAGE_RECIPE = "independent_fixed_caps/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


@dataclass(frozen=True)
class LossConfig:
    mode: str
    feature_coefficient: float
    sd_coefficient: float
    anchor_coefficient: float = 0.
    epsilon: float = .2
    feature_cap: float = 3.
    sd_cap: float = 3.
    max_abs_log_ratio: float = 10.
    anchor_assumption: str | None = None

    def validate(self):
        for name in ("feature_coefficient", "sd_coefficient", "anchor_coefficient"):
            value = getattr(self, name)
            require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1,
                    f"{name} must be finite in [0, 1]")
        require(self.mode in {"F-only", "S-only", "F+S"}, "Unknown loss mode")
        expected = {"F-only": (True, False), "S-only": (False, True), "F+S": (True, True)}[self.mode]
        require((self.feature_coefficient > 0, self.sd_coefficient > 0) == expected,
                "Mode must match positive F/S coefficients; all-zero objectives are invalid")
        for name, low, high in (("epsilon", .01, .3), ("feature_cap", .01, 100),
                                ("sd_cap", .01, 100), ("max_abs_log_ratio", .01, 10)):
            value = getattr(self, name)
            require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high,
                    f"{name} must be finite in [{low}, {high}]")
        require(self.anchor_assumption == (ANCHOR_ASSUMPTION if self.anchor_coefficient > 0 else None),
                "Enabled anchor requires the explicit logged-target MSE assumption")


@dataclass(frozen=True)
class TargetScores:
    """One scoring path's own aligned targets, roles, mask and 1-D torch vector.

Teacher/reference prefixes can differ in length. Selecting each path's mask
must yield exactly the action's original actor completion IDs, in order.
"""
    target_ids: list[int]
    token_roles: list[str]
    completion_mask: list[bool]
    logprobs: Any


@dataclass(frozen=True)
class ActionInput:
    action_id: str
    original_target_ids: list[int]
    current: TargetScores
    behavior: TargetScores
    behavior_distribution: str
    feature_advantage: Any = None
    teacher: TargetScores | None = None
    reference: TargetScores | None = None


def _token_ids(values):
    require(type(values) is list and bool(values)
            and all(type(v) is int and 0 <= v < 2**31 for v in values),
            "Nonempty original integer token IDs required")


def _select(torch, scores, originals, name, *, current=False):
    require(isinstance(scores, TargetScores), f"{name} TargetScores required")
    _token_ids(scores.target_ids)
    count = len(scores.target_ids)
    require(type(scores.token_roles) is list and len(scores.token_roles) == count
            and all(type(r) is str and r in ACTOR_ROLES | CONTEXT_ROLES for r in scores.token_roles),
            f"{name} token role alignment")
    mask = scores.completion_mask
    require(type(mask) is list and len(mask) == count and all(type(v) is bool for v in mask),
            f"{name} requires an aligned boolean completion mask")
    require(any(mask), f"{name} all-zero completion mask")
    require(all(not chosen or role in ACTOR_ROLES for chosen, role in zip(mask, scores.token_roles)),
            f"{name} prompt/tool-result/learner/padding targets are excluded")
    require([t for t, chosen in zip(scores.target_ids, mask) if chosen] == originals,
            f"{name} original target alignment mismatch")
    values = scores.logprobs
    require(isinstance(values, torch.Tensor) and values.ndim == 1 and values.numel() == count
            and values.is_floating_point(), f"{name} requires an aligned floating tensor")
    if current:
        require(values.requires_grad, "Current logprobs must require gradients")
        # Promoting the loss arithmetic alone cannot prevent overflow when
        # autograd casts the derivative back to a float16 input tensor.
        require(values.dtype in (torch.float32, torch.float64),
                "Current logprobs require float32 or float64 gradient storage")
    # Select BEFORE arithmetic: NaN padding must never enter multiplication or exp.
    selected = values[torch.tensor(mask, dtype=torch.bool, device=values.device)]
    require(bool(torch.isfinite(selected).all()) and bool(((selected >= -1e6) & (selected <= 0)).all()),
            f"{name} selected logprobs must be finite in [-1e6, 0]")
    if not current:
        selected = selected.detach()
    return selected.to(dtype=torch.float64 if values.dtype == torch.float64 else torch.float32)


def _feature(torch, value, current, cap):
    if value is None:
        return None
    if isinstance(value, torch.Tensor):
        require(value.ndim == 0 and value.is_floating_point() and bool(torch.isfinite(value)),
                "Feature advantage must be a finite floating scalar or None")
        return value.detach().clamp(-cap, cap).to(device=current.device, dtype=current.dtype)
    require(type(value) in (int, float) and math.isfinite(value),
            "Feature advantage must be a finite scalar or None")
    return current.new_tensor(max(-cap, min(cap, value)))


def combined_loss(actions, config):
    """Return differentiable components, detached diagnostics, or an abstention.

F/S each use -mean_action(mean_completion(min(r*A, clip(r)*A))). Their
advantages are detached. F is an action scalar; S is teacher minus CURRENT
student, recomputed on every invocation. Each has its own explicit fixed cap.
The optional anchor is mean_action(mean_completion(.5*(student-reference)^2))
on the logged targets, without claiming a vocabulary KL or state correction.
"""
    require(isinstance(config, LossConfig), "LossConfig required")
    config.validate()
    require(type(actions) is list and bool(actions), "Nonempty action batch required")
    import torch

    coefficients = {"feature": config.feature_coefficient, "sd": config.sd_coefficient,
                    "anchor": config.anchor_coefficient}
    prepared, seen, unknown = [], set(), []
    for action in actions:
        require(isinstance(action, ActionInput) and type(action.action_id) is str
                and bool(action.action_id.strip()) and action.action_id not in seen,
                "Unique nonempty action IDs required")
        seen.add(action.action_id)
        _token_ids(action.original_target_ids)
        require(action.behavior_distribution == "actual_sampler", "Actual behavior sampler probabilities required")
        s = _select(torch, action.current, action.original_target_ids, "current", current=True)
        b = _select(torch, action.behavior, action.original_target_ids, "behavior").to(s)
        difference = s - b
        require(bool(torch.isfinite(difference).all()) and bool((difference.abs() <= config.max_abs_log_ratio).all()),
                "Stale or unstable behavior log ratio")
        q = (_select(torch, action.teacher, action.original_target_ids, "teacher").to(s)
             if config.sd_coefficient else None)
        reference = (_select(torch, action.reference, action.original_target_ids, "reference").to(s)
                     if config.anchor_coefficient else None)
        feature = _feature(torch, action.feature_advantage, s, config.feature_cap) if config.feature_coefficient else None
        if config.feature_coefficient and feature is None:
            unknown.append(action.action_id)
        prepared.append((action, s, difference, q, reference, feature))
    require(len({id(a.current.logprobs) for a in actions}) == len(actions), "Distinct current score tensors required per action")
    require(len({(s.device, s.dtype) for _, s, *_ in prepared}) == 1,
            "Current scores must share device and computation dtype")
    base = {"status": "abstained", "reason": None, "loss": None,
            "components": {k: None for k in coefficients}, "weighted_components": {k: None for k in coefficients},
            "config": asdict(config), "advantage_recipe": ADVANTAGE_RECIPE,
            "normalization": "mean_action_of_completion_means", "actions": [], "metrics": {},
            "unknown_feature_actions": unknown}
    if unknown:
        return {**base, "reason": "unknown_feature_advantage"}

    terms = {k: [] for k in coefficients}
    records, nonzero = [], False
    for action, s, difference, teacher, reference, feature in prepared:
        ratio = difference.exp()
        clipped_ratio = ratio.clamp(1 - config.epsilon, 1 + config.epsilon)
        sd = (teacher - s.detach()).clamp(-config.sd_cap, config.sd_cap) if teacher is not None else None
        advantages = {"feature": feature.expand_as(s) if feature is not None else None, "sd": sd}
        record = {"action_id": action.action_id, "original_target_ids": list(action.original_target_ids),
                  "completion_tokens": s.numel(), "token_loss_weight": 1 / (len(actions) * s.numel()),
                  "ratio_min": float(ratio.detach().min()), "ratio_max": float(ratio.detach().max()),
                  "ratio_outside_clip_fraction": float(((ratio.detach() < 1 - config.epsilon)
                                                         | (ratio.detach() > 1 + config.epsilon)).double().mean()),
                  "advantages": {}, "clip_active_fraction": {}}
        for name, advantage in advantages.items():
            if advantage is None:
                continue
            terms[name].append(-torch.minimum(ratio * advantage, clipped_ratio * advantage).mean())
            nonzero = nonzero or bool((advantage != 0).any())
            record["advantages"][name] = advantage.detach().cpu().tolist()
            active = ((advantage > 0) & (ratio.detach() > 1 + config.epsilon)
                      | (advantage < 0) & (ratio.detach() < 1 - config.epsilon))
            record["clip_active_fraction"][name] = float(active.double().mean())
        if reference is not None:
            residual = s - reference
            terms["anchor"].append(.5 * residual.square().mean())
            nonzero = nonzero or bool((residual.detach() != 0).any())
        records.append(record)
    if not nonzero:
        return {**base, "reason": "zero_training_signal", "actions": records}
    components = {name: torch.stack(values).mean() if values else None for name, values in terms.items()}
    weighted = {name: value * coefficients[name] if value is not None else None for name, value in components.items()}
    loss = torch.stack([v for v in weighted.values() if v is not None]).sum()
    require(bool(torch.isfinite(loss)) and all(v is None or bool(torch.isfinite(v)) for v in components.values()),
            "Nonfinite combined loss")
    metrics = {"loss_total": float(loss.detach()), "action_count": float(len(actions)),
               "completion_token_count": float(sum(len(a.original_target_ids) for a in actions))}
    for name in components:
        if components[name] is not None:
            metrics["loss_" + name] = float(components[name].detach())
            metrics["weighted_loss_" + name] = float(weighted[name].detach())
    return {**base, "status": "computed", "loss": loss, "components": components,
            "weighted_components": weighted, "actions": records, "metrics": metrics}


def logprob_gradient_diagnostics(result, actions):
    """Local d(loss)/d(current logprob) only; never model-parameter gradients.

Does not populate .grad or consume the graph. Run before the caller's backward.
The supplied action order/IDs must be the same batch used to compute result.
"""
    require(result.get("status") == "computed", "Cannot differentiate an abstained result")
    require([a.action_id for a in actions] == [a["action_id"] for a in result["actions"]],
            "Diagnostic action alignment mismatch")
    import torch

    inputs = [a.current.logprobs for a in actions]
    outputs, flat = {}, {}
    for name, component in {**result["components"], "total": result["loss"]}.items():
        if component is None:
            outputs[name] = None
            continue
        gradients = torch.autograd.grad(component, inputs, retain_graph=True, allow_unused=False)
        vector = torch.cat([g.detach().reshape(-1).to(device="cpu", dtype=torch.float64) for g in gradients])
        require(bool(torch.isfinite(vector).all()), "Nonfinite logprob gradient")
        flat[name] = vector
        outputs[name] = {"l2_norm": float(torch.linalg.vector_norm(vector)),
                         "per_action": {a.action_id: g.detach().cpu().tolist() for a, g in zip(actions, gradients)}}
    cosine = None
    if "feature" in flat and "sd" in flat:
        denominator = torch.linalg.vector_norm(flat["feature"]) * torch.linalg.vector_norm(flat["sd"])
        if denominator > 0:
            cosine = float(torch.dot(flat["feature"], flat["sd"]) / denominator)
    return {"coordinate_system": "supplied_current_target_logprobs", "components": outputs,
            "feature_sd_cosine": cosine, "full_parameter_gradients": False}
