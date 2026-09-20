"""Generation-time raw evidence; not a substitute for validated training exports.

This journal deliberately makes no claim that provider logprobs include sampler
transforms, or that a renderer assigned original token roles. The native export
gate still needs those facts and the actual runtime/message/event binding.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path


def append_capture(path, value):
    """Persist one complete record before parsing. Caller serializes writers."""
    record = {"schema_version": 1, "captured_at": datetime.now(timezone.utc).isoformat(), **value}
    body = json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    record["record_sha256"] = hashlib.sha256(body.encode()).hexdigest()
    encoded = (json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n").encode()
    fd = os.open(Path(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "ab", closefd=False) as output:
            output.write(encoded)
            output.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def captured_sample(client, prompt, params, emit):
    """Capture exact native arrays on the successful sample boundary, pre-parser.

    Missing logprobs remain null. Invalid raw arrays remain diagnostic evidence;
    consumers must not turn them into valid training probabilities.
    """
    settings = params.model_dump(mode="json")
    emit({"phase": "prepared", "prompt_token_ids": list(prompt.to_ints()),
          "sampling_params": settings, "num_samples": 1,
          "include_prompt_logprobs": False, "topk_prompt_logprobs": 0})
    response = client.sample(prompt, num_samples=1, sampling_params=params).result(timeout=240)
    if len(response.sequences) != 1:
        raise ValueError("Expected exactly one native sample")
    sequence = response.sequences[0]
    emit({"phase": "sampled", "completion_token_ids": list(sequence.tokens),
          "provider_logprobs": None if sequence.logprobs is None else list(sequence.logprobs),
          "stop_reason": sequence.stop_reason,
          "probability_semantics": "provider_reported_not_yet_verified_as_actual_sampler",
          "token_roles": None})
    return sequence
