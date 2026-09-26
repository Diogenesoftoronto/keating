#!/usr/bin/env python3
"""One temporary, pinned RunPod CLM pilot. Explicit `create` incurs bounded spend.

Secrets are read from Skate/private files, never arguments or output. Only the
pod ID in this pilot's state file can be stopped. The detached watchdog deletes
that pod after 43 minutes even if the interactive controller exits.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".keating/tmp/clm-pilot-state.json"
SECRET = ROOT / ".keating/tmp/clm-pilot-secret"
STOP = ROOT / ".keating/tmp/clm-pilot-stop"
LOG = ROOT / ".keating/tmp/clm-pilot-watchdog.log"
COMMIT = "0a3a319c1a242339903db575e160e9a8d84b9ce8"
HEAD_REVISION = "87655cb835bd76fd66c2da78e1e3709f7fa11a94"
ENCODER_REVISION = "b968826d9c46dd6066d109eabc6255188de91218"
IMAGE = "vllm/vllm-openai@sha256:2c908d5a84ed251b6a17d179f42d06df1aff353007779ac5eecd8a0ea3fe9331"
GPU = "NVIDIA A40"
MAX_SECONDS = 43 * 60

# This public bootstrap is delivered as the container command, without secrets.
# Only CLM's disposable auth key is passed as a pod environment variable.
BOOTSTRAP = r'''
import hashlib,hmac,http.client,http.server,json,os,pathlib,socket,ssl,subprocess,threading,time,urllib.error,urllib.request,zipfile,io
root=pathlib.Path('/tmp/clm-pilot');root.mkdir(exist_ok=True)
log=root/'startup.log'
state={'phase':'initializing','contextTokens':32768,'truncation':False}
def error_code(error):
 if isinstance(error,urllib.error.HTTPError):return 'download-http-'+str(error.code)
 reason=error.reason if isinstance(error,urllib.error.URLError) else error
 if isinstance(reason,ssl.SSLCertVerificationError):return 'tls-certificate-verification'
 if isinstance(reason,socket.gaierror):return 'dns-resolution'
 if isinstance(reason,(TimeoutError,socket.timeout)):return 'network-timeout'
 if isinstance(reason,(ConnectionError,http.client.IncompleteRead)):return 'network-interrupted'
 if isinstance(reason,ssl.SSLError):return 'tls-handshake'
 if isinstance(error,urllib.error.URLError):return 'network-unavailable'
 if isinstance(error,zipfile.BadZipFile):return 'invalid-source-archive'
 if isinstance(error,subprocess.CalledProcessError):return 'startup-command-failed'
 if isinstance(error,RuntimeError) and str(error)=='upstream-startup-timeout':return 'upstream-startup-timeout'
 return 'startup-error'
def transient_download_error(error):
 if isinstance(error,urllib.error.HTTPError):return error.code in (408,425,429,500,502,503,504)
 reason=error.reason if isinstance(error,urllib.error.URLError) else error
 if isinstance(reason,ssl.SSLCertVerificationError):return False
 return isinstance(error,urllib.error.URLError) or isinstance(reason,(TimeoutError,ConnectionError,socket.gaierror,ssl.SSLError,http.client.IncompleteRead))
def note(event,**fields):
 line=json.dumps({'event':event,**fields})
 print(line,flush=True)
 with log.open('a') as handle:handle.write(line+'\n')
def stage(name):
 state.update(phase=name,stage=name)
 state.pop('lastDownloadError',None);state.pop('downloadAttempt',None)
 note('stage',stage=name)
def download_bytes(url,opener=None,sleep=None):
 # Four attempts, 2/4/8-second backoff, 90-second socket timeout. Only public
 # pinned artifact URLs reach this helper; no auth headers or error text is logged.
 opener=opener or urllib.request.urlopen;sleep=sleep or time.sleep
 for attempt in range(1,5):
  state['downloadAttempt']=attempt
  try:
   request=urllib.request.Request(url,headers={'User-Agent':'curl/8.14.1'})
   with opener(request,timeout=90) as response:
    data=response.read(128*1024*1024+1)
    length=response.headers.get('Content-Length')
    if length and length.isdecimal() and len(data)<int(length):raise http.client.IncompleteRead(data,int(length)-len(data))
   if len(data)>128*1024*1024:raise ValueError('artifact-size-limit')
   state.pop('lastDownloadError',None)
   return data
  except Exception as error:
   code=error_code(error);state['lastDownloadError']=code
   retry=attempt<4 and transient_download_error(error)
   note('download-failure',stage=state.get('stage'),attempt=attempt,errorCode=code,retrying=retry)
   if not retry:raise
   sleep(2**attempt)
def record_failure(error):
 state.update(phase='failed',errorStage=state.get('stage','initializing'),errorType=type(error).__name__,errorCode=error_code(error))
 note('startup-failed',stage=state['errorStage'],errorType=state['errorType'],errorCode=state['errorCode'])
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+os.environ['CLM_API_KEY']):
   self.send_response(401);self.end_headers();return
  result=dict(state)
  if log.exists():result['logTail']=log.read_text(errors='replace').splitlines()[-25:]
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(result).encode())
 def log_message(self,*args):pass
threading.Thread(target=http.server.ThreadingHTTPServer(('0.0.0.0',8701),Handler).serve_forever,daemon=True).start()
def wait_url(url,seconds):
 deadline=time.time()+seconds
 while time.time()<deadline:
  try:
   with urllib.request.urlopen(url,timeout=5) as r:
    if r.status==200:return
  except Exception:pass
  time.sleep(3)
 raise RuntimeError('upstream-startup-timeout')
try:
 with log.open('a',buffering=1) as output:
  stage('download-source')
  data=download_bytes('https://codeload.github.com/Contrastive-LM/CLM/zip/'+os.environ['CLM_SOURCE_REVISION'])
  stage('unpack-source')
  with zipfile.ZipFile(io.BytesIO(data)) as archive:archive.extractall(root)
  source=root/('CLM-'+os.environ['CLM_SOURCE_REVISION'])
  stage('install-clm')
  subprocess.run([sys.executable,'-m','pip','install','--no-deps','-e',str(source)+'[serve]'],check=True,stdout=output,stderr=output)
  stage('download-head')
  checkpoint=root/'CLM_v0.1-8B.pt'
  checkpoint.write_bytes(download_bytes('https://huggingface.co/Contrastive-LM/CLM-v0.1-8B/resolve/'+os.environ['CLM_HEAD_REVISION']+'/CLM_v0.1-8B.pt'))
  state['headSha256']=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
  stage('start-encoder')
  encoder=subprocess.Popen(['vllm','serve','Qwen/Qwen3-8B','--revision',os.environ['CLM_ENCODER_REVISION'],'--served-model-name','qwen3-8b','--runner','pooling','--max-model-len','32768','--gpu-memory-utilization','0.80','--max-num-seqs','2','--enforce-eager','--host','127.0.0.1','--port','8090'],stdout=output,stderr=output)
  state['encoderPid']=encoder.pid
  wait_url('http://127.0.0.1:8090/v1/models',1200)
  stage('start-clm')
  clm=subprocess.Popen(['clm-serve','--port','8700','--emb-url','http://127.0.0.1:8090/v1/embeddings','--emb-model','qwen3-8b','--ckpt',str(checkpoint),'--max-tokens','0','--action-cache','0','--no-ui','--device','cuda'],stdout=output,stderr=output)
  wait_url('http://127.0.0.1:8700/health',120)
  stage('ready')
  while encoder.poll() is None and clm.poll() is None:time.sleep(5)
  stage('service-exited')
except Exception as e:
 record_failure(e)
while True:time.sleep(30)
'''.replace("import hashlib", "import sys,hashlib")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def private_json(path: Path, value: object) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(value, handle, indent=2)


def api(method: str, path: str, body: object = None) -> object:
    credential = subprocess.run(["skate", "get", "runpod_api_key@secrets"], capture_output=True, text=True, check=True).stdout.strip()
    request = urllib.request.Request("https://rest.runpod.io/v1" + path,
        data=None if body is None else json.dumps(body).encode(), method=method,
        headers={"Authorization": "Bearer " + credential, "Content-Type": "application/json", "User-Agent": "curl/8.14.1"})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            data = response.read()
            return json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        # Never print upstream response bodies: they may echo pod environment.
        raise RuntimeError(f"runpod-http-{error.code}") from None


def price() -> dict:
    credential = subprocess.run(["skate", "get", "runpod_api_key@secrets"], capture_output=True, text=True, check=True).stdout.strip()
    query = '{ gpuTypes { id securePrice secureCloud lowestPrice(input: {gpuCount: 1}) { stockStatus } } }'
    request = urllib.request.Request("https://api.runpod.io/graphql", data=json.dumps({"query": query}).encode(),
        headers={"Authorization": "Bearer " + credential, "Content-Type": "application/json", "User-Agent": "curl/8.14.1"})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        data = json.load(response)
    return next(row for row in data["data"]["gpuTypes"] if row["id"] == GPU)


def create() -> None:
    if STATE.exists():
        raise RuntimeError("pilot-state-already-exists; inspect and clean up before a new pilot")
    offer = price()
    if not offer["secureCloud"] or not 0 < offer["securePrice"] <= 1:
        raise RuntimeError("no-approved-gpu-within-hourly-cap")
    existing = api("GET", "/pods")
    if existing:
        raise RuntimeError("unexpected-existing-pods; creation-aborted")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_urlsafe(32)
    fd = os.open(SECRET, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(secret)
    created = time.time()
    name = "keating-clm-pilot-" + str(int(created))
    state = {"name": name, "created": created, "deadline": created + MAX_SECONDS,
        "offer": offer, "sourceRevision": COMMIT, "headRevision": HEAD_REVISION,
        "encoderRevision": ENCODER_REVISION, "image": IMAGE, "contextTokens": 32768,
        "truncation": False, "status": "creating"}
    private_json(STATE, state)
    # Start before POST. If the create response is lost, the watchdog discovers
    # only the exact unique pilot name and deletes its pod after the deadline.
    logfd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(logfd, "a") as output:
        watcher = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "watch"],
            stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True, close_fds=True)
    state["watchdogPid"] = watcher.pid
    private_json(STATE, state)
    encoded = base64.b64encode(BOOTSTRAP.encode()).decode()
    body = {"name": name, "computeType": "GPU", "cloudType": "SECURE", "gpuCount": 1,
        "gpuTypeIds": [GPU], "imageName": IMAGE, "containerDiskInGb": 70, "volumeInGb": 0,
        "minRAMPerGPU": 32, "minVCPUPerGPU": 4, "minDownloadMbps": 200,
        "interruptible": False, "ports": ["8700/http", "8701/http"],
        "dockerEntrypoint": ["python3", "-u", "-c"],
        "dockerStartCmd": ["import base64;exec(base64.b64decode('" + encoded + "'))"],
        "env": {"CLM_API_KEY": secret, "CLM_SOURCE_REVISION": COMMIT,
            "CLM_HEAD_REVISION": HEAD_REVISION, "CLM_ENCODER_REVISION": ENCODER_REVISION,
            "HF_HUB_DISABLE_PROGRESS_BARS": "1", "HF_HOME": "/tmp/huggingface"}}
    try:
        pod = api("POST", "/pods", body)
        state.update({"podId": pod["id"], "status": "starting", "costPerHr": pod.get("costPerHr"),
            "endpoint": f'https://{pod["id"]}-8700.proxy.runpod.net/v1/systemone',
            "statusEndpoint": f'https://{pod["id"]}-8701.proxy.runpod.net/'})
        private_json(STATE, state)
        if isinstance(pod.get("costPerHr"), (int, float)) and pod["costPerHr"] > 1:
            stop()
            raise RuntimeError("returned-price-exceeds-cap; deleted")
        print(json.dumps(state), flush=True)
    except Exception:
        STOP.touch(mode=0o600, exist_ok=True)
        raise


def watch() -> None:
    while True:
        try:
            state = json.loads(STATE.read_text())
            if state.get("status") == "deleted":
                return
            if STOP.exists() or time.time() >= state["deadline"]:
                stop()
                return
        except Exception as error:
            print(json.dumps({"watchdogError": type(error).__name__}), flush=True)
        time.sleep(5)


def stop() -> None:
    state = json.loads(STATE.read_text())
    if state.get("status") == "deleted":
        print(json.dumps({"status": "deleted", "podId": state.get("podId")}))
        return
    pod_id = state.get("podId")
    if not pod_id:
        matches = [pod for pod in api("GET", "/pods") if pod.get("name") == state["name"]]
        if len(matches) > 1:
            raise RuntimeError("ambiguous-pilot-pod; manual-cleanup-required")
        pod_id = matches[0]["id"] if matches else None
    if pod_id:
        try:
            api("DELETE", "/pods/" + pod_id)
        except RuntimeError as error:
            if str(error) != "runpod-http-404":
                raise
        # Confirm deletion against authoritative listing, not merely HTTP success.
        if any(pod["id"] == pod_id for pod in api("GET", "/pods")):
            raise RuntimeError("pilot-deletion-not-yet-confirmed")
    state.update({"status": "deleted", "podId": pod_id, "deleted": time.time()})
    private_json(STATE, state)
    print(json.dumps({"status": "deleted", "podId": pod_id, "elapsedSeconds": state["deleted"] - state["created"]}), flush=True)


def status() -> None:
    state = json.loads(STATE.read_text())
    out = {key: state.get(key) for key in ["podId", "status", "endpoint", "deadline", "costPerHr"]}
    if state.get("podId") and state.get("status") != "deleted":
        pod = api("GET", "/pods/" + state["podId"])
        out["pod"] = {key: pod.get(key) for key in ["desiredStatus", "costPerHr", "lastStatusChange", "publicIp"]}
        req = urllib.request.Request(state["statusEndpoint"], headers={"Authorization": "Bearer " + SECRET.read_text().strip(), "User-Agent": "curl/8.14.1"})
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
                out["service"] = json.load(response)
        except urllib.error.HTTPError as error:
            out["serviceHttpStatus"] = error.code
        except Exception as error:
            out["serviceError"] = type(error).__name__
    print(json.dumps(out), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["create", "status", "stop", "watch", "price"])
    args = parser.parse_args()
    try:
        if args.action == "price": print(json.dumps(price()))
        else: globals()[args.action]()
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
