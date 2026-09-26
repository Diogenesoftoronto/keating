#!/usr/bin/env python3
"""Pinned, gold-free KEV replay. Each checkpoint runs in its own child process.

Public HF snapshots are prepared per model, then inference forces offline loads.
--prepare optionally prefetches all models. Input is {"trials": [{"id",
"requestSha256", "request"}], "parentPlanSha256"?: string}. Outputs are
private JSONL receipts, never learner text on stdout. No GPU provisioning here.
"""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import traceback


CHECKPOINT_PATTERNS = ["*.json", "*.safetensors", "*.pt", "*.txt", "*.jinja"]
BASE_PATTERNS = ["*.json", "*.safetensors", "*.txt", "*.jinja", "*.model"]
VALIDATION_CODES = frozenset({
    "manifest-version", "manifest-variants", "provider-id", "unpinned-revision", "unsupported-context",
    "unsupported-prefix-cache", "requests-shape", "parent-plan-hash", "requests-count-or-duplicate",
    "unexpected-trial-fields", "trial-identity", "wire-request-shape", "wire-question-shape",
    "source-hash-mismatch", "context-truncated", "dependency-version-mismatch", "cuda-unavailable",
    "checkpoint-hash-mismatch", "checkpoint-metadata-mismatch", "checkpoint-base-mismatch",
    "response-model-mismatch", "deadline-out-of-range",
})


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_inputs(manifest_path, requests_path):
    manifest = json.loads(Path(manifest_path).read_text())
    if manifest.get("schemaVersion") != 1:
        raise ValueError("manifest-version")
    variants = manifest["variants"]
    if not variants or len({v["id"] for v in variants}) != len(variants):
        raise ValueError("manifest-variants")
    for v in variants:
        if not re.fullmatch(r"kev-[a-z0-9.-]+", v["id"]):
            raise ValueError("provider-id")
        for field in ("checkpointRevision", "baseRevision"):
            if not re.fullmatch(r"[0-9a-f]{40}", v[field]):
                raise ValueError("unpinned-revision")
    if manifest["context"] != {"stateTokens": 8192, "rowTokens": 8192, "truncationAllowed": False}:
        raise ValueError("unsupported-context")
    if manifest["runtime"].get("prefixCache") != 1:
        raise ValueError("unsupported-prefix-cache")
    payload = json.loads(Path(requests_path).read_text())
    if set(payload) - {"trials", "parentPlanSha256"} or not isinstance(payload.get("trials"), list) or not payload["trials"]:
        raise ValueError("requests-shape")
    if "parentPlanSha256" in payload and not re.fullmatch(r"[0-9a-f]{64}", payload["parentPlanSha256"]):
        raise ValueError("parent-plan-hash")
    trials = payload["trials"]
    if len(trials) > 300 or len({t["id"] for t in trials}) != len(trials):
        raise ValueError("requests-count-or-duplicate")
    for t in trials:
        if set(t) != {"id", "requestSha256", "request"}:
            raise ValueError("unexpected-trial-fields")
        if not isinstance(t["id"], str) or not re.fullmatch(r"[0-9a-f]{64}", t["requestSha256"]):
            raise ValueError("trial-identity")
        r = t["request"]
        if set(r) != {"model", "state", "questions"} or r["model"] != manifest["responseModel"]:
            raise ValueError("wire-request-shape")
        # Nested state is opaque application data. Gold/labels must not be added
        # to the question schema or receipt envelope.
        if not r["questions"] or any(set(q) - {"type", "instructions", "criteria"} for q in r["questions"].values()):
            raise ValueError("wire-question-shape")
    return manifest, trials


def verify_source(source, manifest):
    root = Path(source).resolve()
    for relative, expected in manifest["sourceFilesSha256"].items():
        p = (root / relative).resolve()
        if not p.is_relative_to(root) or not p.is_file() or sha(p) != expected:
            raise ValueError("source-hash-mismatch")


def prepare(manifest):
    # HF uses separate metadata and data read timeouts. These are set before
    # importing its constants, and the outer job controller also has a deadline.
    os.environ.update({"HF_HUB_DOWNLOAD_TIMEOUT": "90", "HF_HUB_ETAG_TIMEOUT": "90"})
    from huggingface_hub import snapshot_download
    import httpx
    seen = set()
    for v in manifest["variants"]:
        for repo, revision, patterns in (
            (v["checkpointRepo"], v["checkpointRevision"], CHECKPOINT_PATTERNS),
            (v["baseRepo"], v["baseRevision"], BASE_PATTERNS),
        ):
            if (repo, revision) not in seen:
                for attempt in range(4):
                    try:
                        snapshot_download(repo, revision=revision, allow_patterns=patterns)
                        break
                    except Exception as error:
                        status = getattr(getattr(error, "response", None), "status_code", None)
                        retryable = status in (429, 500, 502, 503, 504) or isinstance(error, (httpx.TransportError, TimeoutError, ConnectionError))
                        if not retryable or attempt == 3:
                            raise
                        time.sleep(2 ** (attempt + 1))
                seen.add((repo, revision))


def emit(handle, value):
    handle.write(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    handle.flush()
    os.fsync(handle.fileno())


def private_open(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w")


def safe_error(error):
    status = getattr(error, "status_code", None)
    result = {"type": type(error).__name__, **({"status": status} if isinstance(status, int) else {})}
    # Only our exact static literals may enter receipts; never provider error
    # messages, request contents, file paths, URLs, or credentials.
    if type(error) in (ValueError, RuntimeError) and len(error.args) == 1 and isinstance(error.args[0], str) and error.args[0] in VALIDATION_CODES:
        result["code"] = error.args[0]
    if error.__traceback__ is not None:
        result["locations"] = [{"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
                               for frame in traceback.extract_tb(error.__traceback__)[-8:]]
    return result


def context_proof(tok, record, encode, user_tokens, limits):
    state_count = len(user_tokens(tok, record["state"])) + 1
    # Explicit strict=True rejects even an overlong state before upstream's
    # non-strict serving encoder can slice it. No increased context limits.
    try:
        enc = encode(tok, record, max_state=limits["stateTokens"], max_branch=limits["rowTokens"], strict=True)
    except ValueError as error:
        error.context_proof = {"stateTokens": state_count, "stateLimit": limits["stateTokens"],
                               "rowLimit": limits["rowTokens"], "accepted": False, "truncated": False}
        raise
    if enc.get("state_truncated") or enc["seg"].count(0) != state_count:
        raise ValueError("context-truncated")
    branch_lengths = [enc["seg"].count(i + 1) for i in range(len(record["questions"]))]
    return {"stateTokens": state_count, "branchTokens": branch_lengths,
            "maxRowTokens": state_count + max(branch_lengths), "packedTokens": len(enc["ids"]),
            "stateLimit": limits["stateTokens"], "rowLimit": limits["rowTokens"], "truncated": False}


def run_model(args, manifest, trials, variant):
    # Set before importing HF/KEV. No model or tokenizer can resolve moving main.
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                       "KEV_DATE_FACTS": "0", "KEV_PREFIX_CACHE": "1", "KEV_FUSED": "0", "KEV_CUDA_GRAPHS": "0"})
    sys.path.insert(0, str(Path(args.source).resolve()))
    import torch
    from huggingface_hub import snapshot_download
    from kev.api import SystemOneRequest, to_record
    from kev.checkpoint import Checkpoint, LoadOptions
    from kev.model import encode, user_tokens
    from kev.serve import Server

    actual_deps = {k: importlib.metadata.version(k) for k in manifest["dependencies"]}
    # CUDA builds append a local version suffix, e.g. 2.8.0+cu128.
    if any(actual_deps[k].split("+")[0] != expected for k, expected in manifest["dependencies"].items()):
        raise ValueError("dependency-version-mismatch")
    if not torch.cuda.is_available():
        raise RuntimeError("cuda-unavailable")
    # Hub1.32 checks every requested cached file even offline. Preparation
    # intentionally omits README/training logs, so retain exactly its filters.
    checkpoint_dir = snapshot_download(variant["checkpointRepo"], revision=variant["checkpointRevision"], local_files_only=True, allow_patterns=CHECKPOINT_PATTERNS)
    snapshot_download(variant["baseRepo"], revision=variant["baseRevision"], local_files_only=True, allow_patterns=BASE_PATTERNS)
    for filename, expected in variant["weightsSha256"].items():
        if sha(Path(checkpoint_dir) / filename) != expected:
            raise ValueError("checkpoint-hash-mismatch")
    ck = Checkpoint(checkpoint_dir)
    if ck.meta.base != variant["baseRepo"] or ck.meta.temperature != variant["temperature"]:
        raise ValueError("checkpoint-metadata-mismatch")
    if ck.meta.base_revision is None and variant.get("baseRevisionOverride"):
        ck.meta.base_revision = variant["baseRevision"]
    if ck.meta.base_revision != variant["baseRevision"]:
        raise ValueError("checkpoint-base-mismatch")
    opts = LoadOptions(dtype=torch.bfloat16, backend="torch", merge=True, fused=False, cuda_graphs=False)
    tok, model = ck.load("cuda", opts)
    server = Server(ck, tok, model, "cuda", release_date="pinned-benchmark")
    proof = {"checkpointRepo": variant["checkpointRepo"], "checkpointRevision": variant["checkpointRevision"],
             "baseRepo": variant["baseRepo"], "baseRevision": ck.meta.base_revision,
             "baseRevisionOverride": bool(variant.get("baseRevisionOverride")),
             "sourceRevision": manifest["sourceRevision"], "temperature": model.head.temperature,
             "dtype": str(model.dtype), "backend": model.backend, "dependencies": actual_deps,
             "gpu": torch.cuda.get_device_name(0), "quantization": None, "dateFacts": False,
             "prefixCache": {"size": server.prefix_cache.size, "minStateTokens": server.prefix_cache.min_tokens}}
    output = Path(args.output) / (variant["id"] + ".jsonl")
    try:
        with private_open(output) as handle:
            for trial in trials:
                started = time.monotonic()
                receipt = {"trialId": trial["id"], "requestSha256": trial["requestSha256"],
                           "providerId": variant["id"], "identity": proof}
                try:
                    req = SystemOneRequest.model_validate(trial["request"])
                    rec, _ = to_record(req)
                    receipt["contextProof"] = context_proof(tok, rec, encode, user_tokens, manifest["context"])
                    raw = server.answer(req)
                    if raw["model"] != manifest["responseModel"]:
                        raise ValueError("response-model-mismatch")
                    receipt["raw"] = raw
                except Exception as error:
                    receipt["error"] = safe_error(error)
                    if hasattr(error, "context_proof"):
                        receipt["contextProof"] = error.context_proof
                receipt["latencyMs"] = round((time.monotonic() - started) * 1000, 3)
                emit(handle, receipt)
                print(json.dumps({"providerId": variant["id"], "completedTrials": trials.index(trial) + 1,
                                  "status": "error" if "error" in receipt else "ok"}), flush=True)
    finally:
        server.close()
        server.prefix_cache.entries.clear()
        del server, model, tok, ck
        gc.collect()
        torch.cuda.empty_cache()
    # The enclosing process exits now: this releases the CUDA context and all
    # callback references before the next checkpoint process is launched.


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--requests", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--prepare", action="store_true", help="Download pinned public snapshots only; no inference")
    ap.add_argument("--offline", action="store_true", help="Skip per-model preparation; require cached snapshots")
    ap.add_argument("--validate-only", action="store_true", help="Validate source and input; no downloads or inference")
    ap.add_argument("--model-id", help=argparse.SUPPRESS)
    ap.add_argument("--deadline-seconds", type=int, default=2400)
    args = ap.parse_args()
    if not 1 <= args.deadline_seconds <= 3600:
        raise ValueError("deadline-out-of-range")
    manifest, trials = read_inputs(args.manifest, args.requests)
    verify_source(args.source, manifest)
    if args.validate_only:
        print(json.dumps({"validated": True, "variants": len(manifest["variants"]), "trials": len(trials)}))
        return
    if args.prepare:
        prepare({**manifest, "variants": [v for v in manifest["variants"] if not args.model_id or v["id"] == args.model_id]})
        return
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.model_id:
        variant = next(v for v in manifest["variants"] if v["id"] == args.model_id)
        run_model(args, manifest, trials, variant)
        return
    deadline = time.monotonic() + args.deadline_seconds
    with private_open(out / "run-status.jsonl") as status:
        for variant in manifest["variants"]:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                emit(status, {"providerId": variant["id"], "error": "run-deadline"})
                continue
            command = [sys.executable, str(Path(__file__).resolve()), "--manifest", str(Path(args.manifest).resolve()),
                       "--requests", str(Path(args.requests).resolve()), "--source", str(Path(args.source).resolve()),
                       "--output", str(out.resolve()), "--model-id", variant["id"]]
            with private_open(out / (variant["id"] + ".log")) as log:
                for phase in (["inference"] if args.offline else ["prepare", "inference"]):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        emit(status, {"providerId": variant["id"], "error": "run-deadline", "phase": phase})
                        break
                    print(json.dumps({"providerId": variant["id"], "phase": phase}), flush=True)
                    child = subprocess.Popen(command + (["--prepare"] if phase == "prepare" else []), stdout=log, stderr=log, start_new_session=True)
                    try:
                        code = child.wait(timeout=remaining)
                        emit(status, {"providerId": variant["id"], "exitCode": code, "phase": phase})
                        print(json.dumps({"providerId": variant["id"], "phase": phase, "exitCode": code}), flush=True)
                        if code:
                            break
                    except (subprocess.TimeoutExpired, KeyboardInterrupt):
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                        emit(status, {"providerId": variant["id"], "error": "run-deadline-or-interrupt", "phase": phase})
                        return


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        print(json.dumps({"error": safe_error(failure)}), file=sys.stderr)
        sys.exit(1)
