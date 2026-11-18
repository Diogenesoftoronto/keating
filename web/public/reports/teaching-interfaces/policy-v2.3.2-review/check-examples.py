"""Run the four inspected, fixed Python fixtures in this study."""
import hashlib
import json
import re
from pathlib import Path

folder = Path(__file__).parent
examples = {
    "python-practice--jev--1": ("99f9b2002cddff7edbacfb884c25a13d008f2c5b91ce05efae1a2171429946e1", [["Even numbers:", [8, 12, 20]]], None),
    "python-practice--jev--2": ("3b1c260ed1c47487afae78e2e0e945f2e6f8d4b696c7ffd2d718f9000a934c86", [["APPLE"], ["BANANA"], ["CHERRY"]], "IndexError"),
    "python-practice--google--1": ("5dd145001b3e5b283be73a3cf9da0dc2500b0e680c11001962e6ca26c543406f", [[1,"fig"],[2,"banana"],[3,"kiwi"],[4,"strawberry"],["Words longer than 4 letters:",2]], None),
    "python-practice--google--2": ("b08f53fc5ade987ded5b4d8273c4c7f4528f0d78f622e562a728807d1fdc951d", [[9]], None),
}
cases = json.loads((folder / "requests.json").read_text())["cases"]
assert set(examples) == {case["id"] for case in cases}
for case in cases:
    reply = case["request"]["state"]["reply"]["text"]
    match = re.search(r"(?ms)^\x60{3}python\n(.*?)^\x60{3}\s*$", reply)
    assert match
    code = match.group(1)
    digest, expected, expected_error = examples[case["id"]]
    assert hashlib.sha256(code.encode()).hexdigest() == digest
    lines = []
    def emit(*words):
        lines.append(list(words))
    error = None
    try:
        exec(code, {"__builtins__": {"len": len, "range": range, "print": emit}})
    except IndexError:
        error = "IndexError"
    assert (lines, error) == (expected, expected_error)
    print(json.dumps({"draft": case["id"], "printed": lines, "error": error}))
