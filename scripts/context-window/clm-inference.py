#!/usr/bin/env python3
"""Pinned CLM replay on the original vLLM image, before other dependency installs.

No provisioning or package upgrades. Public artifacts are pinned; gold-free
requests are evaluated only through owned loopback services. Raw receipts/logs
are private. Every exit stops the owned encoder and CLM process groups.
"""
import argparse
import hashlib
import http.client
import importlib.metadata
import io
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import ssl
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
import zipfile

SOURCE_REVISION = "0a3a319c1a242339903db575e160e9a8d84b9ce8"
SOURCE_ARCHIVE_SHA256 = "76b1554fc24229b1e23319707c4af8f45fababed07076b3e82a59138d69a68b2"
HEAD_REPO = "Contrastive-LM/CLM-v0.1-8B"
HEAD_REVISION = "87655cb835bd76fd66c2da78e1e3709f7fa11a94"
HEAD_FILE = "CLM_v0.1-8B.pt"
HEAD_SHA256 = "b2b4a8c9c2d39263eff78a351eb909a342ce9b3bf21a3f07c1d1bf15f1c4eda5"
ENCODER_REPO = "Qwen/Qwen3-8B"
ENCODER_REVISION = "b968826d9c46dd6066d109eabc6255188de91218"
IMAGE = "vllm/vllm-openai@sha256:2c908d5a84ed251b6a17d179f42d06df1aff353007779ac5eecd8a0ea3fe9331"
VLLM_VERSION = "0.11.2+cu129"
MODEL = "clm-latest"
PROVIDER = "clm-multilingual"
CONTEXT_LIMIT = 32768


class Rejected(ValueError):
    """Only runner-owned static error codes; no caller/provider text."""


def private_open(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w")


def emit(handle, value):
    handle.write(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    handle.flush()
    os.fsync(handle.fileno())


def safe_error(error):
    result = {"type": type(error).__name__}
    if type(error) is Rejected:
        result["code"] = error.args[0]
    if isinstance(error, urllib.error.HTTPError):
        result["status"] = error.code
    if error.__traceback__:
        result["locations"] = [{"file": Path(f.filename).name, "line": f.lineno, "function": f.name}
                               for f in traceback.extract_tb(error.__traceback__)[-8:]]
    return result


def read_requests(path):
    payload = json.loads(Path(path).read_text())
    if set(payload) != {"parentPlanSha256", "trials"} or not re.fullmatch(r"[0-9a-f]{64}", payload["parentPlanSha256"]):
        raise Rejected("input-envelope")
    trials = payload["trials"]
    if not isinstance(trials, list) or not 1 <= len(trials) <= 300:
        raise Rejected("trial-count")
    ids = set()
    for trial in trials:
        if set(trial) != {"id", "requestSha256", "request"}:
            raise Rejected("trial-fields")
        if not isinstance(trial["id"], str) or trial["id"] in ids or not re.fullmatch(r"[0-9a-f]{64}", trial["requestSha256"]):
            raise Rejected("trial-identity")
        ids.add(trial["id"])
        req = trial["request"]
        if not isinstance(req, dict) or set(req) != {"model", "state", "questions"}:
            raise Rejected("request-fields")
        if req["model"] != MODEL or not isinstance(req["questions"], dict) or not req["questions"]:
            raise Rejected("request-model-or-questions")
        for q in req["questions"].values():
            if not isinstance(q, dict) or set(q) - {"type", "instructions", "criteria"} or q.get("type") not in ("noul", "choice", "score"):
                raise Rejected("question-fields")
    return payload


def transient(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code in (408, 425, 429, 500, 502, 503, 504)
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, ssl.SSLCertVerificationError):
        return False
    return isinstance(error, urllib.error.URLError) or isinstance(reason, (TimeoutError, ConnectionError, socket.gaierror, http.client.IncompleteRead))


def download(url, expected_hash, opener=None, sleep=None):
    opener, sleep = opener or urllib.request.urlopen, sleep or time.sleep
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curl/8.14.1"})
            with opener(req, timeout=90) as response:
                data = response.read(128 * 1024 * 1024 + 1)
                declared = response.headers.get("Content-Length")
                if declared and declared.isdecimal() and len(data) < int(declared):
                    raise http.client.IncompleteRead(data, int(declared) - len(data))
            if len(data) > 128 * 1024 * 1024:
                raise Rejected("artifact-size-limit")
            if hashlib.sha256(data).hexdigest() != expected_hash:
                raise Rejected("artifact-hash-mismatch")
            return data
        except Exception as error:
            if attempt == 3 or not transient(error):
                raise
            sleep(2 ** (attempt + 1))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def local_json(url, body=None, key=None, timeout=300):
    if not url.startswith(("http://127.0.0.1:8090/", "http://127.0.0.1:8700/")):
        raise Rejected("non-loopback-url")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(url, data=None if body is None else json.dumps(body, ensure_ascii=False).encode(), headers=headers)
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=timeout) as response:
        return json.load(response)


def wait_ready(url, children, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(child.poll() is not None for child in children):
            raise Rejected("service-exited-before-ready")
        try:
            return local_json(url, timeout=5)
        except Rejected:
            raise
        except (OSError, ValueError):
            time.sleep(2)
    raise Rejected("service-ready-timeout")


def stop_children(children):
    for child in reversed(children):
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for child in reversed(children):
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=10)


def context_proof(request, tokenizer, build_pairs):
    pairs = build_pairs(request["state"], request["questions"])
    counts = {}
    for qid, (state, _, candidates) in pairs.items():
        counts[qid] = {"stateQuestionTokens": len(tokenizer.encode(state, add_special_tokens=True)),
                       "candidateTokens": [len(tokenizer.encode(text, add_special_tokens=True)) for text in candidates]}
    maximum = max(n for c in counts.values() for n in [c["stateQuestionTokens"], *c["candidateTokens"]])
    return {"fullContext": maximum <= CONTEXT_LIMIT, "truncated": False, "maxTokens": maximum,
            "encoderLimit": CONTEXT_LIMIT, "truncatePromptTokens": None, "addSpecialTokens": True,
            "questionTokens": counts}


def services(root, log, children):
    for port in (8090, 8700):
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise Rejected("service-port-occupied")
    if importlib.metadata.version("vllm") != VLLM_VERSION:
        raise Rejected("vllm-version-mismatch")
    source_zip = download("https://codeload.github.com/Contrastive-LM/CLM/zip/" + SOURCE_REVISION, SOURCE_ARCHIVE_SHA256)
    with zipfile.ZipFile(io.BytesIO(source_zip)) as archive:
        # The whole archive is hash-pinned; also refuse paths outside this job.
        for member in archive.namelist():
            if not (root / member).resolve().is_relative_to(root.resolve()):
                raise Rejected("unsafe-source-archive")
        archive.extractall(root)
    source = root / ("CLM-" + SOURCE_REVISION)
    checkpoint = root / HEAD_FILE
    checkpoint.write_bytes(download("https://huggingface.co/" + HEAD_REPO + "/resolve/" + HEAD_REVISION + "/" + HEAD_FILE, HEAD_SHA256))
    checkpoint.chmod(0o600)
    environment = {**os.environ, "HF_HUB_DOWNLOAD_TIMEOUT": "90", "HF_HUB_ETAG_TIMEOUT": "90",
                   "HF_HUB_DISABLE_TELEMETRY": "1", "TOKENIZERS_PARALLELISM": "false",
                   "PYTHONPATH": str(source / "src"), "PYTHONUNBUFFERED": "1"}
    encoder_args = ["vllm", "serve", ENCODER_REPO, "--revision", ENCODER_REVISION,
                    "--tokenizer-revision", ENCODER_REVISION, "--served-model-name", "qwen3-8b", "--runner", "pooling",
                    "--dtype", "bfloat16", "--pooler-config", '{"pooling_type":"LAST"}',
                    "--max-model-len", str(CONTEXT_LIMIT), "--gpu-memory-utilization", "0.80", "--max-num-seqs", "2",
                    "--enforce-eager", "--host", "127.0.0.1", "--port", "8090", "--disable-log-requests"]
    encoder = subprocess.Popen(encoder_args, env=environment, stdout=log, stderr=log, start_new_session=True)
    children.append(encoder)
    encoder_models = wait_ready("http://127.0.0.1:8090/v1/models", children, 1200)
    if not any(m.get("id") == "qwen3-8b" and m.get("max_model_len") == CONTEXT_LIMIT for m in encoder_models.get("data", [])):
        raise Rejected("encoder-model-identity")
    key = secrets.token_urlsafe(32)
    environment["CLM_API_KEY"] = key
    clm_args = [sys.executable, "-m", "clm.server", "--host", "127.0.0.1", "--port", "8700",
                "--emb-url", "http://127.0.0.1:8090/v1/embeddings", "--emb-model", "qwen3-8b",
                "--ckpt", str(checkpoint), "--max-tokens", "0", "--action-cache", "0", "--no-ui", "--no-download", "--device", "cuda"]
    children.append(subprocess.Popen(clm_args, env=environment, stdout=log, stderr=log, start_new_session=True))
    health = wait_ready("http://127.0.0.1:8700/health", children, 120)
    if health.get("ok") is not True or health.get("embedder") is not True or health.get("mock") or MODEL not in health.get("models", []):
        raise Rejected("clm-health-identity")
    model_cards = local_json("http://127.0.0.1:8700/v1/models", key=key, timeout=10)
    if MODEL not in [m.get("name") for m in model_cards.get("models", [])]:
        raise Rejected("clm-model-identity")
    sys.path.insert(0, str(source / "src"))
    from clm.schema import build_pairs
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(ENCODER_REPO, revision=ENCODER_REVISION, local_files_only=True)
    # This only tokenizes public text. It does not run model inference.
    parity_text = "English español français العربية हिन्दी 中文"
    parity = local_json("http://127.0.0.1:8090/tokenize", {"model": "qwen3-8b", "prompt": parity_text, "add_special_tokens": True}, timeout=10)
    if parity.get("tokens") != tokenizer.encode(parity_text, add_special_tokens=True):
        raise Rejected("tokenizer-parity-mismatch")
    versions = {name: importlib.metadata.version(name) for name in ("vllm", "torch", "transformers", "tokenizers", "huggingface-hub", "numpy", "fastapi")}
    identity = {"sourceRevision": SOURCE_REVISION, "sourceArchiveSha256": SOURCE_ARCHIVE_SHA256,
                "headRepo": HEAD_REPO, "headRevision": HEAD_REVISION, "headSha256": HEAD_SHA256,
                "encoderRepo": ENCODER_REPO, "encoderRevision": ENCODER_REVISION, "image": IMAGE,
                "dependencies": versions, "dtype": "bfloat16", "pooling": "LAST", "maxModelLen": CONTEXT_LIMIT,
                "maxNumSeqs": 2, "enforceEager": True, "actionCache": 0, "temperature": 1.0,
                "embedderCacheSize": 200000, "tokenizerParityVerified": True, "health": health}
    return key, tokenizer, build_pairs, identity


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--requests", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--workdir", required=True)
    ap.add_argument("--deadline-seconds", type=int, default=2400)
    ap.add_argument("--validate-only", action="store_true")
    args = ap.parse_args()
    payload = read_requests(args.requests)
    if not 1 <= args.deadline_seconds <= 7200:
        raise Rejected("deadline-range")
    if args.validate_only:
        print(json.dumps({"validated": True, "trials": len(payload["trials"]), "sourceRevision": SOURCE_REVISION}))
        return
    root = Path(args.workdir).resolve()
    root.mkdir(parents=True, exist_ok=False, mode=0o700)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    children = []
    def interrupted(signum, frame):
        raise Rejected("job-deadline-or-interrupted")
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM):
        signal.signal(sig, interrupted)
    signal.setitimer(signal.ITIMER_REAL, args.deadline_seconds)
    try:
        with private_open(root / "service.log") as log, private_open(output) as receipts:
            print(json.dumps({"phase": "starting", "trials": len(payload["trials"])}), flush=True)
            key, tokenizer, build_pairs, identity = services(root, log, children)
            print(json.dumps({"phase": "ready", "providerId": PROVIDER}), flush=True)
            for index, trial in enumerate(payload["trials"]):
                started = time.monotonic()
                row = {"trialId": trial["id"], "requestSha256": trial["requestSha256"], "parentPlanSha256": payload["parentPlanSha256"],
                       "providerId": PROVIDER, "identity": identity}
                try:
                    if any(child.poll() is not None for child in children):
                        raise Rejected("service-exited-during-run")
                    row["contextProof"] = context_proof(trial["request"], tokenizer, build_pairs)
                    if not row["contextProof"]["fullContext"]:
                        raise Rejected("context-overflow")
                    raw = local_json("http://127.0.0.1:8700/v1/systemone", trial["request"], key=key)
                    if raw.get("model") != MODEL or set(raw.get("answers", {})) != set(trial["request"]["questions"]):
                        raise Rejected("response-identity-or-question-set")
                    row["raw"] = raw
                except Rejected as error:
                    if error.args[0] == "job-deadline-or-interrupted":
                        raise
                    row["error"] = safe_error(error)
                except Exception as error:
                    row["error"] = safe_error(error)
                row["latencyMs"] = round((time.monotonic() - started) * 1000, 3)
                emit(receipts, row)
                print(json.dumps({"phase": "inference", "completed": index + 1, "status": "error" if "error" in row else "ok"}), flush=True)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        stop_children(children)
        print(json.dumps({"phase": "stopped", "childrenExited": all(child.poll() is not None for child in children)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": safe_error(error)}), file=sys.stderr, flush=True)
        sys.exit(1)
