"""Provider-independent arithmetic for the SDPO-inspired pipeline pilot.

These choices are explicit experiment settings, not a claimed reproduction of
Trajectory's unpublished implementation. PPO ratio clipping lives in the trainer.
"""
import math


def _finite(values, name, nonpositive=False):
    result = list(values)
    if not result:
        raise ValueError(f"{name} must be nonempty")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
           or (nonpositive and v > 0) for v in result):
        raise ValueError(f"{name} must contain finite {'nonpositive ' if nonpositive else ''}numbers")
    return result


def prepare_advantages(teacher_logprobs, current_logprobs, running_mean_abs=None):
    """Return (clipped teacher-minus-student advantages, new EMA, metrics).

    The EMA tracks the unclipped mean absolute advantage, with alpha 0.1.
    Initialize from the first valid batch. Clip symmetrically at three times
    the updated EMA; do not center or standardize advantages.
    """
    teacher = _finite(teacher_logprobs, "teacher_logprobs", nonpositive=True)
    current = _finite(current_logprobs, "current_logprobs", nonpositive=True)
    if len(teacher) != len(current):
        raise ValueError("Teacher and current logprob lengths differ")
    if running_mean_abs is not None:
        _finite([running_mean_abs], "running_mean_abs")
        if running_mean_abs < 0:
            raise ValueError("running_mean_abs must be nonnegative")
    raw = [t - c for t, c in zip(teacher, current)]
    # Divide before summation to avoid overflow for valid large logprobs.
    batch_mean = math.fsum(abs(value) / len(raw) for value in raw)
    updated_mean = batch_mean if running_mean_abs is None else 0.9 * running_mean_abs + 0.1 * batch_mean
    if not math.isfinite(updated_mean):
        raise ValueError("Mean absolute advantage overflow")
    # A finite cap is useful for serialization even near float limits.
    threshold = min(updated_mean, float.fromhex("0x1.fffffffffffffp+1023") / 3) * 3
    advantages = [max(-threshold, min(threshold, value)) for value in raw]
    clipped = sum(abs(value) > threshold for value in raw)
    return advantages, updated_mean, {
        "tokens": len(raw), "batch_mean_abs": batch_mean,
        "running_mean_abs": updated_mean, "clip_threshold": threshold,
        "clipped_tokens": clipped, "clipped_fraction": clipped / len(raw),
        "max_abs_before": max(abs(value) for value in raw),
        "max_abs_after": max(abs(value) for value in advantages),
        "ema_alpha": 0.1,
    }


def datum_vectors(prompt_tokens, completion_tokens, rollout_logprobs, advantages):
    """Causally shift tokens and mask every target belonging to the prompt.

    For prompt [p0,p1] and completion [c0,c1], inputs are [p0,p1,c0],
    targets [p1,c0,c1], and completion weights [0,1,1]. Rollout logprobs
    must be those returned when these completion tokens were sampled.
    """
    prompt, completion = list(prompt_tokens), list(completion_tokens)
    if not prompt or not completion:
        raise ValueError("Prompt and completion tokens must be nonempty")
    if any(isinstance(token, bool) or not isinstance(token, int) or token < 0
           for token in prompt + completion):
        raise ValueError("Token IDs must be nonnegative integers")
    logprobs = _finite(rollout_logprobs, "rollout_logprobs", nonpositive=True)
    values = _finite(advantages, "advantages")
    if len(completion) != len(logprobs) or len(completion) != len(values):
        raise ValueError("Completion, rollout logprobs, and advantages lengths differ")
    all_tokens = prompt + completion
    prefix = [0.0] * (len(prompt) - 1)
    return {
        "input_tokens": all_tokens[:-1], "target_tokens": all_tokens[1:],
        "logprobs": prefix + logprobs, "advantages": prefix + values,
        "weights": prefix + [1.0] * len(completion),
    }
