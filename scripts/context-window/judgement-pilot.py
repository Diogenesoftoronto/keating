#!/usr/bin/env python3
"""Private, sequential Kev/Laya GPU jobs. Only explicit create allocates a pod.

One A40, quoted at no more than $1/hour, 150GB container disk, no volume.
A detached local watchdog deletes this exact pod after 70 minutes. Job payloads
must pin their model/source revisions; the controller does not choose models.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".keating/tmp/judgement-pilot-state.json"
SECRET = ROOT / ".keating/tmp/judgement-pilot-secret"
STOP = ROOT / ".keating/tmp/judgement-pilot-stop"
LOG = ROOT / ".keating/tmp/judgement-pilot-watchdog.log"
IMAGE = "vllm/vllm-openai@sha256:2c908d5a84ed251b6a17d179f42d06df1aff353007779ac5eecd8a0ea3fe9331"
GPU = "NVIDIA A40"
MAX_SECONDS = 70 * 60
MAX_RESULT = 64 * 1024 * 1024

# Reuse only the established read-only price and authenticated RunPod transport.
# No CLM state, create, stop, or startup function is invoked or modified.
_spec = importlib.util.spec_from_file_location("judgement_pilot_runpod_transport", Path(__file__).with_name("clm-pilot.py"))
_transport = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_transport)
api, price, NoRedirect = _transport.api, _transport.price, _transport.NoRedirect

BOOTSTRAP = r'''
import hashlib,hmac,http.server,json,os,pathlib,re,signal,subprocess,threading,time,urllib.parse
root=pathlib.Path('/tmp/judgement-pilot');root.mkdir(mode=0o700,exist_ok=True)
key=os.environ.pop('JUDGEMENT_CONTROL_KEY')
deadline=float(os.environ.pop('JUDGEMENT_DEADLINE'))
lock=threading.Lock();jobs={};active=None
safe=re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\Z')
def basename(value):
 return isinstance(value,str) and safe.fullmatch(value) is not None
def tail(path,limit=16384):
 if not path.is_file():return ''
 with path.open('rb') as f:f.seek(max(0,path.stat().st_size-limit));raw=f.read(limit)
 return raw.decode('utf8','replace').replace(key,'[REDACTED]')
def wait_job(name,process,handle,seconds):
 try:
  code=process.wait(timeout=seconds);status='completed' if code==0 else 'failed'
 except subprocess.TimeoutExpired:
  # This process group was created and is owned by this exact job.
  os.killpg(process.pid,signal.SIGTERM)
  try:code=process.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);code=process.wait(timeout=10)
  status='timed-out'
 finally:handle.close()
 with lock:jobs[name].update(status=status,exitCode=code,finishedAt=time.time())
def snapshot(name=None):
 with lock:
  selected=name or active
  result={'phase':'ready','deadline':deadline,'remainingSeconds':max(0,int(deadline-time.time())),
   'jobs':[{k:v for k,v in job.items() if k!='directory'} for job in list(jobs.values())[-20:]]}
  job=dict(jobs[selected]) if selected in jobs else None
 if job:
  directory=pathlib.Path(job.pop('directory'));job['logTail']=tail(directory/'job.log')
  progress=directory/'progress.json'
  if progress.is_file() and not progress.is_symlink() and progress.stat().st_size<=65536:
   try:job['progress']=json.loads(progress.read_text().replace(key,'[REDACTED]'))
   except (ValueError,OSError):job['progressUnavailable']='partial-or-invalid-json'
  job['resultFiles']=[{'name':p.name,'bytes':p.stat().st_size} for p in sorted(directory.glob('*.jsonl')) if p.is_file() and not p.is_symlink()][:30]
  result['selectedJob']=job
 return result
class Handler(http.server.BaseHTTPRequestHandler):
 def setup(self):
  super().setup();self.connection.settimeout(45)
 def authorized(self):
  if hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+key):return True
  self.send_response(401);self.end_headers();return False
 def respond(self,status,value):
  raw=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def do_GET(self):
  if not self.authorized():return
  try:
   parsed=urllib.parse.urlsplit(self.path);query=urllib.parse.parse_qs(parsed.query)
   if parsed.path=='/status':self.respond(200,snapshot(query.get('name',[None])[0]));return
   if parsed.path!='/result':self.respond(404,{'error':'unknown-route'});return
   name=query.get('name',[''])[0];file=query.get('file',[''])[0]
   if not basename(name) or not basename(file):self.respond(400,{'error':'invalid-name'});return
   with lock:job=dict(jobs[name]) if name in jobs else None
   if not job:self.respond(404,{'error':'unknown-job'});return
   directory=pathlib.Path(job['directory']);path=directory/file
   if path.is_symlink() or not path.is_file() or path.resolve().parent!=directory.resolve():self.respond(404,{'error':'missing-result'});return
   offset=int(query.get('offset',['0'])[0]);size=path.stat().st_size
   if offset<0 or offset>size or size>64*1024*1024:self.respond(409,{'error':'result-offset-or-size-limit'});return
   with path.open('rb') as f:f.seek(offset);raw=f.read(min(4*1024*1024,size-offset))
   self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Length',str(len(raw)));self.send_header('X-Next-Offset',str(offset+len(raw)));self.send_header('X-File-Size',str(size));self.send_header('X-Job-Status',job['status']);self.end_headers();self.wfile.write(raw)
  except Exception:self.respond(400,{'error':'invalid-request'})
 def do_POST(self):
  global active
  if not self.authorized():return
  if self.path!='/job':self.respond(404,{'error':'unknown-route'});return
  try:
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<=32*1024*1024:raise ValueError()
   payload=json.loads(self.rfile.read(length));name=payload.get('name');files=payload.get('files');command=payload.get('command')
   if not basename(name) or not isinstance(files,dict) or not 1<=len(files)<=30:raise ValueError()
   if any(not basename(n) or n in ('job.log','progress.json') or not isinstance(v,str) or len(v.encode())>16*1024*1024 for n,v in files.items()):raise ValueError()
   if not isinstance(command,list) or not 1<=len(command)<=80 or any(not isinstance(x,str) or not x or '\0' in x or key in x for x in command):raise ValueError()
   with lock:
    if time.time()>=deadline-15:self.respond(409,{'error':'pilot-deadline'});return
    if active and jobs[active]['status']=='running':self.respond(409,{'error':'prior-job-running'});return
    if name in jobs or (root/name).exists():self.respond(409,{'error':'job-already-exists'});return
    directory=root/name;directory.mkdir(mode=0o700)
    for filename,content in files.items():
     fd=os.open(directory/filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
     with os.fdopen(fd,'w') as f:f.write(content)
    fd=os.open(directory/'job.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);handle=os.fdopen(fd,'w')
    env=dict(os.environ);env.update(PIP_DEFAULT_TIMEOUT='60',PIP_RETRIES='2',HF_HUB_ETAG_TIMEOUT='30',HF_HUB_DOWNLOAD_TIMEOUT='90',PYTHONUNBUFFERED='1')
    process=subprocess.Popen(command,cwd=directory,env=env,stdin=subprocess.DEVNULL,stdout=handle,stderr=subprocess.STDOUT,start_new_session=True,close_fds=True)
    active=name;jobs[name]={'name':name,'status':'running','startedAt':time.time(),'directory':str(directory)}
    threading.Thread(target=wait_job,args=(name,process,handle,max(1,min(3600,deadline-time.time()-10))),daemon=True).start()
   self.respond(202,{'name':name,'status':'running'})
  except Exception:self.respond(400,{'error':'invalid-job-or-launch-failed'})
 def unsupported(self):
  if self.authorized():self.respond(405,{'error':'method-not-allowed'})
 do_PUT=do_DELETE=do_PATCH=do_HEAD=do_OPTIONS=unsupported
 def log_message(self,*args):pass
print(json.dumps({'phase':'control-ready','port':8701}),flush=True)
http.server.ThreadingHTTPServer(('0.0.0.0',8701),Handler).serve_forever()
'''


def private_json(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + f".writing-{os.getpid()}")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(value, handle, indent=2)
    os.replace(temporary, path)


def create() -> None:
    if any(path.exists() for path in (STATE, SECRET, STOP)):
        raise RuntimeError("pilot-private-state-already-exists")
    offer = price()
    if not offer["secureCloud"] or not 0 < offer["securePrice"] <= 1:
        raise RuntimeError("no-approved-a40-within-hourly-cap")
    if api("GET", "/pods"):
        raise RuntimeError("unexpected-existing-pods; creation-aborted")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_urlsafe(32)
    fd = os.open(SECRET, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(secret)
    created = time.time()
    state = {"name": "keating-judgement-pilot-" + secrets.token_hex(8), "created": created,
             "deadline": created + MAX_SECONDS, "offer": offer, "image": IMAGE,
             "controllerSha256": hashlib.sha256(BOOTSTRAP.encode()).hexdigest(), "status": "creating"}
    private_json(STATE, state)
    fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a") as output:
        watcher = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "watch"],
            stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True, close_fds=True)
    state["watchdogPid"] = watcher.pid
    private_json(STATE, state)
    encoded = base64.b64encode(BOOTSTRAP.encode()).decode()
    try:
        pod = api("POST", "/pods", {"name": state["name"], "computeType": "GPU", "cloudType": "SECURE",
            "gpuCount": 1, "gpuTypeIds": [GPU], "imageName": IMAGE, "containerDiskInGb": 150,
            "volumeInGb": 0, "minRAMPerGPU": 32, "minVCPUPerGPU": 4, "minDownloadMbps": 200,
            "interruptible": False, "ports": ["8701/http"], "dockerEntrypoint": ["python3", "-u", "-c"],
            "dockerStartCmd": ["import base64;exec(base64.b64decode('" + encoded + "'))"],
            "env": {"JUDGEMENT_CONTROL_KEY": secret, "JUDGEMENT_DEADLINE": str(state["deadline"]),
                    "HF_HOME": "/tmp/huggingface", "HF_HUB_DISABLE_PROGRESS_BARS": "1"}})
        state.update(podId=pod["id"], status="starting", costPerHr=pod.get("costPerHr"),
                     endpoint=f'https://{pod["id"]}-8701.proxy.runpod.net')
        private_json(STATE, state)
        if not isinstance(pod.get("costPerHr"), (int, float)) or not 0 < pod["costPerHr"] <= 1:
            stop()
            raise RuntimeError("returned-price-missing-or-exceeds-cap; deleted")
        print(json.dumps(state), flush=True)
    except Exception:
        STOP.touch(mode=0o600, exist_ok=True)
        raise


def stop() -> None:
    state = json.loads(STATE.read_text())
    if state.get("status") == "deleted":
        print(json.dumps({"status": "deleted", "podId": state.get("podId")})); return
    pod_id = state.get("podId")
    if not pod_id:
        matches = [pod for pod in api("GET", "/pods") if pod.get("name") == state["name"]]
        if len(matches) > 1:
            raise RuntimeError("ambiguous-pilot-pod")
        pod_id = matches[0]["id"] if matches else None
    if pod_id:
        try:
            api("DELETE", "/pods/" + pod_id)
        except RuntimeError as error:
            if str(error) != "runpod-http-404": raise
        if any(pod["id"] == pod_id for pod in api("GET", "/pods")):
            raise RuntimeError("pilot-deletion-not-yet-confirmed")
    state.update(status="deleted", podId=pod_id, deleted=time.time())
    private_json(STATE, state)
    print(json.dumps({"status": "deleted", "podId": pod_id, "elapsedSeconds": state["deleted"] - state["created"]}), flush=True)


def watch() -> None:
    while True:
        try:
            state = json.loads(STATE.read_text())
            if state.get("status") == "deleted": return
            if STOP.exists() or time.time() >= state["deadline"]:
                stop(); return
        except Exception as error:
            print(json.dumps({"watchdogError": type(error).__name__}), flush=True)
        time.sleep(5)


def control(path: str, body: object = None):
    state = json.loads(STATE.read_text())
    if state.get("status") == "deleted": raise RuntimeError("pilot-already-deleted")
    request = urllib.request.Request(state["endpoint"] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + SECRET.read_text().strip(), "Content-Type": "application/json", "User-Agent": "curl/8.14.1"})
    try:
        return urllib.request.build_opener(NoRedirect).open(request, timeout=45)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"control-http-{error.code}") from None


def status(name: str | None = None) -> None:
    state = json.loads(STATE.read_text())
    output = {key: state.get(key) for key in ("podId", "status", "deadline", "costPerHr")}
    if state.get("status") != "deleted" and state.get("endpoint"):
        try:
            with control("/status" + ("?" + urllib.parse.urlencode({"name": name}) if name else "")) as response:
                output["service"] = json.load(response)
        except Exception as error:
            output["serviceError"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    print(json.dumps(output), flush=True)


def submit(path: Path) -> None:
    body = json.loads(path.read_text())
    with control("/job", body) as response:
        print(json.dumps(json.load(response)), flush=True)


def fetch(name: str, filename: str, output: Path) -> None:
    """Snapshot an append-only result, including partial in-flight JSONL, without truncating prior data."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", name) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", filename):
        raise RuntimeError("invalid-job-or-result-name")
    previous = output.read_bytes() if output.exists() else b""
    raw = bytearray(); remote_size = None; job_status = None
    while remote_size is None or len(raw) < remote_size:
        query = urllib.parse.urlencode({"name": name, "file": filename, "offset": len(raw)})
        with control("/result?" + query) as response:
            chunk = response.read(4 * 1024 * 1024 + 1)
            size = int(response.headers["X-File-Size"])
            job_status = response.headers["X-Job-Status"]
        if remote_size is None: remote_size = size
        if size < remote_size or len(raw) + len(chunk) > MAX_RESULT or not chunk and len(raw) < remote_size:
            raise RuntimeError("result-shrank-or-size-limit")
        raw.extend(chunk[:max(0, remote_size - len(raw))])
    if not raw.startswith(previous): raise RuntimeError("result-is-not-an-append-only-continuation")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".download")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle: handle.write(raw)
    os.replace(temporary, output)
    print(json.dumps({"file": str(output), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "jobStatus": job_status}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["create", "status", "stop", "watch", "submit", "fetch"])
    parser.add_argument("--payload", type=Path)
    parser.add_argument("--name")
    parser.add_argument("--file")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "submit":
            if not args.payload: raise RuntimeError("submit-requires-payload-json-path")
            submit(args.payload)
        elif args.action == "fetch":
            if not args.name or not args.file or not args.out: raise RuntimeError("fetch-requires-name-file-out")
            fetch(args.name, args.file, args.out)
        elif args.action == "status": status(args.name)
        else: globals()[args.action]()
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
