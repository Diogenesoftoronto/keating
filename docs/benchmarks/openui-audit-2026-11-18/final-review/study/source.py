"""Freeze or restore product code for this study. The archive contains source and classroom assets, never credentials or learner storage."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
ART = "product-v2.3.3.tar.gz"
DESCRIPTOR = "product-v2.3.3.json"

def digest(body):
    return hashlib.sha256(body).hexdigest()

def included():
    items = ["package.json", "tsconfig.json", "bun.lock", "src", "shared", "pi",
             "scripts/training/export_system_prompt.ts", "scripts/prompt-adherence", "scripts/openui-diagnostics/gemini-decision.ts",
             "web/src", "web/server", "web/scripts", "web/styled-system", "web/index.html", "web/package.json",
             "web/tsconfig.json", "web/vite.config.ts", "web/nitro.config.ts", "web/panda.config.ts", "web/postcss.config.cjs",
             "web/bun.lock", "web/public/avatars", "web/public/needle-wasm", "web/public/vendor", "web/public/textures",
             "spikes/flue-host/src","spikes/flue-host/contracts","spikes/flue-host/nodepod","spikes/flue-host/dist",
             "spikes/flue-host/package.json","spikes/flue-host/tsconfig.json","spikes/flue-host/vite.config.ts","spikes/flue-host/bun.lock"]
    for pkg in sorted((ROOT / "packages").iterdir()):
        if (pkg / "package.json").is_file():
            items.extend([str((pkg/"package.json").relative_to(ROOT)), str((pkg/"src").relative_to(ROOT))])
    paths = set()
    for item in items:
        path = ROOT / item
        for f in ([path] if path.is_file() else path.rglob("*")):
            parts = f.relative_to(ROOT).parts
            if (not f.is_file() or f.is_symlink() or any(x.startswith(".") or x in ("test","node_modules","coverage") for x in parts)
                    or f.suffix in (".map",".pem",".key",".log") or ".test." in f.name or ".spec." in f.name):
                continue
            paths.add(f.relative_to(ROOT).as_posix())
    return sorted(paths)

def freeze():
    if (HERE/ART).exists() or (HERE/DESCRIPTOR).exists():
        raise ValueError("A product freeze already exists")
    entries = {}
    with (HERE/ART).open("xb") as out, gzip.GzipFile(fileobj=out,filename="",mode="wb",mtime=0,compresslevel=6) as gz:
        with tarfile.open(fileobj=gz,mode="w|") as tar:
            for name in included():
                data = (ROOT/name).read_bytes()
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(data))
                entries[name] = digest(data)
    descriptor = {"version":1, "policy":"keating-teaching-policy/v2.3.3", "archive":ART,
                  "archiveSha256":digest((HERE/ART).read_bytes()), "files":entries}
    with (HERE/DESCRIPTOR).open("x") as out: json.dump(descriptor,out,indent=2);out.write("\n")
    print(json.dumps({"files":len(entries),"archiveSha256":descriptor["archiveSha256"]}))

def restore():
    meta = json.loads((HERE/DESCRIPTOR).read_text())
    assert digest((HERE/ART).read_bytes()) == meta["archiveSha256"]
    dest = Path(tempfile.mkdtemp(prefix="keating-final-classroom-"))
    try:
        with tarfile.open(HERE/ART, "r:gz") as tar:
            seen = set()
            for member in tar:
                rel = Path(member.name)
                assert member.isfile() and not rel.is_absolute() and ".." not in rel.parts and member.name not in seen
                data = tar.extractfile(member).read()
                assert digest(data) == meta["files"][member.name]
                path = dest / rel
                path.parent.mkdir(parents=True,exist_ok=True)
                with path.open("xb") as out: out.write(data)
                seen.add(member.name)
            assert seen == set(meta["files"])
        packages = {}
        for p in (dest/"packages").glob("*/package.json"):
            packages[json.loads(p.read_text())["name"]] = p.parent
        for relative in ["node_modules","web/node_modules","spikes/flue-host/node_modules"]:
            modules = dest/relative
            modules.mkdir(exist_ok=True,parents=True)
            for p in (ROOT/relative).iterdir():
                if p.name in ("@keating",".cache",".vite",".vite-temp"): continue
                (modules/p.name).symlink_to(p)
            scope=modules/"@keating"
            scope.mkdir(exist_ok=True)
            for name,p in packages.items():
                if name.startswith("@keating/"): (scope/name.split("/")[1]).symlink_to(p)
        # Link only the study evidence directory. The source and owner paths of the product stay isolated.
        evidence = dest / HERE.relative_to(ROOT)
        evidence.parent.mkdir(parents=True,exist_ok=True)
        evidence.symlink_to(HERE)
        print(str(dest))
    except BaseException:
        shutil.rmtree(dest,ignore_errors=True)
        raise

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=["freeze","restore"])
    if parser.parse_args().mode=="freeze":freeze()
    else:restore()
