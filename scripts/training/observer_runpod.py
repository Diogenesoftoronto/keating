# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["certifi==2026.7.22"]
# ///
"""Prepare, quote and supervise one owned Runpod REST v2 observer job.

prepare is offline. quote reads RUNPOD_API_KEY only when explicitly invoked.
run requires the reviewed plan hash; creation is attempted at most once per job.
No credentials, whole repositories or private assessment fields enter the bundle.
"""
import argparse
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
import fcntl
import hashlib
import io
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import shlex
import signal
import ssl
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from observer_core import boundary_view, canonical, digest

API = "https://api.runpod.io/v2"
SPEC_SHA256 = "a7d7eb5239506ae49091be1f2435af8757b392d3c346fd6c5b118b7c49fc6f4c"
GPU = "NVIDIA L40S"
IMAGE_TAG = "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404"
IMAGE = "runpod/pytorch@sha256:0a360022e8de4375af99430f84e8b38951acc397252163a37ceac7204d01be35"
MODEL_REVISION = "68c46c4b3498877f3ef123c856ecfde50c39f404"
SAE_REVISION = "7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8"
SAE_HASH = "2cea61ef74a4d33d59329f7e3d1ddfb4a8cdf3c24acdbc05fc26209679a262d8"
SOURCE_NAMES = ("observer_core.py", "observer_extract.py", "observer_models.py")
MAX_INPUT = 2 * 1024 * 1024
MAX_EXPORT = 128 * 1024 * 1024
MAX_TOKENS = 4096  # Complete short native episodes; reject overflow, never truncate.
RESERVE_SECONDS = 180
QUOTE_TTL = 900
# Conservative 28-day month, not a claimed provider billing conversion.
RUNNING_STORAGE_RATE = Decimal("9") / Decimal(672)  # 80GB volume + 10GB container
STOPPED_STORAGE_RATE = Decimal("16") / Decimal(672)  # 80GB volume, $0.20/GB/month


def sha(body):
    return hashlib.sha256(body).hexdigest()


def positive(value):
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ValueError("Expected finite positive numeric limit") from None
    if not number.is_finite() or number <= 0:
        raise ValueError("Expected finite positive numeric limit")
    return number


def write_json(path, value, *, exclusive=False):
    body = (canonical(value) + "\n").encode()
    if exclusive:
        with path.open("xb") as out:
            os.chmod(path, 0o600)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
    else:
        temporary = path.with_suffix(".tmp")
        with temporary.open("wb") as out:
            os.chmod(temporary, 0o600)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def regular_bytes(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError(f"Expected bounded regular file: {path.name}")
    return path.read_bytes()


def archive_bytes(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, body in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(body), 0o600, 0
            archive.addfile(info, io.BytesIO(body))
    return buffer.getvalue()


def read_archive(body, allowed, limit):
    if len(body) > limit:
        raise ValueError("Archive exceeds byte limit")
    files, total = {}, 0
    with tarfile.open(fileobj=io.BytesIO(body), mode="r:") as archive:
        for member in archive:
            total += member.size
            if (member.name not in allowed or member.name in files or not member.isfile()
                    or member.size < 0 or total > limit):
                raise ValueError("Unapproved, duplicate or unsafe archive member")
            files[member.name] = archive.extractfile(member).read()
    return files


def experiment_worker(job_mode):
    """Select an explicitly versioned worker without changing legacy jobs."""
    if job_mode == "generation":
        import observer_generation_job
        return observer_generation_job
    if job_mode in {"readout", "intervention"}:
        import observer_experiment_job
        return observer_experiment_job
    raise ValueError("Experiment job mode required")


def gpu_command(job_mode="extract", *, overlay=False):
    if overlay:
        if job_mode not in {"readout", "intervention", "generation"}: raise ValueError("Overlay requires experiment mode")
        from observer_experiment_job import OVERLAY_PYTHON
        worker_name = "observer_generation_job.py" if job_mode == "generation" else "observer_experiment_job.py"
        return [OVERLAY_PYTHON, "scripts/training/" + worker_name]
    if job_mode == "generation":
        raise ValueError("Generation requires the verified image overlay")
    # Deliberately python FILE rather than uv --script: override CPU PEP-723 env.
    prefix = ["uv", "run", "--no-project", "--python", "3.13",
            "--with", "torch==2.8.0+cu128", "--with", "transformers==5.3.0",
            "--with", "numpy==2.2.6", "--index", "https://download.pytorch.org/whl/cu128",
            "--index-strategy", "unsafe-best-match", "python"]
    if job_mode in {"readout", "intervention"}:
        return prefix + ["scripts/training/observer_experiment_job.py"]
    if job_mode != "extract":
        raise ValueError("Unknown observer job mode")
    return prefix + [
            "scripts/training/observer_extract.py", "input.json", "outputs/features.json",
            "--model-revision", MODEL_REVISION, "--tokenizer-revision", MODEL_REVISION,
            "--sae-revision", SAE_REVISION, "--sae-sha256", SAE_HASH,
            "--layer", "12", "--module", "language_model.layers.12", "--device", "cuda",
            "--dtype", "bfloat16", "--max-tokens", str(MAX_TOKENS), "--allow-download"]


def remote_runner(job_mode="extract", *, overlay=False):
    """Frozen runner owns a bounded child process group, never a Runpod API key."""
    if job_mode != "extract":
        return experiment_remote_runner(job_mode, overlay=overlay)
    return ('''import hashlib,json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(__file__).resolve().parent
os.chdir(root)
with open("started.json","x") as f: json.dump({"started_at":time.time()},f)
out=root/"outputs"; out.mkdir(exist_ok=True)
deadline=time.monotonic()+int(sys.argv[1])
env={k:v for k,v in os.environ.items() if k not in ("PYTHONHOME","PYTHONPATH")}
env.update(UV_MANAGED_PYTHON="1",UV_CACHE_DIR="/workspace/observer-cache/uv",
 HF_HOME="/workspace/observer-cache/hf",UV_PYTHON_INSTALL_DIR="/workspace/observer-cache/python")
env["PATH"]=str(root/"bootstrap"/"bin")+os.pathsep+env.get("PATH","")
child=None
def cancel(signum,frame):
    raise TimeoutError("Controller requested bounded cancellation")
signal.signal(signal.SIGTERM,cancel)
code=1
try:
    with (out/"extract.log").open("wb") as log:
        for command in ([sys.executable,"-m","pip","install","--target",str(root/"bootstrap"),"uv==0.12.5"], COMMAND):
            remaining=deadline-time.monotonic()
            if remaining<=0: raise TimeoutError("Approved extraction time exhausted")
            child=subprocess.Popen(command,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            code=child.wait(timeout=remaining)
            if code: break
except (Exception,KeyboardInterrupt) as error:
    code=124 if isinstance(error,TimeoutError) or isinstance(error,subprocess.TimeoutExpired) else 1
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid,signal.SIGTERM)
        try: child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGKILL); child.wait()
    files={}
    for name in ("features.json","extract.log"):
        path=out/name
        if path.exists(): files[name]=hashlib.sha256(path.read_bytes()).hexdigest()
    receipt={"exit_code":code,"files":files,"finished_at":time.time()}
    (out/"receipt.tmp").write_text(json.dumps(receipt,sort_keys=True,separators=(",",":")))
    os.replace(out/"receipt.tmp",out/"receipt.json")
sys.exit(code)
'''.replace("COMMAND", repr(gpu_command()))).encode()


def experiment_remote_runner(job_mode, *, overlay=False):
    """Freeze explicit materialization + checkpointing execution under one deadline."""
    command = gpu_command(job_mode, overlay=True) if overlay else gpu_command(job_mode)
    if job_mode not in {"readout", "intervention", "generation"}:
        raise ValueError("Experiment job mode required")
    script = ('''import hashlib,json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(__file__).resolve().parent; os.chdir(root)
with open("started.json","x") as f: json.dump({"started_at":time.time()},f)
out=root/"outputs"; out.mkdir(exist_ok=True)
work=root/".keating/outputs/experiment-run"
material=root/".keating/outputs/materialization.json"
environment=root/".keating/outputs/overlay/environment.json"
job=json.loads((root/"input.json").read_text()); runtime=json.loads(sys.argv[2])
deadline=time.monotonic()+int(sys.argv[1])
env={k:v for k,v in os.environ.items() if k not in ("PYTHONHOME","PYTHONPATH")}
env.update(UV_MANAGED_PYTHON="1",UV_CACHE_DIR="/workspace/observer-cache/uv",HF_HOME="/workspace/observer-cache/hf",
 HF_HUB_CACHE="/workspace/observer-cache/hf/hub",HF_HUB_DISABLE_IMPLICIT_TOKEN="1",UV_PYTHON_INSTALL_DIR="/workspace/observer-cache/python")
env["PATH"]=str(root/"bootstrap/bin")+os.pathsep+env.get("PATH","")
flags=["--cache-dir",env["HF_HUB_CACHE"]]
for key in ("creation_started_at","rate_observed_at","observed_gpu_hourly_rate"):
 flags += ["--"+key.replace("_","-"),str(runtime[key])]
commands=[[sys.executable,"-m","pip","install","--target",str(root/"bootstrap"),"uv==0.12.5"],
 COMMAND+["materialize","input.json",str(material),"--allow-download"]+flags,
 COMMAND+["execute","input.json",str(material),str(work)]+flags]
if OVERLAY:
 env={k:v for k,v in env.items() if not k.startswith(("PYTHON","PIP_","UV_")) and k!="VIRTUAL_ENV"}
 env.update(PYTHONNOUSERSITE="1",PIP_CONFIG_FILE=os.devnull)
 commands=[["/usr/bin/python3.12","scripts/training/observer_experiment_job.py","bootstrap-overlay","input.json",
  str(environment.parent),"--remaining-seconds",str(min(300,max(0,deadline-time.monotonic())))],
  COMMAND+["materialize","input.json",str(material),"--allow-download","--environment",str(environment)]+flags,
  COMMAND+["execute","input.json",str(material),str(work),"--environment",str(environment),"--expected-preflight","expected-preflight.json"]+flags]
child=None; code=1; stage="bootstrap"
def cancel(signum,frame): raise TimeoutError("Controller requested bounded cancellation")
signal.signal(signal.SIGTERM,cancel)
log_path=out/"setup.tmp"
try:
 with log_path.open("wb") as log:
  for stage,command in zip(("bootstrap","materialization","execution"),commands):
   remaining=deadline-time.monotonic()
   if remaining<=0: raise TimeoutError("Approved job time exhausted")
   stage_deadline=min(deadline,time.monotonic()+300) if OVERLAY and stage=="bootstrap" else deadline
   child=subprocess.Popen(command,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   while child.poll() is None:
    if time.monotonic()>=stage_deadline: raise TimeoutError("Approved job/stage time exhausted")
    if os.fstat(log.fileno()).st_size>job["limits"]["max_log_bytes"]: raise ValueError("Setup log bound exceeded")
    time.sleep(.1)
   code=child.returncode
   if code: break
except (Exception,KeyboardInterrupt) as error:
 code=124 if isinstance(error,TimeoutError) else 1
finally:
 if child is not None and child.poll() is None:
  os.killpg(child.pid,signal.SIGTERM)
  try: child.wait(timeout=5)
  except subprocess.TimeoutExpired: os.killpg(child.pid,signal.SIGKILL); child.wait()
 # Always retain bounded diagnostics, including raw durable checkpoints when a
 # hard process kill prevented the helper from finalizing its own receipt.
 receipt_path=work/"receipt.json"
 if receipt_path.exists():
  receipt=json.loads(receipt_path.read_text()); names=set(receipt["files"])
 else:
  receipt={"schema_version":1,"evidence":"local_worker_process_not_pod_receipt","job_sha256":job["job_sha256"],
   "exit_code":code or 1,"complete":False,"fit_eligible":False,"completed_trials":0,"transport_failure_stage":stage}
  names={"materialization.json","preflight.json","progress.json","trials.jsonl","partial.json","context.json"}
 if OVERLAY and environment.exists(): names.add("environment.json")
 allowed={"materialization.json","preflight.json","progress.json","trials.jsonl","partial.json","context.json","results.json","experiment.log","environment.json"}
 assert names<=allowed
 files={}
 for name in sorted(names):
  p=work/name
  if name=="materialization.json" and not p.exists(): p=material
  if name=="environment.json" and not p.exists(): p=environment
  if not p.exists(): continue
  assert p.is_file() and not p.is_symlink() and p.stat().st_size<67108864
  target=out/name; target.write_bytes(p.read_bytes())
  files[name]=hashlib.sha256(target.read_bytes()).hexdigest()
 # Include a bounded tail of bootstrap/download progress without exposing env.
 log_limit=job["limits"]["max_log_bytes"]
 with log_path.open("rb") as f: f.seek(max(0,log_path.stat().st_size-log_limit)); setup=f.read(log_limit)
 worker_log=(out/"experiment.log").read_bytes() if (out/"experiment.log").exists() else b""
 combined=(worker_log+b"\\n[setup/execution log]\\n"+setup)[-log_limit:]
 (out/"experiment.log").write_bytes(combined); files["experiment.log"]=hashlib.sha256(combined).hexdigest()
 receipt["files"]=files; receipt["transport_exit_code"]=code; receipt["finished_at"]=time.time()
 if code and receipt["complete"]: receipt.update(complete=False,fit_eligible=False,exit_code=code)
 (out/"receipt.tmp").write_text(json.dumps(receipt,sort_keys=True,separators=(",",":")))
 os.replace(out/"receipt.tmp",out/"receipt.json")
sys.exit(code)
'''.replace("COMMAND", repr(command)).replace("OVERLAY", repr(overlay)))
    if job_mode == "generation":
        script = script.replace('"scripts/training/observer_experiment_job.py","bootstrap-overlay"',
                                '"scripts/training/observer_generation_job.py","bootstrap-overlay"')
    return script.encode()


def project_input(body, shortest=False):
    document = json.loads(body)
    records = document["records"]
    if not records or len({r["record_id"] for r in records}) != len(records):
        raise ValueError("Require nonempty unique projection records")
    views = [(row, boundary_view(row)) for row in records]
    if shortest:
        views = [min(views, key=lambda pair: (len(pair[1]["text"]), pair[0]["record_id"]))]
    admitted, local = [], {}
    for row, view in views:
        alias = lambda kind, value: kind + "-" + digest(value)[:24]
        record_id = alias("record", row["record_id"])
        events = []
        for event in row["events"]:
            if event["event_id"] not in view["included_event_ids"]:
                continue
            event_copy = {k: event[k] for k in ("phase", "visibility", "kind", "text")}
            event_copy["event_id"] = alias("event", event["event_id"])
            if event["kind"] == "delivered_artifact":
                event_copy["receipt_id"] = alias("receipt", event["receipt_id"])
            events.append(event_copy)
        clean = {"record_id": record_id, "family_id": alias("family", row["family_id"]),
                 "source": "approved_public_projection", "boundary": row["boundary"],
                 "latest_allowed_event_id": alias("event", row["latest_allowed_event_id"]),
                 "events": events, "spans": [{"event_id": alias("event", s["event_id"]),
                                               "start": s["start"], "end": s["end"]}
                                              for s in row["spans"]]}
        if boundary_view(clean)["text"] != view["text"]:
            raise ValueError("Projection changed observer text")
        admitted.append(clean)
        local[record_id] = {k: row[k] for k in ("record_id", "family_id", "group_ids", "source", "split",
                                               "labels", "label_provenance") if k in row}
        local[record_id]["original_record_sha256"] = digest(row)
    return (canonical({"records": admitted}) + "\n").encode(), local


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("REST redirect refused; credentials stay on the pinned API origin")


class APIError(RuntimeError):
    def __init__(self, method, status):
        self.status = status
        super().__init__(f"Runpod {method} failed HTTP {status}; response body withheld")


class RunpodAPI:
    def __init__(self):
        import certifi
        self.key = os.environ["RUNPOD_API_KEY"]
        if not self.key or any(ch.isspace() for ch in self.key):
            raise ValueError("Invalid RUNPOD_API_KEY environment value")
        context = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or certifi.where())
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def call(self, method, path, data=None, *, timeout=20):
        if not path.startswith("/") or "://" in path:
            raise ValueError("Expected API-relative path")
        request = urllib.request.Request(API + path, method=method,
            data=None if data is None else canonical(data).encode(),
            headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json",
                     "User-Agent": "keating-observer-job/1 REST-v2"})
        try:
            # No transport retry, especially after POST /pods.
            with self.opener.open(request, timeout=timeout) as response:
                body = response.read(4 * 1024 * 1024 + 1)
                if len(body) > 4 * 1024 * 1024:
                    raise ValueError("API response exceeds limit")
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            raise APIError(method, error.code) from None
        except urllib.error.URLError:
            raise RuntimeError("Runpod transport failed; outcome may be uncertain") from None


def quote(api, now=None):
    path = "/catalog/gpus/" + urllib.parse.quote(GPU, safe="")
    value = api.call("GET", path + "?include=AVAILABILITY&product=POD&count=1&cloud=SECURE&minCudaVersion=12.8")
    if value["id"] != GPU or value["memory"] < 48 or not value["secure"]:
        raise ValueError("Catalog does not match the observer GPU requirement")
    rate = positive(value["price"]["secure"])
    return {"schema_version": 1, "kind": "live_rest_v2", "quoted_at": time.time() if now is None else now,
            "source": API + path, "response_sha256": digest(value), "gpu_id": GPU,
            "gpu_usd_per_hour": str(rate), "availability": value.get("availability", "UNKNOWN"),
            "cloud": "SECURE", "memory_gb": value["memory"], "count": 1,
            "running_storage_usd_per_hour": str(RUNNING_STORAGE_RATE),
            "stopped_storage_usd_per_hour": str(STOPPED_STORAGE_RATE),
            "storage_source": "https://docs.runpod.io/pods/storage/types",
            "storage_assumption": "90GB running / 80GB stopped; conservative 672-hour month"}


def validate_quote(value, *, fresh=False, now=None):
    if (value.get("source") != API + "/catalog/gpus/" + urllib.parse.quote(GPU, safe="")
            or value.get("gpu_id") != GPU or value.get("cloud") != "SECURE"
            or value.get("count") != 1 or value.get("memory_gb", 0) < 48):
        raise ValueError("Quote does not match fixed secure L40S job")
    positive(value["gpu_usd_per_hour"])
    timestamp = value["quoted_at"]
    if type(timestamp) not in (int, float) or not math.isfinite(timestamp):
        raise ValueError("Invalid quote timestamp")
    if fresh and not 0 <= (time.time() if now is None else now) - timestamp <= QUOTE_TTL:
        raise ValueError("Quote expired or is future-dated")
    if fresh and value.get("kind") != "live_rest_v2":
        raise ValueError("Planning estimate is not a live REST v2 quote; prepare again after quoting")
    if value.get("availability") not in {"LOW", "MEDIUM", "HIGH"}:
        raise ValueError("GPU availability is unavailable or unknown")


def create_request(plan, plan_hash):
    """Exact REST v2 body; a keyless draft still cannot pass create's gates."""
    environment = {"OBSERVER_JOB_SHA256": plan_hash}
    if plan["public_key"] is not None:
        environment["PUBLIC_KEY"] = plan["public_key"]
    return {"name": plan["pod_name"], "image": plan["image"], "cloud": "SECURE",
            "gpu": {"id": GPU, "count": 1, "minRamPerGpu": 64,
                    "minVcpuCountPerGpu": 8, "minCudaVersion": "12.8"},
            "disk": 10, "mounts": {"persistent": {"size": 80, "path": "/workspace"}},
            "ports": ["22/tcp"], "startSsh": True, "startJupyter": False, "env": environment}


def prepare(input_path, quote_path, directory, cost_cap, hour_cap, hourly_cap, public_key=None,
            *, shortest=False, source_dir=None, job_mode="extract", local_join_path=None, preflight_path=None):
    q = json.loads(regular_bytes(quote_path, MAX_INPUT))
    validate_quote(q)
    cost, hours, rate = map(positive, (cost_cap, hour_cap, hourly_cap))
    if not Decimal("0.1") <= hours <= 2:
        raise ValueError("Pilot duration must be 0.1–2 hours, including setup and cleanup")
    if positive(q["gpu_usd_per_hour"]) + RUNNING_STORAGE_RATE > rate:
        raise ValueError("Quoted GPU plus storage exceeds hourly cap")
    if hours * rate + Decimal("0.10") > cost:
        raise ValueError("Cost cap must cover hourly cap × hours plus $0.10 preservation reserve")
    key = None
    if public_key is not None:
        key = regular_bytes(public_key, 16384).decode().strip()
        if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [^\r\n]+)?", key):
            raise ValueError("Supply a dedicated ed25519 PUBLIC key file")
        key = " ".join(key.split()[:2])  # Do not upload a personal comment.
    original = regular_bytes(input_path, MAX_INPUT)
    worker = None
    if job_mode == "extract":
        if local_join_path is not None or preflight_path is not None: raise ValueError("Extract builds its own local join and does not consume experiment preflight")
        uploaded, join = project_input(original, shortest)
        source_names = SOURCE_NAMES
    elif job_mode in {"readout", "intervention", "generation"}:
        experiment_job = experiment_worker(job_mode)
        if shortest or local_join_path is None or preflight_path is None:
            raise ValueError("Experiment requires its exact local join and token preflight; select the sample before preparing it")
        worker = json.loads(original); experiment_job.validate_job(worker, check_code=True)
        preflight = json.loads(regular_bytes(preflight_path, MAX_EXPORT))
        experiment_job.validate_preflight(worker, preflight)
        if worker["mode"] != job_mode: raise ValueError("Experiment mode differs from prepared job")
        for limit_name, limit_value in (("cost_cap_usd", cost), ("hour_cap", hours), ("hourly_cap_usd", rate)):
            if Decimal(str(worker["limits"][limit_name])) != limit_value: raise ValueError("Worker and supervisor budget caps differ")
        join = json.loads(regular_bytes(local_join_path, MAX_EXPORT))
        experiment_job.check_seal(join, "join_sha256")
        if (join["join_sha256"] != worker["join_sha256"] or join["source_plan_sha256"] != worker["source_plan_sha256"]
                or join["uploaded_plan_sha256"] != worker["experiment"]["plan_sha256"]):
            raise ValueError("Experiment local join mismatch")
        uploaded = (canonical(worker) + "\n").encode(); source_names = experiment_job.SOURCE_NAMES
    else:
        raise ValueError("Unknown observer job mode")
    sources = source_dir or Path(__file__).parent
    files = {"scripts/training/" + name: regular_bytes(sources / name, MAX_INPUT) for name in source_names}
    if worker is not None and {n: sha(files["scripts/training/"+n]) for n in source_names} != worker["source_files_sha256"]:
        raise ValueError("Worker source files differ from prepared job")
    overlay = worker is not None and "dependency_profile" in worker
    files.update({"input.json": uploaded, "run.py": remote_runner(job_mode, overlay=overlay)})
    if overlay:
        if IMAGE != "runpod/pytorch@sha256:" + experiment_job.IMAGE_PROOF["image-index.json"]:
            raise ValueError("Overlay image differs from verified proof")
        files["expected-preflight.json"] = (canonical(preflight) + "\n").encode()
    bundle_manifest = {"schema_version": 1, "files": {k: sha(v) for k, v in files.items()}}
    files["bundle.json"] = (canonical(bundle_manifest) + "\n").encode()
    archive = archive_bytes(files)
    job_id = uuid.uuid4().hex
    plan = {"schema_version": 1, "job_id": job_id, "pod_name": "observer-" + job_id[:20],
            # Package installation performs many small writes. Keep it off the
            # mounted volume; large immutable HF assets still use /workspace.
            "execution_root": "/tmp/observer-" + job_id,
            "manager_sha256": sha(regular_bytes(Path(__file__), MAX_INPUT)),
            "api": API, "api_spec_sha256": SPEC_SHA256, "image": IMAGE,
            "image_source_tag": IMAGE_TAG,
            "image_note": "Official tag resolved via public registry manifest, hash verified 2026-09-13; no layers downloaded",
            "gpu_id": GPU, "gpu_count": 1, "min_ram_gb": 64, "min_vcpu": 8,
            "min_cuda_version": "12.8", "container_disk_gb": 10, "volume_disk_gb": 80,
            "public_key": key, "quote": q, "cost_cap_usd": str(cost), "hour_cap": str(hours),
            "hourly_cap_usd": str(rate), "preservation_reserve_usd": "0.10",
            "normal_cost_bound_usd": str(hours * rate),
            "quote_estimate_usd": str(hours * (positive(q["gpu_usd_per_hour"]) + RUNNING_STORAGE_RATE)),
            "cleanup_reserve_seconds": RESERVE_SECONDS, "command": gpu_command(job_mode, overlay=True) if overlay else gpu_command(job_mode),
            "bundle_files_sha256": bundle_manifest["files"], "archive_sha256": sha(archive),
            "original_input_sha256": sha(original), "uploaded_input_sha256": sha(uploaded),
            "local_join_sha256": digest(join), "records": len(worker["experiment"]["records"] if worker else json.loads(uploaded)["records"]),
            "launch_ready": key is not None and q.get("kind") == "live_rest_v2",
            "scope": "One public text projection pack; no credentials, labels, private or future events",
            "limits": ["Local supervisor required; REST v2 has no provider dollar cap or TTL.",
                       "Control-plane loss can exceed limits; stopped volume continues billing.",
                       "Quote is a planning estimate, not an invoice or availability reservation."]}
    if worker is not None:
        plan.update(job_mode=job_mode, experiment_job_sha256=worker["job_sha256"], forward_passes=worker["forward_passes"],
            expected_preflight_sha256=preflight["preflight_sha256"], forward_tokens=preflight["forward_tokens"],
            estimated_result_bytes_upper=preflight["estimated_result_bytes_upper"],
            worker_limits=worker["limits"], scope="One frozen observer experiment; exact aliased family/split/review contract, no private labels or credentials")
    if overlay:
        plan["dependency_binding"] = {"profile_sha256": worker["dependency_profile"]["profile_sha256"],
            "overlay_lock_sha256": experiment_job.OVERLAY_LOCK, "image_proof_sha256": experiment_job.IMAGE_PROOF,
            "installer_sha256": worker["source_files_sha256"]["observer_experiment_job.py"],
            "max_bootstrap_seconds": 300, "max_transfer_bytes": 64 * 1024**2}
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    (directory / "payload.tar").write_bytes(archive)
    os.chmod(directory / "payload.tar", 0o600)
    (directory / "input.review.json").write_bytes(uploaded)
    os.chmod(directory / "input.review.json", 0o600)
    write_json(directory / "join.local.json", join, exclusive=True)
    write_json(directory / "plan.json", plan, exclusive=True)
    write_json(directory / "request.json", create_request(plan, digest(plan)), exclusive=True)
    write_json(directory / "state.json", {"phase": "prepared", "plan_sha256": digest(plan)}, exclusive=True)
    return {"plan_sha256": digest(plan), "job_dir": str(directory), "plan": plan}


@contextmanager
def locked_job(directory):
    if directory.is_symlink():
        raise ValueError("Job directory must not be a symlink")
    with (directory / "job.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


class Job:
    def __init__(self, directory, api, *, clock=time.time, sleep=time.sleep):
        self.directory, self.api, self.clock, self.sleep = directory, api, clock, sleep
        self.plan = json.loads(regular_bytes(directory / "plan.json", MAX_INPUT))
        self.state = json.loads(regular_bytes(directory / "state.json", MAX_INPUT))
        if self.state["plan_sha256"] != digest(self.plan):
            raise ValueError("Plan changed after preparation")
        if self.plan.get("manager_sha256") != sha(regular_bytes(Path(__file__), MAX_INPUT)):
            raise ValueError("Supervisor source changed or was not pinned; prepare and review a new plan")
        if sha(regular_bytes(Path(__file__).with_name("observer_core.py"), MAX_INPUT)) != self.plan["bundle_files_sha256"]["scripts/training/observer_core.py"]:
            raise ValueError("Local observer validation helper differs from the approved bundle")
        self.request = json.loads(regular_bytes(directory / "request.json", MAX_INPUT))
        if self.request != create_request(self.plan, self.state["plan_sha256"]):
            raise ValueError("Prepared REST request changed")
        self.body = regular_bytes(directory / "payload.tar", 8 * MAX_INPUT)
        if sha(self.body) != self.plan["archive_sha256"]:
            raise ValueError("Source/input archive changed")
        self.files = read_archive(self.body, set(self.plan["bundle_files_sha256"]) | {"bundle.json"}, 8 * MAX_INPUT)
        if {k: sha(v) for k, v in self.files.items() if k != "bundle.json"} != self.plan["bundle_files_sha256"]:
            raise ValueError("Source/input pin mismatch")
        self.join = json.loads(regular_bytes(directory / "join.local.json", MAX_EXPORT if self.plan.get("job_mode", "extract") != "extract" else MAX_INPUT))
        if digest(self.join) != self.plan["local_join_sha256"]:
            raise ValueError("Local provenance join changed")
        self.job_mode = self.plan.get("job_mode", "extract")
        if self.job_mode in {"readout", "intervention", "generation"}:
            experiment_job = experiment_worker(self.job_mode)
            self.experiment = json.loads(self.files["input.json"])
            experiment_job.validate_job(self.experiment, check_code=True)
            if (self.experiment["job_sha256"] != self.plan["experiment_job_sha256"] or self.experiment["mode"] != self.job_mode
                    or self.experiment["source_files_sha256"] != {n: self.plan["bundle_files_sha256"]["scripts/training/"+n] for n in experiment_job.SOURCE_NAMES}):
                raise ValueError("Experiment supervisor/input/source binding mismatch")
            if "dependency_profile" in self.experiment:
                expected = {"profile_sha256": self.experiment["dependency_profile"]["profile_sha256"],
                    "overlay_lock_sha256": experiment_job.OVERLAY_LOCK, "image_proof_sha256": experiment_job.IMAGE_PROOF,
                    "installer_sha256": self.experiment["source_files_sha256"]["observer_experiment_job.py"],
                    "max_bootstrap_seconds": 300, "max_transfer_bytes": 64 * 1024**2}
                flight = json.loads(self.files["expected-preflight.json"])
                experiment_job.validate_preflight(self.experiment, flight)
                if (self.plan.get("dependency_binding") != expected or self.plan["image"] != IMAGE
                    or self.plan["command"] != gpu_command(self.job_mode, overlay=True)
                    or self.files["run.py"] != remote_runner(self.job_mode, overlay=True)
                    or flight["preflight_sha256"] != self.plan["expected_preflight_sha256"]):
                    raise ValueError("Overlay manager/image/installer/token binding mismatch")
        elif self.job_mode != "extract": raise ValueError("Unknown observer job mode")

    def save(self, **updates):
        self.state.update(updates)
        write_json(self.directory / "state.json", self.state)

    def remaining(self):
        started = self.state["create_attempted_at"]
        elapsed = self.clock() - started
        if elapsed < 0:
            raise ValueError("Clock moved before creation; refusing to extend budget")
        return float(positive(self.plan["hour_cap"])) * 3600 - elapsed

    def owns(self, pod):
        return (pod.get("name") == self.plan["pod_name"]
                and pod.get("env", {}).get("OBSERVER_JOB_SHA256") == self.state["plan_sha256"]
                and pod.get("gpu", {}).get("id") == GPU and pod.get("gpu", {}).get("count") == 1)

    def owned_pod(self):
        pod_id = self.state.get("pod_id", "")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{5,80}", pod_id):
            raise ValueError("No owned recorded pod ID; cannot act on a resource")
        pod = self.api.call("GET", "/pods/" + pod_id)
        if pod.get("id") != pod_id or not self.owns(pod):
            raise ValueError("Pod identity/ownership mismatch; no lifecycle action sent")
        return pod

    def create(self, confirmation):
        if confirmation != self.state["plan_sha256"]:
            raise ValueError("Explicit confirmation must match reviewed plan SHA256")
        if self.state["phase"] != "prepared" or "create_attempted_at" in self.state:
            raise ValueError("Creation already attempted; reconcile or resume, never repeat POST")
        if not self.plan.get("launch_ready"):
            raise ValueError("Draft lacks a live quote or dedicated public key; prepare a new launch plan")
        validate_quote(self.plan["quote"], fresh=True, now=self.clock())
        latest = quote(self.api, self.clock())
        validate_quote(latest, fresh=True, now=self.clock())
        if positive(latest["gpu_usd_per_hour"]) + RUNNING_STORAGE_RATE > positive(self.plan["hourly_cap_usd"]):
            raise ValueError("Fresh quote exceeds approved hourly cap; prepare a new plan")
        request = self.request
        self.save(phase="creation_uncertain", create_attempted_at=self.clock(),
                  request_sha256=digest(request), launch_quote=latest)
        pod = self.api.call("POST", "/pods", request)
        # Journal the ID before subsequent validation; reconciliation handles lost replies.
        if not isinstance(pod, dict) or not re.fullmatch(r"[a-zA-Z0-9_-]{5,80}", str(pod.get("id", ""))):
            raise ValueError("Create response missing pod ID; reconcile, do not retry")
        self.save(pod_id=pod["id"], phase="created")
        self.owned_pod()

    def reconcile(self):
        if self.state["phase"] != "creation_uncertain" or "create_attempted_at" not in self.state:
            raise ValueError("Only uncertain creation can be reconciled")
        candidates = [p for p in self.api.call("GET", "/pods")["pods"] if self.owns(p)]
        if len(candidates) != 1:
            raise ValueError("Need exactly one matching owned pod; creation remains uncertain, no retry")
        pod_id = candidates[0]["id"]
        if not re.fullmatch(r"[a-zA-Z0-9_-]{5,80}", pod_id):
            raise ValueError("Invalid reconciled pod ID")
        self.save(pod_id=pod_id, phase="created", reconciled_at=self.clock())

    def check_rate(self, pod):
        cost = pod.get("cost")
        if type(cost) not in (float, int) or not math.isfinite(cost) or cost < 0:
            raise ValueError("Missing/invalid actual pod hourly cost")
        if pod["status"] in {"EXITED", "TERMINATED"}:
            return
        observed = Decimal(str(cost)) + RUNNING_STORAGE_RATE
        self.save(last_observed_gpu_hourly_rate=cost, rate_observed_at=self.clock())
        self.save(max_observed_hourly_usd=str(max(observed, Decimal(self.state.get("max_observed_hourly_usd", "0")))))
        elapsed = max(0, self.clock() - self.state["create_attempted_at"])
        self.save(estimated_running_spend_usd=str(Decimal(str(elapsed)) / 3600 *
                  Decimal(self.state["max_observed_hourly_usd"])))
        if observed > positive(self.plan["hourly_cap_usd"]):
            raise ValueError("Actual pod hourly cost exceeds approved cap")

    def stop(self, reason):
        pod = self.owned_pod()
        self.save(phase="stop_requested", stop_reason=reason)
        if pod["status"] not in {"EXITED", "TERMINATED"}:
            self.api.call("POST", "/pods/" + pod["id"] + "/action", {"action": "stop"})
        self.save(phase="stop_requested", stop_requested_at=self.clock(),
                  stopped_storage_usd_per_hour=str(STOPPED_STORAGE_RATE))
        # At most three short reads: <=19 seconds, within the cleanup reserve.
        confirmed = self.await_lifecycle({"EXITED", "TERMINATED"})
        self.save(intervention_required=not confirmed,
                  phase="stopped_preservation_required" if confirmed else "stop_unconfirmed")
        if not confirmed:
            raise RuntimeError("Stop not confirmed; operator intervention required")

    def await_lifecycle(self, statuses, *, deletion=False):
        # Retain one five-second verification opportunity for an emergency stop
        # after a controller resumes past its deadline; never extend extraction.
        deadline = self.clock() + min(19, max(5, self.remaining()))
        for attempt in range(3):
            left = deadline - self.clock()
            if left <= 0:
                break
            try:
                pod = self.api.call("GET", "/pods/" + self.state["pod_id"], timeout=min(5, left))
                if pod.get("id") != self.state["pod_id"] or not self.owns(pod):
                    raise ValueError("Ownership changed during lifecycle verification")
                self.save(last_observed_status=pod["status"])
                if pod["status"] in statuses:
                    return True
            except APIError as error:
                if deletion and error.status == 404:
                    # This ID was verified as ours before DELETE was sent.
                    self.save(last_observed_status="NOT_FOUND_AFTER_OWN_DELETE")
                    return True
            except (RuntimeError, TimeoutError):
                pass
            if attempt < 2:
                self.sleep(min(2, max(0, deadline - self.clock())))
        return False

    def import_outputs(self, body):
        if self.job_mode != "extract":
            return self.import_experiment_outputs(body)
        files = read_archive(body, {"receipt.json", "extract.log", "features.json"}, MAX_EXPORT)
        receipt = json.loads(files["receipt.json"])
        if (type(receipt.get("exit_code")) is not int or "extract.log" not in files
                or receipt.get("files") != {k: sha(v) for k, v in files.items() if k != "receipt.json"}):
            raise ValueError("Output receipt/hash mismatch")
        # Preserve failure evidence too; complete extraction is a separate validation.
        path = self.directory / "outputs.tar"
        if path.exists() and sha(regular_bytes(path, MAX_EXPORT)) != sha(body):
            raise ValueError("Refusing to replace an earlier output export")
        if not path.exists():
            with path.open("xb") as out:
                os.chmod(path, 0o600)
                out.write(body); out.flush(); os.fsync(out.fileno())
        extraction_error = None
        if receipt["exit_code"] == 0:
            try:
                result = json.loads(files["features.json"])
                self.validate_result(result)
                joined = json.loads(files["features.json"])
                for row in joined["rows"]:
                    local = self.join[row["record_id"]]
                    for key in ("group_ids", "labels", "label_provenance", "source", "split"):
                        if key in local:
                            row[key] = local[key]
                    row["local_source_record_sha256"] = local["original_record_sha256"]
                write_json(self.directory / "features.local.json", joined)
            except (ValueError, KeyError, TypeError) as error:
                extraction_error = type(error).__name__ + ": " + str(error)
        self.save(phase="outputs_preserved", outputs_sha256=sha(body), exit_code=receipt["exit_code"],
                  extraction_valid=receipt["exit_code"] == 0 and extraction_error is None,
                  extraction_error=extraction_error)

    def import_experiment_outputs(self, body):
        experiment_job = experiment_worker(self.job_mode)
        files = read_archive(body, experiment_job.ARTIFACTS, MAX_EXPORT)
        receipt = json.loads(files["receipt.json"])
        if (type(receipt.get("exit_code")) is not int or receipt.get("job_sha256") != self.experiment["job_sha256"]
                or receipt.get("files") != {k: sha(v) for k, v in files.items() if k != "receipt.json"}):
            raise ValueError("Experiment output receipt/hash mismatch")
        path = self.directory / "outputs.tar"
        if path.exists() and sha(regular_bytes(path, MAX_EXPORT)) != sha(body):
            raise ValueError("Refusing to replace an earlier output export")
        if not path.exists():
            with path.open("xb") as out:
                os.chmod(path, 0o600); out.write(body); out.flush(); os.fsync(out.fileno())
        error = None; imported = None
        try:
            imported = experiment_job.import_outputs(self.experiment, self.join, body)
            if "preflight.json" in files and json.loads(files["preflight.json"])["preflight_sha256"] != self.plan["expected_preflight_sha256"]:
                imported = None
                raise ValueError("Remote token preflight differs from the prepared workload")
            if imported.get("diagnostic_only"):
                write_json(self.directory / "diagnostic.local.json", imported["diagnostic"])
            else:
                write_json(self.directory / ("results.local.json" if imported["complete"] else "partial.local.json"), imported["local_join"])
        except (ValueError, KeyError, TypeError, OverflowError) as failure:
            error = type(failure).__name__ + ": " + str(failure)
            imported = None
        self.save(phase="outputs_preserved", outputs_sha256=sha(body), exit_code=receipt["exit_code"],
            experiment_valid=bool(imported and imported["complete"]),
            partial_valid=bool(imported and not imported["complete"] and not imported.get("diagnostic_only")),
            diagnostic_valid=bool(imported and imported.get("diagnostic_only")),
            worker_failure_stage=imported["diagnostic"]["failure_stage"] if imported and imported.get("diagnostic_only") else None,
            fit_eligible=bool(imported and imported["fit_eligible"]),
            validated_completed_trials=imported["validated_completed_trials"] if imported else 0, experiment_error=error)

    def validate_result(self, result):
        canonical(result)  # Reject nonfinite JSON numbers anywhere in the artifact.
        manifest = result["manifest"]
        expected = {"evidence": "model_extraction", "observer_revision": MODEL_REVISION,
                    "tokenizer_revision": MODEL_REVISION, "sae_revision": SAE_REVISION,
                    "sae_sha256": SAE_HASH, "module": "language_model.layers.12", "layer": 12,
                    "dtype": "bfloat16", "max_tokens": MAX_TOKENS, "device": "cuda",
                    "observer_model": "Qwen/Qwen3.5-9B-Base",
                    "tokenizer_model": "Qwen/Qwen3.5-9B-Base",
                    "sae_model": "Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50",
                    "sae_file": "layer12.sae.pt", "hook": "residual_post_block", "truncation": False,
                    "dimensions": {"hidden": 4096, "width": 65536, "top_k": 50},
                    "encoding": "affine_then_signed_topk_no_relu_no_centering"}
        if any(manifest.get(k) != v for k, v in expected.items()):
            raise ValueError("Extraction manifest does not match approved observer")
        if result["manifest_sha256"] != digest(manifest) or result["input_sha256"] != self.plan["uploaded_input_sha256"]:
            raise ValueError("Extraction input/manifest hash mismatch")
        source_pins = {name: self.plan["bundle_files_sha256"]["scripts/training/" + name] for name in SOURCE_NAMES}
        if manifest.get("implementation_files_sha256") != source_pins:
            raise ValueError("Remote extraction used different source code")
        for category in ("model_files_sha256", "tokenizer_files_sha256"):
            hashes = manifest.get(category)
            if not isinstance(hashes, dict) or not hashes or any(not re.fullmatch(r"[a-f0-9]{64}", v) for v in hashes.values()):
                raise ValueError("Missing observer/tokenizer file hashes")
        for name, version in {"torch": "2.8.0+cu128", "transformers": "5.3.0", "numpy": "2.2.6"}.items():
            if manifest.get("software", {}).get(name) != version:
                raise ValueError("Extraction used different runtime dependency versions")
        inputs = {r["record_id"]: r for r in json.loads(self.files["input.json"])["records"]}
        rows = result["rows"]
        if len(rows) != len(inputs) or {r["record_id"] for r in rows} != set(inputs):
            raise ValueError("Extraction has missing/duplicate/extra records")
        for row in rows:
            original = inputs[row["record_id"]]
            if (row["record_sha256"] != digest(original) or row["view"] != boundary_view(original)
                    or row["observer_manifest_sha256"] != digest(manifest)):
                raise ValueError("Extraction record/projection mismatch")
            if (row.get("family_id") != original["family_id"] or row.get("boundary") != original["boundary"]
                    or row.get("text") != row["view"]["text"] or row.get("sae_width") != 65536
                    or len(row.get("raw", [])) != 4096 or not all(type(v) in (int, float) for v in row["raw"])):
                raise ValueError("Missing/mismatched feature dimensions or provenance")
            selected, tokens = row.get("selected_token_indices", []), row.get("sparse_tokens", [])
            token_ids = row.get("input_token_ids", [])
            if (not 1 <= len(token_ids) <= MAX_TOKENS or not selected or len(set(selected)) != len(selected)
                    or any(type(i) is not int or not 0 <= i < len(token_ids) for i in selected)
                    or [t.get("token_index") for t in tokens] != selected):
                raise ValueError("Missing/mismapped extracted token spans")
            pooled = row.get("sae")
            if not isinstance(pooled, dict) or not pooled or any(
                    not re.fullmatch(r"\d+", k) or not 0 <= int(k) < 65536 or type(v) not in (int, float)
                    for k, v in pooled.items()):
                raise ValueError("Invalid pooled SAE features")
            for token in tokens:
                indices, values = token.get("indices", []), token.get("values", [])
                if (len(indices) != 50 or len(set(indices)) != 50 or len(values) != 50
                        or any(type(i) is not int or not 0 <= i < 65536 for i in indices)
                        or any(type(v) not in (float, int) for v in values)):
                    raise ValueError("Invalid sparse Top-K feature shape")

    def terminate(self):
        preserved = regular_bytes(self.directory / "outputs.tar", MAX_EXPORT)
        if not self.state.get("outputs_sha256") or sha(preserved) != self.state["outputs_sha256"]:
            raise ValueError("Verified local outputs required before deletion")
        try:
            pod = self.owned_pod()
        except APIError as error:
            if (error.status == 404 and self.state.get("termination_requested_at") is not None
                    and self.state["phase"] in {"termination_requested", "termination_unconfirmed"}):
                self.save(phase="terminated", terminated_at=self.clock(), intervention_required=False,
                          last_observed_status="NOT_FOUND_AFTER_OWN_DELETE")
                return
            raise
        self.save(phase="termination_requested", termination_requested_at=self.clock())
        if pod["status"] != "TERMINATED":
            try:
                self.api.call("DELETE", "/pods/" + pod["id"])
            except Exception:
                self.save(phase="termination_unconfirmed", intervention_required=True)
        if self.await_lifecycle({"TERMINATED"}, deletion=True):
            self.save(phase="terminated", terminated_at=self.clock(), intervention_required=False)
        else:
            self.save(phase="termination_unconfirmed", intervention_required=True)
            raise RuntimeError("Termination not observed; preserved outputs and recorded pod require intervention")


BOOTSTRAP = '''import hashlib,io,json,pathlib,sys,tarfile
body=sys.stdin.buffer.read(16777217)
assert len(body)<=16777216 and hashlib.sha256(body).hexdigest()==sys.argv[1]
root=pathlib.Path(sys.argv[2]); root.mkdir(parents=True,exist_ok=True)
if (root/"bundle.sha256").exists():
    assert (root/"bundle.sha256").read_text()==sys.argv[1]
installed=(root/"bundle.sha256").exists()
with tarfile.open(fileobj=io.BytesIO(body),mode="r:") as archive:
    members=archive.getmembers()
    names={m.name for m in members}
    allowed={"bundle.json","run.py","input.json","scripts/training/observer_core.py","scripts/training/observer_models.py","scripts/training/observer_extract.py"}
    assert len(names)==len(members) and names==allowed and all(m.isfile() for m in members)
    files={m.name:archive.extractfile(m).read() for m in members}
    assert json.loads(files["bundle.json"])["files"]=={k:hashlib.sha256(v).hexdigest() for k,v in files.items() if k!="bundle.json"}
    for name,content in files.items():
        path=root/name
        if installed:
            assert path.is_file() and not path.is_symlink() and path.read_bytes()==content
        else:
            path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(content)
(root/"bundle.sha256").write_text(sys.argv[1])
'''
EXPORT = '''import io,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1])/"outputs"
assert (root/"receipt.json").is_file()
buffer=io.BytesIO()
with tarfile.open(fileobj=buffer,mode="w") as archive:
    for name in ("receipt.json","extract.log","features.json"):
        p=root/name
        if p.exists():
            assert p.is_file() and not p.is_symlink() and p.stat().st_size<67108864
            info=tarfile.TarInfo(name); body=p.read_bytes(); info.size=len(body)
            archive.addfile(info,io.BytesIO(body))
assert buffer.tell()<=134217728
sys.stdout.buffer.write(buffer.getvalue())
'''


def bootstrap(job_mode="extract"):
    if job_mode == "extract": return BOOTSTRAP
    if job_mode == "generation":
        return bootstrap("readout").replace('"scripts/training/observer_experiment_job.py"}',
            '"scripts/training/observer_experiment_job.py","scripts/training/observer_generation.py","scripts/training/observer_generation_job.py"}')
    if job_mode not in {"readout", "intervention"}: raise ValueError("Unknown job mode")
    return BOOTSTRAP.replace('"scripts/training/observer_extract.py"}',
        '"scripts/training/observer_extract.py","scripts/training/observer_experiment.py","scripts/training/observer_experiment_job.py"}').replace(
        '    assert len(names)==len(members)',
        '    if "dependency_profile" in json.loads(archive.extractfile("input.json").read()): allowed.add("expected-preflight.json")\n'
        '    assert len(names)==len(members)')


def export_script(job_mode="extract"):
    if job_mode == "extract": return EXPORT
    if job_mode not in {"readout", "intervention", "generation"}: raise ValueError("Unknown job mode")
    # Receipt determines the exact bounded output set, checked again on import.
    return EXPORT.replace('import io,pathlib,sys,tarfile', 'import io,json,pathlib,sys,tarfile').replace(
        'for name in ("receipt.json","extract.log","features.json"):',
        'for name in sorted(set(json.loads((root/"receipt.json").read_text())["files"])|{"receipt.json"}):\n'
        '        assert name in {"receipt.json","experiment.log","materialization.json","preflight.json","progress.json","trials.jsonl","partial.json","context.json","results.json","environment.json"}')


class SSH:
    def __init__(self, job, pod):
        direct = pod.get("ssh", {}).get("direct")
        if not direct or direct.get("username") != "root":
            raise ValueError("Direct SSH not ready; proxy cannot transfer artifacts")
        host, port = direct["host"], direct["port"]
        ipaddress.ip_address(host)
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("Invalid direct SSH port")
        key = Path(os.environ["OBSERVER_SSH_PRIVATE_KEY"]).expanduser().resolve(strict=True)
        self.job = job
        legacy_root = "/workspace/observer-" + job.plan["job_id"]
        self.root = job.plan.get("execution_root", legacy_root)
        if self.root not in {legacy_root, "/tmp/observer-" + job.plan["job_id"]}:
            raise ValueError("Execution root must be bound to this job")
        self.argv = ["ssh", "-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                     "-o", "ForwardAgent=no",
                     "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
                     "-o", "StrictHostKeyChecking=accept-new", "-o",
                     "UserKnownHostsFile=" + str((job.directory / "known_hosts").resolve()),
                     "-i", str(key), "-p", str(port), "root@" + host]

    def execute(self, args, body=None, *, timeout=20, output_limit=MAX_EXPORT):
        # Use a file rather than unbounded PIPE capture; do not print remote logs.
        path = self.job.directory / "ssh-response.tmp"
        with path.open("w+b") as out, (self.job.directory / "ssh-input.tmp").open("w+b") as incoming:
            os.chmod(path, 0o600)
            os.chmod(incoming.name, 0o600)
            if body is not None:
                incoming.write(body); incoming.seek(0)
            process = subprocess.Popen(self.argv + [shlex.join(args)], stdin=incoming if body is not None else subprocess.DEVNULL,
                                       stdout=out, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + timeout
                while process.poll() is None:
                    if time.monotonic() >= deadline or os.fstat(out.fileno()).st_size > output_limit:
                        raise TimeoutError("SSH command time/byte bound reached")
                    time.sleep(0.05)
            except BaseException:
                process.kill(); process.wait()
                raise
            if process.returncode:
                raise RuntimeError("SSH command failed; inspect owned pod, credentials were not logged")
            if out.tell() > output_limit:
                raise ValueError("SSH output exceeds byte bound")
            out.seek(0)
            return out.read(output_limit + 1)

    def install(self):
        self.execute(["python3", "-c", bootstrap(self.job.job_mode), self.job.plan["archive_sha256"], self.root], self.job.body)

    def start(self):
        seconds = int(self.job.remaining() - RESERVE_SECONDS)
        if seconds <= 0:
            raise ValueError("No approved time remains for extraction")
        # started.json is created exclusively by run.py. Lost SSH acknowledgements
        # never cause a second model run, even when the launch command is resumed.
        script = "import os,pathlib,subprocess,sys; p=pathlib.Path(sys.argv[1]); f=(p/'launch.log').open('ab'); subprocess.Popen(['python3',str(p/'run.py'),sys.argv[2]]+sys.argv[3:],stdout=f,stderr=f,stdin=subprocess.DEVNULL,start_new_session=True)"
        extra = []
        if self.job.job_mode != "extract":
            extra = [canonical({
                "creation_started_at": self.job.state["create_attempted_at"], "rate_observed_at": self.job.state["rate_observed_at"],
                "observed_gpu_hourly_rate": self.job.state["last_observed_gpu_hourly_rate"]})]
        self.execute(["python3", "-c", script, self.root, str(seconds), *extra])

    def done(self):
        script = "import pathlib,sys; print(int((pathlib.Path(sys.argv[1])/'outputs/receipt.json').exists()))"
        return self.execute(["python3", "-c", script, self.root], output_limit=64).strip() == b"1"

    def collect(self):
        return self.execute(["python3", "-c", export_script(self.job.job_mode), self.root], timeout=40)


def supervise(job, *, ssh_factory=SSH, sleep=time.sleep):
    """Foreground finite supervisor; a dead controller cannot enforce cloud billing."""
    try:
        while job.remaining() > RESERVE_SECONDS:
            pod = job.owned_pod()
            job.check_rate(pod)
            if pod["status"] in {"EXITED", "TERMINATED", "ERROR"}:
                raise RuntimeError("Pod exited or failed before output preservation")
            if pod["status"] == "RUNNING" and pod.get("ssh", {}).get("direct"):
                ssh = ssh_factory(job, pod)
                if not job.state.get("launch_attempted"):
                    ssh.install()
                    job.save(launch_attempted=True, phase="extraction_running")
                if not job.state.get("launch_acknowledged"):
                    # A controller may die between its launch journal and SSH.
                    # The remote exclusive started.json makes this recovery safe.
                    ssh.start()
                    job.save(launch_acknowledged=True)
                if ssh.done():
                    job.import_outputs(ssh.collect())
                    job.terminate()
                    return
            sleep(min(10, max(0, job.remaining() - RESERVE_SECONDS)))
        # The remote runner's independent child timeout uses the same earlier
        # deadline; allow its 5-second process-group cleanup, then export.
        pod = job.owned_pod()
        ssh = ssh_factory(job, pod)
        for _ in range(3):
            if ssh.done():
                job.import_outputs(ssh.collect())
                job.terminate()
                return
            sleep(5)
        job.stop("time_cap_output_not_ready")
    except BaseException:
        if job.state.get("pod_id") and job.state.get("phase") != "terminated":
            termination_pending = job.state.get("phase") in {"termination_requested", "termination_unconfirmed"}
            try:
                job.stop("supervisor_failure_or_interrupt")
            except Exception:
                job.save(phase="stop_unconfirmed", intervention_required=True)
            finally:
                if termination_pending:
                    job.save(phase="termination_unconfirmed", intervention_required=True)
        raise


def report_job(directory):
    """Historical inspection without importing pinned code, credentials or API."""
    plan = json.loads(regular_bytes(directory / "plan.json", MAX_INPUT))
    state = json.loads(regular_bytes(directory / "state.json", MAX_INPUT))
    if digest(plan) != state["plan_sha256"]: raise ValueError("Historical plan/state hash mismatch")
    return {"plan_sha256": state["plan_sha256"], "job_mode": plan.get("job_mode", "extract"),
        "manager_matches_current": plan.get("manager_sha256") == sha(regular_bytes(Path(__file__), MAX_INPUT)),
        "state": state, "records": plan["records"], "archive_sha256": plan["archive_sha256"],
        "scope": "Read-only stored evidence; no current provider/lifecycle verification"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    q = sub.add_parser("quote", help="Read-only authenticated REST v2 catalog quote")
    q.add_argument("--output", type=Path, required=True)
    q.add_argument("--planning-rate", help="Offline planning assumption; cannot authorize launch")
    p = sub.add_parser("prepare", help="Offline exact-file bundle and reviewable budget plan")
    for name in ("input", "quote", "job-dir"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--public-key", type=Path, help="Optional for draft only; required for launch plan")
    for name in ("cost-cap", "hour-cap", "hourly-cap"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--shortest", action="store_true")
    p.add_argument("--job-mode", choices=("extract", "readout", "intervention", "generation"), default="extract")
    p.add_argument("--local-join", type=Path, help="Exact local join from experiment helper preparation")
    p.add_argument("--preflight", type=Path, help="Exact cached-tokenizer preflight from experiment helper")
    historical = sub.add_parser("report", help="Read historical stored evidence without provider access or source-version execution")
    historical.add_argument("--job-dir", type=Path, required=True)
    for name in ("run", "reconcile", "status", "collect", "stop", "terminate"):
        command = sub.add_parser(name)
        command.add_argument("--job-dir", type=Path, required=True)
        if name == "run":
            command.add_argument("--confirm-plan-sha256", required=True)
    args = parser.parse_args(argv)
    if args.action == "prepare":
        result = prepare(args.input, args.quote, args.job_dir, args.cost_cap, args.hour_cap,
                         args.hourly_cap, args.public_key, shortest=args.shortest, job_mode=args.job_mode, local_join_path=args.local_join, preflight_path=args.preflight)
        print(canonical(result))
        return
    if args.action == "report":
        print(canonical(report_job(args.job_dir)))
        return
    if args.action == "quote":
        if args.planning_rate:
            rate = positive(args.planning_rate)
            result = {"schema_version": 1, "kind": "planning_estimate", "quoted_at": time.time(),
                      "source": API + "/catalog/gpus/" + urllib.parse.quote(GPU, safe=""),
                      "gpu_id": GPU, "gpu_usd_per_hour": str(rate), "availability": "LOW",
                      "cloud": "SECURE", "memory_gb": 48, "count": 1,
                      "provenance": "Operator-supplied planning assumption; no API request made"}
        else:
            result = quote(RunpodAPI())
        write_json(args.output, result, exclusive=True)
        print(canonical(result))
        return
    api = RunpodAPI()
    with locked_job(args.job_dir):
        job = Job(args.job_dir, api)
        if args.action == "run":
            if args.confirm_plan_sha256 != job.state["plan_sha256"]:
                raise ValueError("Confirmation does not match reviewed plan")
            if not job.plan.get("launch_ready"):
                raise ValueError("Draft only: live quote and public key are still missing")
            # Check local SSH capability before incurring any spend.
            private = Path(os.environ["OBSERVER_SSH_PRIVATE_KEY"]).expanduser()
            public = subprocess.run(["ssh-keygen", "-y", "-P", "", "-f", str(private)],
                                    check=True, capture_output=True, text=True, timeout=10).stdout.strip()
            if public != job.plan["public_key"]:
                raise ValueError("Local private key does not match reviewed public key")
            def interrupted(_signum, _frame):
                raise KeyboardInterrupt("Supervisor received SIGTERM")
            signal.signal(signal.SIGTERM, interrupted)
            if job.state["phase"] == "prepared":
                try:
                    job.create(args.confirm_plan_sha256)
                except BaseException:
                    if job.state.get("pod_id"):
                        try:
                            job.stop("create_response_validation_failure")
                        except Exception:
                            job.save(phase="stop_unconfirmed", intervention_required=True)
                    raise
            if job.state["phase"] == "creation_uncertain":
                raise ValueError("Uncertain creation: use reconcile; never repeat creation")
            if job.state["phase"] in {"created", "extraction_running"}:
                supervise(job)
            elif job.state["phase"] == "outputs_preserved":
                job.terminate()
            elif job.state["phase"] != "terminated":
                raise ValueError("This state requires explicit recovery; no automatic pod restart")
        elif args.action == "reconcile":
            job.reconcile()
        elif args.action == "stop":
            job.stop("explicit_owned_job_stop")
        elif args.action == "terminate":
            job.terminate()
        elif args.action == "collect":
            job.import_outputs(SSH(job, job.owned_pod()).collect())
        else:
            pod = job.owned_pod()
            job.save(last_observed_status=pod["status"], status_checked_at=job.clock())
        print(canonical(job.state))
        if args.action == "run" and job.state.get("phase") == "terminated" and not job.state.get("extraction_valid" if job.job_mode == "extract" else "experiment_valid"):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
