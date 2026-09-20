"""Fixed depth-three ensemble for the source-bound CLI quiz fitting command."""
import json
import os
import sys
from pathlib import Path

from boosting_model import train_and_export


def main(argv):
    if len(argv) != 2:
        raise ValueError("Expected dataset and new export paths")
    import catboost

    if catboost.__version__ != "1.2.10":
        raise ValueError("Trainer version mismatch")
    dataset = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    if dataset.get("policy", {}).get("maxTreeDepth") != 3:
        raise ValueError("Target depth mismatch")
    result = train_and_export(dataset, parameters={"depth": 3})
    # Parent uses a private temporary directory; never replace an existing export.
    with os.fdopen(os.open(argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as output:
        output.write(json.dumps(result))
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        print("Quiz ensemble training failed", file=sys.stderr)
        sys.exit(1)
