"""Seal or restore v2.3.6 as a verified delta over the immutable main source archive."""
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

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("study_source", HERE.parent / "source.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
digest = lambda body: hashlib.sha256(body).hexdigest()
delta_file = HERE / "source-delta.json.gz"
catalog = "packages/learner-contracts/src/judgement/teaching-policy-catalog.ts"
version = "keating-teaching-policy/v2.3.6"

def check_version(root):
    assert re.search(r'export const TEACHING_POLICY_VERSION = "([^"]+)"', (root/catalog).read_text()).group(1) == version

def freeze():
    check_version(base.ROOT)
    meta = json.loads((HERE.parent/base.DESCRIPTOR).read_bytes())
    assert digest((HERE.parent/base.ART).read_bytes()) == meta["archiveSha256"]
    names = base.included()
    changed = {}
    for name in names:
        data = (base.ROOT/name).read_bytes()
        if digest(data) != meta["files"].get(name):
            changed[name] = {"sha256":digest(data), "body":base64.b64encode(data).decode("ascii")}
    info = {"policy":version, "count":len(names), "baseSha256":meta["archiveSha256"],
            "changed":changed, "removed":sorted(set(meta["files"])-set(names))}
    with delta_file.open("xb") as f:
        f.write(gzip.compress(json.dumps(info,sort_keys=True,separators=(",",":")).encode(),mtime=0))
    print(json.dumps({"policy":version,"files":len(names),"changed":len(changed),"sha256":digest(delta_file.read_bytes())}))

def restore():
    info = json.loads(gzip.decompress(delta_file.read_bytes()))
    assert info["policy"] == version and info["baseSha256"] == digest((HERE.parent/base.ART).read_bytes())
    result = subprocess.run(["rtk","proxy","python3","-I",str(HERE.parent/"source.py"),"restore"],check=True,capture_output=True,text=True)
    root = Path(result.stdout.strip())
    def path(name):
        rel = Path(name)
        p = root/rel
        assert not rel.is_absolute() and ".." not in rel.parts and p.resolve() == p and p.is_relative_to(root)
        return p
    try:
        for name in info["removed"]:
            path(name).unlink()
        for name, change in info["changed"].items():
            p = path(name)
            p.parent.mkdir(parents=True,exist_ok=True)
            data = base64.b64decode(change["body"],validate=True)
            assert digest(data) == change["sha256"]
            p.write_bytes(data)
        check_version(root)
        print(root)
    except BaseException:
        shutil.rmtree(root,ignore_errors=True)
        raise

if __name__ == "__main__":
    assert len(sys.argv)==2 and sys.argv[1] in ("freeze","restore")
    (freeze if sys.argv[1]=="freeze" else restore)()
