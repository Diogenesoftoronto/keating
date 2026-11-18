"""Run only the two inspected, hash-pinned synthetic snippets with local Python."""
import hashlib
import json
import re
from pathlib import Path

folder = Path(__file__).parent / "receipts"
examples = {
    "jev": ("3b1c260ed1c47487afae78e2e0e945f2e6f8d4b696c7ffd2d718f9000a934c86", "len(fruits) + 1", "len(fruits)"),
    "google": ("b08f53fc5ade987ded5b4d8273c4c7f4528f0d78f622e562a728807d1fdc951d", "numbers[1:]", "numbers"),
}

def check(source):
    output = []
    try:
        exec(source, {"__builtins__": {"len": len, "range": range, "print": output.append}})
    except IndexError:
        return output, "IndexError"
    return output, None

for reviewer, (digest, bug, repair) in examples.items():
    reply = json.loads((folder / f"python-practice--{reviewer}.json").read_text())["public"]["text"]
    code = re.search(r"(?ms)^```python\n(.*?)^```\s*$", reply).group(1)
    assert hashlib.sha256(code.encode()).hexdigest() == digest
    assert code.count(bug) == 1
    actual = check(code)
    repaired = check(code.replace(bug, repair))
    if reviewer == "jev":
        assert actual == (["APPLE", "BANANA", "CHERRY"], "IndexError")
        assert repaired == (["APPLE", "BANANA", "CHERRY"], None)
    else:
        assert actual == ([9], None) and repaired == ([13], None)
    print(json.dumps({"reviewer":reviewer,"original":actual,"local_example_edit":repaired}))
