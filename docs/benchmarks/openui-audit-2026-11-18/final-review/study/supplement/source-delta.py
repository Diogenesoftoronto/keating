"""Capture a small independently verified delta over the unchanged v2.3.3 product archive."""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("base_source", HERE.parent/"source.py")
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
sha=lambda data:hashlib.sha256(data).hexdigest()
catalog="packages/learner-contracts/src/judgement/teaching-policy-catalog.ts"

def version(root):
    return re.search(r'export const TEACHING_POLICY_VERSION = "([^"]+)"', (root/catalog).read_text()).group(1)

def freeze(phase):
    meta=json.loads((HERE.parent/base.DESCRIPTOR).read_text())
    files=base.included()
    delta={}
    for name in files:
        data=(base.ROOT/name).read_bytes()
        if sha(data)!=meta["files"].get(name):
            delta[name]={"sha256":sha(data),"bytes":base64.b64encode(data).decode("ascii")}
    policy=version(base.ROOT)
    if phase=="coding": assert policy=="keating-teaching-policy/v2.3.4",policy
    else: assert policy not in ("keating-teaching-policy/v2.3.3","keating-teaching-policy/v2.3.4"),policy
    info={"baseArchiveSha256":meta["archiveSha256"],"phase":phase,"policy":policy,"changed":delta,
          "removed":sorted(set(meta["files"])-set(files)),"fileCount":len(files)}
    out=HERE/phase/"source-delta.json.gz"
    out.parent.mkdir(exist_ok=True)
    with out.open("xb") as f: f.write(gzip.compress(json.dumps(info,sort_keys=True,separators=(",",":")).encode(),mtime=0))
    print(json.dumps({"phase":phase,"policy":policy,"changed":len(delta),"removed":len(info["removed"]),"fileCount":len(files),"sha256":sha(out.read_bytes())}))

def restore(phase):
    data=json.loads(gzip.decompress((HERE/phase/"source-delta.json.gz").read_bytes()))
    assert data["baseArchiveSha256"]==sha((HERE.parent/base.ART).read_bytes())
    p=subprocess.run(["rtk","proxy","python3","-I",str(HERE.parent/"source.py"),"restore"],check=True,capture_output=True,text=True)
    scratch=Path(p.stdout.strip())
    def safe(name):
        rel=Path(name)
        assert not rel.is_absolute() and ".." not in rel.parts
        path=scratch/rel
        assert path.resolve()==path and path.is_relative_to(scratch)
        return path
    try:
        for name in data["removed"]: safe(name).unlink()
        for name,item in data["changed"].items():
            path=safe(name);path.parent.mkdir(parents=True,exist_ok=True)
            body=base64.b64decode(item["bytes"],validate=True)
            assert sha(body)==item["sha256"]
            path.write_bytes(body)
        assert version(scratch)==data["policy"]
        print(str(scratch))
    except BaseException:
        shutil.rmtree(scratch,ignore_errors=True)
        raise

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=["freeze","restore"])
    parser.add_argument("phase",choices=["coding","prediction"])
    args=parser.parse_args()
    (freeze if args.mode=="freeze" else restore)(args.phase)
