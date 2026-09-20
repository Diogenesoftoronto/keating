"""Pinned soft-target ensemble. Original judge probabilities remain probability targets.

CatBoost documents CrossEntropy labels as positive-class probabilities in [0,1]:
https://catboost.ai/docs/en/concepts/python-reference_catboost_fit
This trainer sees fit groups only. TypeScript recomputes target-specific holdout
comparisons and artifact identity; no trainer-reported score is trusted.
"""
import json
import math
import os
import sys
from pathlib import Path

from boosting_model import DEFAULT_PARAMETERS, SEED, export_model_json, feature_matrix


def train(dataset):
    import catboost

    if catboost.__version__ != "1.2.10" or dataset.get("labelKind") != "judgement-probability":
        raise ValueError("Wrong trainer or label kind")
    features = dataset.get("features")
    rows = dataset.get("observations")
    if not isinstance(features, list) or not 0 < len(features) <= 32 or len(set(features)) != len(features):
        raise ValueError("Invalid features")
    if not isinstance(rows, list) or not 0 < len(rows) <= 2000:
        raise ValueError("Invalid rows")
    groups, ids = {}, set()
    for row in rows:
        if row.get("split") not in ("fit", "validation") or row.get("rowId") in ids:
            raise ValueError("Invalid row identity")
        ids.add(row["rowId"])
        group = row.get("groupId")
        if not isinstance(group, str) or group in groups and groups[group] != row["split"]:
            raise ValueError("Group overlap")
        groups[group] = row["split"]
        label = row.get("label")
        values = row.get("features")
        if isinstance(label, bool) or not isinstance(label, (int, float)) or not math.isfinite(label) or not 0 <= label <= 1:
            raise ValueError("Invalid probability target")
        if not isinstance(values, dict) or not values or not set(values) <= set(features):
            raise ValueError("Invalid feature row")
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values.values()):
            raise ValueError("Invalid feature value")
    fit = [row for row in rows if row["split"] == "fit"]
    if not fit or not any(row["split"] == "validation" for row in rows):
        raise ValueError("Missing split")
    parameters = {**DEFAULT_PARAMETERS, "depth": 3, "loss_function": "CrossEntropy"}
    model = catboost.CatBoost(params={**parameters, "random_seed": SEED})
    model.fit(feature_matrix(fit, features), [row["label"] for row in fit])
    return {"framework": {"name": "catboost", "version": catboost.__version__, "parameters": parameters},
            "model": export_model_json(model)}


def main(argv):
    if len(argv) != 2:
        raise ValueError("Expected input and new output")
    path = Path(argv[0])
    if path.stat().st_size > 5_000_000:
        raise ValueError("Input too large")
    result = train(json.loads(path.read_text(encoding="utf-8")))
    with os.fdopen(os.open(argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as output:
        output.write(json.dumps(result))
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        print("Decision policy training failed", file=sys.stderr)
        sys.exit(1)
