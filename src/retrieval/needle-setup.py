#!/usr/bin/env python3
"""Explicit one-time asset setup; normal retrieval never downloads anything.

Run with the cactus-needle==3.0.1 venv Python, --cache DIR --config FILE.
Only the pinned native inference engine and base weights are downloaded.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import urllib.request
import zipfile

os.environ.update(NEEDLE_TELEMETRY="0", DO_NOT_TRACK="1", HF_HUB_DISABLE_TELEMETRY="1")
REVISION = "b274efcb211a9eef48c9a88da4b43bd569696a39"
VERSION = "3.0.1"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    import needle
    from needle.agent.fetch import _platform_tag, _lib_name
    if needle.__version__ != VERSION:
        raise SystemExit("Install cactus-needle==3.0.1 in this Python environment first.")
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    engine = cache / _lib_name()
    weights = cache / "needle3.cact"

    def download(name):
        url = f"https://huggingface.co/Cactus-Compute/needle3/resolve/{REVISION}/{name}"
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read(128 * 1024 * 1024 + 1)
        if len(data) > 128 * 1024 * 1024:
            raise ValueError("asset exceeds size limit")
        return data

    wheel = f"python/cactus_needle-{VERSION}-py3-none-{_platform_tag()}.whl"
    with zipfile.ZipFile(io.BytesIO(download(wheel))) as archive:
        lib = Path(_lib_name())
        data = archive.read(f"needle/{lib.stem}3{lib.suffix}")
    engine.write_bytes(data)
    engine.chmod(0o600)
    weights.write_bytes(download("needle3.cact"))
    weights.chmod(0o600)
    config = {"python": os.path.abspath(sys.executable), "engine": str(engine), "weights": str(weights),
              "engineSha256": hashlib.sha256(engine.read_bytes()).hexdigest(),
              "weightsSha256": hashlib.sha256(weights.read_bytes()).hexdigest(),
              "packageVersion": VERSION, "sourceRevision": REVISION}
    args.config.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with args.config.open("x", encoding="utf8") as handle:
        os.chmod(args.config, 0o600)
        json.dump(config, handle, indent=2)
    print(json.dumps({"configured": str(args.config), "version": VERSION, "sourceRevision": REVISION}))


if __name__ == "__main__":
    main()
