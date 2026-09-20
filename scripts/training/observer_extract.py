# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.8.0+cpu", "transformers==5.3.0", "numpy==2.2.6"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Explicit, local-first Qwen observer extraction; no providers or policy updates.

Run with --help. All projection requests are checked before loading any weights.
--allow-download is required to fetch missing pinned model/SAE snapshots.
"""
import argparse
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import re

from observer_core import (SAESpec, TEMPLATE, boundary_view, canonical, capture_residual,
                           digest, encode_topk, token_spans, validate_sae)
from observer_models import DEFAULT_PROFILE, PROFILES, extraction_profile, get_profile

# Compatibility aliases for legacy callers; these always denote 9B.
MODEL = get_profile().model
DICTIONARY = get_profile().dictionary
CARD = get_profile().card


def file_hash(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def pinned_revision(value):
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise argparse.ArgumentTypeError("Use a full immutable 40-character Hub commit SHA")
    return value


def extract_record(model, tokenizer, block, state, record, manifest, *, spec=SAESpec(), max_tokens=4096):
    """Injected model/tokenizer seam, also exercised with tiny CPU models in tests."""
    view = boundary_view(record)
    encoded = tokenizer(view["text"], return_tensors="pt", return_offsets_mapping=True,
                        add_special_tokens=False, truncation=False)
    offsets = encoded.pop("offset_mapping")[0].tolist()
    if encoded["input_ids"].shape[0] != 1 or len(offsets) > max_tokens:
        raise ValueError("One untruncated bounded observation per extraction required")
    if "attention_mask" not in encoded:
        raise ValueError("Tokenizer must supply an attention mask")
    selected = token_spans(view["text"], offsets, view["spans"], encoded["attention_mask"][0].tolist())
    device = next(model.parameters()).device
    residual = capture_residual(model, block, {k: v.to(device) for k, v in encoded.items()})
    if tuple(residual.shape) != (1, len(offsets), spec.hidden):
        raise ValueError("Captured tensor does not match observer/tokenizer dimensions")
    h = residual[0, selected]
    indices, values = encode_topk(h, state, spec)
    pooled = {}
    for idx, val in zip(indices.tolist(), values.tolist()):
        for k, v in zip(idx, val):
            pooled[k] = pooled.get(k, 0.0) + v / len(selected)
    sparse_tokens = [{"token_index": token, "character_offsets": offsets[token],
                      "indices": idx, "values": val}
                     for token, idx, val in zip(selected, indices.tolist(), values.tolist())]
    row = {k: record[k] for k in ("record_id", "family_id", "boundary")}
    if "split" in record:
        if record["split"] not in {"train", "calibration", "test"}:
            raise ValueError("Invalid preregistered split")
        row["split"] = record["split"]
    row.update({"text": view["text"], "view": view, "input_token_ids": encoded["input_ids"][0].tolist(),
                "pooling": "mean_of_unique_selected_tokens", "selected_token_indices": selected,
                "raw": h.float().mean(dim=0).tolist(), "sae": {str(k): v for k, v in sorted(pooled.items())},
                "sae_width": spec.width, "sparse_tokens": sparse_tokens,
                "observer_manifest_sha256": digest(manifest), "record_sha256": digest(record),
                "source": record.get("source", "unspecified"), "labels": record.get("labels", {}),
                "group_ids": record.get("group_ids", []),
                "label_provenance": record.get("label_provenance", {})})
    # Serialization also rejects nonfinite label values rather than hiding them.
    canonical(row)
    return row


def load_observer(args):
    profile = extraction_profile(args)
    spec = profile.spec
    import torch
    from huggingface_hub import hf_hub_download, snapshot_download
    from transformers import AutoConfig, AutoModel, AutoTokenizer
    local = not args.allow_download
    model_dir = Path(snapshot_download(profile.model, revision=args.model_revision, local_files_only=local,
                                      allow_patterns=["*.safetensors", "*.json"]))
    tokenizer_dir = Path(snapshot_download(profile.model, revision=args.tokenizer_revision, local_files_only=local,
                                          allow_patterns=["*.json", "*.txt", "*.model", "*.jinja"]))
    sae_path = Path(hf_hub_download(profile.dictionary, f"layer{args.layer}.sae.pt",
                                   revision=args.sae_revision, local_files_only=local))
    actual_sae_hash = file_hash(sae_path)
    if actual_sae_hash != args.sae_sha256:
        raise ValueError("SAE bytes do not match the pinned layer hash")
    state = torch.load(sae_path, map_location="cpu", weights_only=True)
    validate_sae(state, spec)
    config = AutoConfig.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    profile.validate_config(config)
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir, local_files_only=True, use_fast=True,
                                              trust_remote_code=False)
    if not tokenizer.is_fast:
        raise ValueError("Fast tokenizer required for exact character offsets")
    dtype = getattr(torch, args.dtype)
    # AutoModel avoids materializing all vocabulary logits during observation.
    # This loads the declared checkpoint without an actor adapter or remote code.
    model, loading = AutoModel.from_pretrained(model_dir, config=config, local_files_only=True,
                                               trust_remote_code=False, dtype=dtype, output_loading_info=True)
    if loading.get("missing_keys") or loading.get("mismatched_keys") or loading.get("error_msgs"):
        raise ValueError("Observer weights did not load completely; refusing random or mismatched parameters")
    model = model.to(args.device).eval().requires_grad_(False)
    block = model.get_submodule(args.module)
    if type(block).__name__ != "Qwen3_5DecoderLayer":
        raise ValueError("Selected module is not a Qwen3.5 residual decoder block")
    state = {k: v.to(device=args.device, dtype=dtype) for k, v in state.items()}
    model_files = sorted(model_dir.glob("*.safetensors"))
    if not model_files:
        raise ValueError("No safetensors observer weights found")
    manifest = {
        "schema_version": 1, "evidence": "model_extraction", "observer_profile": profile.name,
        "observer_model": profile.model,
        "observer_revision": args.model_revision, "tokenizer_model": profile.model,
        "tokenizer_revision": args.tokenizer_revision, "sae_model": profile.dictionary,
        "sae_revision": args.sae_revision, "sae_file": sae_path.name, "sae_sha256": actual_sae_hash,
        "module": args.module, "layer": args.layer, "hook": "residual_post_block",
        "dtype": args.dtype, "sae_dtype": args.dtype, "device": args.device,
        "dimensions": profile.dimensions,
        "encoding": "affine_then_signed_topk_no_relu_no_centering", "model_card": profile.card,
        "pooling": "mean_of_unique_selected_tokens", "max_tokens": args.max_tokens,
        "truncation": False, "template": TEMPLATE,
        "template_sha256": hashlib.sha256(TEMPLATE.encode()).hexdigest(),
        "chat_template_applied": False, "tokenizer_chat_template_sha256": digest(tokenizer.chat_template),
        "model_files_sha256": {p.name: file_hash(p) for p in model_files},
        "config_sha256": file_hash(model_dir / "config.json"),
        # Transformers 5 returns a set here. Store deterministic JSON metadata;
        # the unused LM head is expected when capturing AutoModel residuals.
        "unused_checkpoint_keys": sorted(loading.get("unexpected_keys", [])),
        "implementation_files_sha256": {p.name: file_hash(p) for p in
                                           (Path(__file__), Path(__file__).with_name("observer_core.py"),
                                            Path(__file__).with_name("observer_models.py"))},
        "tokenizer_files_sha256": {p.name: file_hash(p) for p in sorted(tokenizer_dir.iterdir())
                                    if p.is_file() and p.suffix in {".json", ".txt", ".model", ".jinja"}},
        "software": {p: version(p) for p in ("torch", "transformers", "numpy", "tokenizers")},
        "limitations": ["Text-only observation; no browser or visual grounding established.",
                        "Features are model evidence, not measurements of a learner's mind."]}
    return model, tokenizer, block, state, manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON: {records: [projection requests]}")
    parser.add_argument("output", type=Path, help="New JSON artifact; refuses overwrite")
    parser.add_argument("--profile", choices=tuple(PROFILES), default=DEFAULT_PROFILE,
                        help="Exact frozen observer/dictionary pair (default: %(default)s)")
    parser.add_argument("--model-revision", type=pinned_revision, required=True)
    parser.add_argument("--tokenizer-revision", type=pinned_revision, required=True)
    parser.add_argument("--sae-revision", type=pinned_revision, required=True)
    parser.add_argument("--sae-sha256", required=True)
    parser.add_argument("--layer", type=int, required=True, help="9B: 0–31; 27B: 0–63")
    parser.add_argument("--module", required=True, help="Exact post-block path in AutoModel")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--dtype", choices=("float32", "bfloat16"), default="float32")
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--allow-download", action="store_true", help="Explicitly fetch missing pinned weights")
    parser.add_argument("--validate-only", action="store_true", help="Check projections; load no model")
    args = parser.parse_args(argv)
    if args.max_tokens < 1 or not re.fullmatch(r"[a-f0-9]{64}", args.sae_sha256):
        parser.error("Positive token bound and full SHA-256 required")
    try:
        profile = extraction_profile(args)
    except ValueError as error:
        parser.error(str(error))
    body = json.loads(args.input.read_text())
    records = body["records"]
    if not records or len({r["record_id"] for r in records}) != len(records):
        raise ValueError("Nonempty unique observation records required")
    for record in records:
        boundary_view(record)
    if args.validate_only:
        print(canonical({"valid_records": len(records), "weights_loaded": False,
                         "observer_profile": profile.name, "observer_model": profile.model,
                         "sae_model": profile.dictionary, "dimensions": profile.dimensions}))
        return
    if args.output.exists():
        raise FileExistsError(args.output)
    model, tokenizer, block, state, manifest = load_observer(args)
    rows = [extract_record(model, tokenizer, block, state, r, manifest, spec=profile.spec,
                           max_tokens=args.max_tokens) for r in records]
    result = {"manifest": manifest, "manifest_sha256": digest(manifest), "input_sha256": file_hash(args.input),
              "rows": rows}
    with args.output.open("x") as stream:
        stream.write(canonical(result) + "\n")
    print(canonical({"output": str(args.output), "records": len(rows), "manifest_sha256": digest(manifest)}))


if __name__ == "__main__":
    main()
