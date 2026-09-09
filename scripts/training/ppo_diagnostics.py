"""Completion-only sampler/trainer diagnostics; no network or training calls."""
import math


def _logprobs(values, length, name):
    values = list(values)
    if len(values) != length or any(isinstance(v, bool) or not isinstance(v, (int, float))
                                    or not math.isfinite(v) or v > 0 for v in values):
        raise ValueError(f"{name} must have {length} finite nonpositive logprobs")
    return values


def _comparison(sampled, evaluated):
    differences = [old - new for old, new in zip(sampled, evaluated)]
    try:
        ratios = [math.exp(-difference) for difference in differences]
        squared_mean = math.fsum(difference * difference / len(differences) for difference in differences)
    except OverflowError as error:
        raise ValueError("Logprob difference exceeds diagnostic numeric range") from error
    if not all(math.isfinite(v) for v in ratios) or not math.isfinite(squared_mean):
        raise ValueError("Logprob difference exceeds diagnostic numeric range")
    absolute = sorted(abs(value) for value in differences)
    return {
        "tokens": len(sampled),
        "sample_minus_evaluated_logprob_mean": math.fsum(differences) / len(differences),
        "kl_sample_train_v2": 0.5 * squared_mean,
        "mean_abs_logprob_difference": math.fsum(absolute) / len(absolute),
        "max_abs_logprob_difference": absolute[-1],
        "p95_abs_logprob_difference": absolute[max(0, math.ceil(len(absolute) * 0.95) - 1)],
        "mean_probability_ratio": math.fsum(ratios) / len(ratios),
        "fraction_ratio_outside_0_8_to_1_2": sum(r < 0.8 or r > 1.2 for r in ratios) / len(ratios),
    }


def completion_alignment(prompt_token_count, completion_token_count, rollout_logprobs,
                         training_target_logprobs, current_sampling_logprobs=None):
    """Compare saved rollout probabilities with backward/forward target outputs.

    training_target_logprobs is the complete vector from
    backward.loss_fn_outputs[0]["logprobs"].data, whose first target is the
    second prompt token. It therefore slices at prompt_token_count - 1.
    current_sampling_logprobs, if supplied, is ALREADY sliced to completion
    tokens from compute_logprobs(prompt + completion)[prompt_token_count:].

    A same-checkpoint comparison near zero supports token/backend alignment.
    Different checkpoint comparisons measure policy change and must not be
    labeled a same-checkpoint alignment check. No numeric pass gate is assumed.
    """
    for count in (prompt_token_count, completion_token_count):
        if isinstance(count, bool) or not isinstance(count, int) or count < 1:
            raise ValueError("Prompt and completion token counts must be positive integers")
    rollout = _logprobs(rollout_logprobs, completion_token_count, "rollout_logprobs")
    targets = _logprobs(training_target_logprobs, prompt_token_count + completion_token_count - 1,
                       "training_target_logprobs")
    start = prompt_token_count - 1
    completion = targets[start:]
    result = {
        "completion_only": _comparison(rollout, completion),
        "prompt_target_tokens_excluded": start,
        "completion_fraction_of_target_positions": completion_token_count / len(targets),
        # Reproduces how zero-filled old prompt logprobs can distort full-vector
        # summaries. This is illustrative, not a claim about server internals.
        "unmasked_zero_prompt_reference": _comparison([0.0] * start + rollout, targets),
        "limitations": [
            "First-order mean logprob difference is a sampled estimate, not exact distribution KL.",
            "Full-vector reference is illustrative; provider metric reduction is not public here.",
            "Comparison needs identical tokens and declared checkpoint provenance; no pass gate is implied.",
        ],
    }
    if current_sampling_logprobs is not None:
        sampling = _logprobs(current_sampling_logprobs, completion_token_count, "current_sampling_logprobs")
        result["rollout_vs_current_sampler"] = _comparison(rollout, sampling)
        result["current_sampler_vs_trainer"] = _comparison(sampling, completion)
    return result
