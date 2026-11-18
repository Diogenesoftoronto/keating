"""Reproduce the old published proofs and the two audit controls using only local, pinned sources."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
STUDY = HERE.parent.parent
ROOT = STUDY.parents[2]
PRODUCT_SHA256 = "e7e75735b4d16491a133ff2ef46fef59c5189044b0d2e1ed28fa7bd3810b42aa"
EVIDENCE = (
    "gemini-decision/journal.mjs", "gemini-decision/protocol.json", "policy-holdout/cohort.json", "cue-paraphrases/protocol.json",
    "policy-v2.3-completion/ledger.json", "policy-v2.3-completion/inputs.json.gz",
    "policy-v2.3-completion/receipts/python-practice--jev.json", "policy-v2.3-completion/receipts/python-practice--google.json",
    "policy-v2.3.2-review/prepare.mjs", "policy-v2.3.2-review/requests.json", "policy-v2.3.2-review/ledger.json",
    "policy-v2.3.3-proof/run.mjs", "policy-v2.3.3-proof/replay.json",
)

def result(*args, cwd=ROOT):
    completed = subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True)
    return completed.stdout.strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["frozen", "current", "cues", "policy-v2.3.4"])
    parser.add_argument("--record", action="store_true", help="Create the expected result once, refusing to replace it")
    args = parser.parse_args()
    archive = HERE.parent / "study" / "product-v2.3.3.tar.gz"
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == PRODUCT_SHA256
    if args.mode == "current":
        product = ROOT
    elif args.mode == "policy-v2.3.4":
        supplement = archive.parent / "supplement"
        assert hashlib.sha256((supplement / "coding/source-delta.json.gz").read_bytes()).hexdigest() == "4a67365e980534c4fd165d6ffa502b4dabfe34991a032adc143601325e721c2d"
        product = Path(result(sys.executable, "-I", str(supplement / "source-delta.py"), "restore", "coding"))
    else:
        product = Path(result(sys.executable, str(archive.parent / "source.py"), "restore"))
    try:
        data = {}
        if args.mode == "frozen":
            destination = product / STUDY.relative_to(ROOT)
            for relative in EVIDENCE:
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(STUDY / relative, target)
            for name in ("policy-v2.3.2-review/prepare.mjs", "policy-v2.3.3-proof/run.mjs"):
                data[name] = json.loads(result("bun", str(destination / name), "--verify", cwd=product))
        if args.mode == "cues":
            data = {key: json.loads(result("bun", str(HERE / "cues.mjs"), str(path), str(STUDY), cwd=path))
                    for key, path in [("frozen", product), ("current", ROOT)]}
        else:
            data["probe"] = json.loads(result("bun", str(HERE / "probe.mjs"), str(product), str(STUDY), cwd=product))
        expected = HERE / (("current" if args.mode == "policy-v2.3.4" else args.mode) + ".json")
        if args.record:
            with expected.open("x") as out:
                json.dump(data, out, indent=2)
                out.write("\n")
        else:
            assert data == json.loads(expected.read_text()), "Result differs from " + str(expected)
        print(json.dumps({"mode": args.mode, "result": expected.name, "paidCalls": 0}))
    finally:
        if args.mode != "current":
            shutil.rmtree(product)

if __name__ == "__main__":
    main()
