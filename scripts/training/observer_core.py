"""Independent observer primitives. Importing this module does not load torch.

The Qwen-Scope affine + signed Top-K convention is documented at
https://huggingface.co/Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50 .
No inference, downloads, labels, or runtime writes happen at import time.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import math


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


@dataclass(frozen=True)
class SAESpec:
    hidden: int = 4096
    width: int = 65536
    top_k: int = 50

    def __post_init__(self):
        if any(type(x) is not int or x < 1 for x in (self.hidden, self.width, self.top_k)):
            raise ValueError("SAE dimensions must be positive integers")
        if self.top_k > self.width:
            raise ValueError("Top-K exceeds dictionary width")


def residual_tensor(output):
    import torch
    h = output[0] if isinstance(output, tuple) and output else output
    if not isinstance(h, torch.Tensor) or h.ndim != 3 or not h.is_floating_point():
        raise ValueError("Expected floating residual [batch, tokens, hidden]")
    if not torch.isfinite(h).all():
        raise ValueError("Non-finite residual")
    return h


def capture_residual(model, block, batch):
    """One full forward, no cache; always remove hook and restore training flags.

Returns an independent CPU copy, preserving the batch dimension for both tensor
and tuple block outputs. The caller must choose the actual post-block module.
"""
    import torch
    if not any(module is block for module in model.modules()):
        raise ValueError("Block does not belong to this observer")
    captured = []
    flags = [(module, module.training) for module in model.modules()]

    def hook(_module, _inputs, output):
        captured.append(residual_tensor(output).detach().to("cpu", copy=True))

    handle = block.register_forward_hook(hook)
    try:
        model.eval()
        with torch.inference_mode():
            model(**{**batch, "use_cache": False})
    finally:
        handle.remove()
        for module, flag in flags:
            module.training = flag
    if len(captured) != 1:
        raise ValueError(f"Expected one selected-block invocation, got {len(captured)}")
    return captured[0]


def validate_sae(state, spec=SAESpec()):
    import torch
    shapes = {"W_enc": (spec.width, spec.hidden), "b_enc": (spec.width,),
              "W_dec": (spec.hidden, spec.width), "b_dec": (spec.hidden,)}
    if not isinstance(state, dict) or set(state) != set(shapes):
        raise ValueError("Expected exactly W_enc, b_enc, W_dec, b_dec")
    for key, shape in shapes.items():
        value = state[key]
        if not isinstance(value, torch.Tensor) or tuple(value.shape) != shape:
            raise ValueError(f"{key} must have shape {shape}")
        if not value.is_floating_point() or not torch.isfinite(value).all():
            raise ValueError(f"{key} must contain finite floating values")
    return state


def encode_topk(h, state, spec=SAESpec(), *, chunk_tokens=128):
    """Return sparse indices/values; never allocate tokens × width across all tokens.

Official convention: pre = h @ W_enc.T + b_enc, then signed topk.
No ReLU, no b_dec subtraction. Zero retained values remain explicit entries.
    The complete loaded dictionary is validated before encoding.
"""
    import torch
    validate_sae(state, spec)
    if type(chunk_tokens) is not int or chunk_tokens < 1:
        raise ValueError("chunk_tokens must be positive")
    if h.ndim < 2 or h.shape[-1] != spec.hidden or h.numel() == 0:
        raise ValueError("Hidden-state shape does not match SAE")
    w, b = state["W_enc"], state["b_enc"]
    if tuple(w.shape) != (spec.width, spec.hidden) or tuple(b.shape) != (spec.width,):
        raise ValueError("Encoder shape does not match SAE")
    if not h.is_floating_point() or not torch.isfinite(h).all():
        raise ValueError("Hidden states must be finite floating values")
    indices, values = [], []
    with torch.inference_mode():
        flat = h.reshape(-1, spec.hidden)
        for start in range(0, len(flat), chunk_tokens):
            pre = flat[start:start + chunk_tokens].to(w) @ w.T + b.to(w)
            if not torch.isfinite(pre).all():
                raise ValueError("Non-finite SAE preactivation")
            val, idx = pre.topk(spec.top_k, dim=-1)
            indices.append(idx.cpu())
            values.append(val.float().cpu())
    shape = (*h.shape[:-1], spec.top_k)
    return torch.cat(indices).reshape(shape), torch.cat(values).reshape(shape)


def intervention_directions(state, feature, spec=SAESpec(), *, seed=0):
    """Unit decoder direction and seeded norm-matched random control, on CPU."""
    import torch
    validate_sae(state, spec)
    if type(feature) is not int or not 0 <= feature < spec.width:
        raise ValueError("Feature outside dictionary")
    chosen = state["W_dec"][:, feature].detach().float().cpu()
    if chosen.norm() == 0:
        raise ValueError("Cannot intervene with a zero decoder direction")
    random = torch.randn(spec.hidden, generator=torch.Generator().manual_seed(seed))
    return {"feature": chosen / chosen.norm(), "opposite": -chosen / chosen.norm(),
            "random": random / random.norm()}


def residual_scale(calibration_residuals):
    """Median vector norm, computed only on selected calibration tokens."""
    import torch
    if calibration_residuals.ndim < 2 or not calibration_residuals.numel():
        raise ValueError("Nonempty token vectors required")
    if not torch.isfinite(calibration_residuals).all():
        raise ValueError("Non-finite calibration residuals")
    scale = calibration_residuals.detach().float().norm(dim=-1).median().item()
    if scale <= 0:
        raise ValueError("Positive calibration residual scale required")
    return scale


@contextmanager
def intervene(block, direction, *, epsilon, scale, token_mask):
    """Patch selected post-block vectors; caller supplies mask for each invocation.

token_mask is a bool tensor [batch, tokens], or callable(h) returning one.
Generation changes token lengths: supply a callable for that use. This helper
does not generate text or score its behavior. Always removes the hook.
"""
    import torch
    if not all(math.isfinite(x) for x in (epsilon, scale)) or scale <= 0:
        raise ValueError("Finite epsilon and positive finite scale required")
    if direction.ndim != 1 or not torch.isfinite(direction).all() or direction.norm() == 0:
        raise ValueError("Finite nonzero vector required")
    unit = direction.detach().float() / direction.detach().float().norm()

    def hook(_module, _inputs, output):
        h = residual_tensor(output)
        mask = token_mask(h) if callable(token_mask) else token_mask
        if mask.dtype != torch.bool or tuple(mask.shape) != tuple(h.shape[:2]):
            raise ValueError("Intervention mask must be bool [batch, tokens]")
        if h.shape[-1] != len(unit):
            raise ValueError("Direction does not match residual width")
        patched = h + mask.to(h.device).unsqueeze(-1) * unit.to(h) * (epsilon * scale)
        return (patched, *output[1:]) if isinstance(output, tuple) else patched

    handle = block.register_forward_hook(hook)
    try:
        yield
    finally:
        handle.remove()


TEMPLATE = "keating-observer-public-events-v1: [kind]\\ntext\\n"
PHASES = {"pre_action": 0, "delivered": 1, "retrospective": 2}
KINDS = {"learner_message", "actor_message", "delivered_artifact"}


def boundary_view(record):
    """Validate an independent projection request; serialize ONLY allowed events.

Labels, metadata, assessments and future events never enter observer text.
This is not the runtime ledger schema: the parent must project authoritative
receipts into this explicit adapter contract, as documented in observer-pipeline.
"""
    for key in ("record_id", "family_id", "latest_allowed_event_id"):
        if not isinstance(record.get(key), str) or not record[key]:
            raise ValueError(f"Missing {key}")
    boundary = record.get("boundary")
    if boundary not in PHASES:
        raise ValueError("Unknown observation boundary")
    events = record.get("events", [])
    ids = [e.get("event_id") for e in events]
    if not ids or any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
        raise ValueError("Event IDs must be nonempty and unique")
    if record["latest_allowed_event_id"] not in ids:
        raise ValueError("Unmapped latest event")
    cut = ids.index(record["latest_allowed_event_id"])
    selected = events[:cut + 1]
    if selected[-1].get("phase") != boundary or selected[-1].get("visibility") != "public":
        raise ValueError("Latest event does not establish requested public boundary")
    text, ranges, previous = "", {}, -1
    for event in selected:
        phase = event.get("phase")
        if phase not in PHASES or not previous <= PHASES[phase] <= PHASES[boundary]:
            raise ValueError("Noncausal event phase order")
        previous = PHASES[phase]
        if event.get("visibility") == "private":
            continue
        if event.get("visibility") != "public" or event.get("kind") not in KINDS:
            raise ValueError("Unapproved public event kind/visibility")
        content = event.get("text")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Missing semantic text; visual-only observations unsupported")
        if event["kind"] == "delivered_artifact" and not event.get("receipt_id"):
            raise ValueError("Artifact requires an authoritative delivery receipt ID")
        text += f"[{event['kind']}]\n"
        ranges[event["event_id"]] = (len(text), content, phase)
        text += content + "\n"
    spans = []
    for span in record.get("spans", []):
        if span.get("event_id") not in ranges:
            raise ValueError("Span references private, future or unmapped event")
        offset, content, phase = ranges[span["event_id"]]
        start, end = span.get("start"), span.get("end")
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(content):
            raise ValueError("Invalid character span")
        if phase != boundary:
            raise ValueError("Pooling span must belong to requested phase")
        spans.append({"event_id": span["event_id"], "start": offset + start, "end": offset + end})
    if not spans:
        raise ValueError("Explicit nonempty pooling spans required")
    return {"text": text, "spans": spans, "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "template_sha256": hashlib.sha256(TEMPLATE.encode()).hexdigest(),
            "boundary": boundary, "latest_allowed_event_id": record["latest_allowed_event_id"],
            "included_event_ids": list(ranges)}


def token_spans(text, offsets, spans, attention_mask):
    """Map exact Unicode character spans to full, non-padding tokenizer tokens.

Reject cut tokens and uncovered non-whitespace characters. Do not approximate
indices across tokenizers. Special tokens with (0, 0) offsets are never pooled.
"""
    if len(offsets) != len(attention_mask):
        raise ValueError("Offset/mask length mismatch")
    selected = set()
    for span in spans:
        start, end = span["start"], span["end"]
        if not 0 <= start < end <= len(text):
            raise ValueError("Span outside serialized input")
        covered = set()
        for i, ((a, b), active) in enumerate(zip(offsets, attention_mask)):
            if not 0 <= a <= b <= len(text) or active not in (0, 1):
                raise ValueError("Invalid tokenizer offsets or attention mask")
            if not active or a == b or b <= start or a >= end:
                continue
            if a < start or b > end:
                raise ValueError("Span cuts through a token; supply exact aligned boundaries")
            selected.add(i)
            covered.update(range(a, b))
        if any(i not in covered and not text[i].isspace() for i in range(start, end)):
            raise ValueError("Span cannot be fully mapped to tokenizer offsets")
    if not selected:
        raise ValueError("No observed tokens in requested spans")
    return sorted(selected)
