"""Run only the four reviewed, pinned beginner programs, in isolated CPython."""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

here = Path(__file__).resolve().parent
receipts = here.parent / "study/supplement/coding/receipts"
pins = {
    "google": ["dc184be2b50deabbd077833fd3b225ace90b2fbd7b9f9c571772cea7ff1641ac"],
    "jev": ["bb28a629ca1ebc4ec48a674df573d7b44376a8511a9c3b76a0532f441f742677",
            "b41153e3688dbc940d70f65cc4018d6fee6dec9ffb9e2a2b9c271c9852a630f0",
            "0eb2bad6556580975e14c846bb7c0773a840d896f945edf6227682d6a3018039"],
}
result = []
for arm, hashes in pins.items():
    receipt = json.loads((receipts / ("odd-filter--minimax--" + arm + ".json")).read_text())
    inputs = ast.literal_eval(re.search(r"in (\[-?[\d, ]+\])", receipt["prompt"]).group(1))
    target = [n for n in inputs if n % 2 == 1]
    for i, (draft, digest) in enumerate(zip(receipt["drafts"], hashes, strict=True)):
        [body] = re.findall(r"^```python\s*\n([\s\S]*?)^```\s*$", draft["text"], re.M)
        assert hashlib.sha256(body.encode()).hexdigest() == digest, "Unknown code is not executable by this fixture"
        with tempfile.TemporaryDirectory() as temp:
            run = subprocess.run([sys.executable, "-I", "-S", "-"], input=body, cwd=temp, text=True, capture_output=True,
                                 env={}, timeout=2, check=True)
        actual = ast.literal_eval(run.stdout.strip())
        result.append({"arm": arm, "attempt": i + 1, "codeSha256": digest, "supplied": inputs, "expected": target,
                       "actual": actual, "showsFault": actual != target, "originallySelected": receipt["selectedAttempt"] == i + 1})
path = here / "python-outputs.json"
if sys.argv[1:] == ["--record"]:
    with path.open("x") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
else:
    assert not sys.argv[1:] and result == json.loads(path.read_text())
print(json.dumps(result))
