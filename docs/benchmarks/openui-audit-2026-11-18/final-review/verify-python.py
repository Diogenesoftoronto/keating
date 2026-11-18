"""Run only seven individually reviewed, content-pinned synthetic Python starters."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
PINNED = {
    "2d201bc5b6cc811d57eae49cc2571ce669fcaa235ad5d6a6ed66532e0cda00cb": "expected: 17\ngot: 11",
    "01ad6604f97c763e98b8d2ab333fea76776b116dbde3bc2f0364d42c0a902da2": "Sum: 4",
    "9d49d1d4d56abf13b52e121aa8ada1a0fb3cf4f91b563b4b29ea4191f8a3e101": "The total is: 27",
    "846291b6d2ab85edd89df2b0b3ea1ec56dd88661636d36bc14426e1dc654fa48": "IndexError: list index out of range",
    "0de640e4551472c4c663354f700f92e1aa0449c33fbd1187fcbb38cc0fce549b": "total: 2",
    "cb111fa7b8696e0cb16f4cc308fa74c0bcb2dcd4c99ddeed10cc2b1858163b9a": "The total is: 108",
    "69252b7f0fda2d70f8a8e260d37f628f8065a1b370df150e2a4b528a2c4dd910": "Sum: 15",
}

def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--verify", action="store_true")
    verify = args.parse_args().verify
    results = []
    with tempfile.TemporaryDirectory(prefix="keating-exercise-check-") as work:
        packet = Path(work) / "packet.json"
        subprocess.run(["rtk", "bun", str(HERE / "blind.mjs"), str(packet)], check=True, capture_output=True)
        for entry in json.loads(packet.read_text())["entries"]:
            if entry["task"] != "python-sum":
                continue
            blocks = re.findall(r"^```python\n(.*?)\n```$", entry["text"], re.M | re.S)
            assert len(blocks) == 1
            source = blocks[0]
            digest = hashlib.sha256(source.encode()).hexdigest()
            expected = PINNED[digest]  # Unreviewed source cannot reach the interpreter.
            run = subprocess.run([sys.executable, "-I", "-S", "-B", "-"], input=source, text=True,
                                 cwd=work, env={}, timeout=2, capture_output=True)
            actual = run.stdout.strip() if run.returncode == 0 else run.stderr.strip().splitlines()[-1]
            assert actual == expected
            results.append({"body":entry["id"], "sourceSha256":digest, "intendedSum":17,
                            "observed":actual,"exitCode":run.returncode})
    assert len({r["sourceSha256"] for r in results}) == len(PINNED)
    output = HERE / "python-execution.json"
    content = json.dumps(results, indent=2) + "\n"
    if verify:
        assert output.read_text() == content
    else:
        output.write_text(content)
    print(f"{len(results)} synthetic starters reproduced on their supplied input.")

if __name__ == "__main__":
    main()
