"""Freeze the boosting fixture the portable TypeScript tests replay.

The fixture is synthetic: three declared features, one deterministic label rule
and a fixed group layout. It exists so the portable tree walk can be checked
against CatBoost's own `predict_proba` without a Python toolchain in the
TypeScript test run. It is fixture data, never learner evidence.

    uv run --no-project --python 3.13 --with catboost==1.2.10 --with numpy \\
        python scripts/training/boosting_fixture.py test/fixtures/boosting
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from boosting_model import DEFAULT_PARAMETERS, export_model_json, feature_matrix, split_rows, train_and_export

FEATURES = ["prediction", "timing", "hint"]
ROW_COUNT = 180
GROUPS = 24
BASELINE = 0.5
POLICY = {
    "minFitRows": 40,
    "minFitGroups": 6,
    "minValidationRows": 20,
    "minValidationGroups": 6,
    "maxValidationEce": 0.25,
    "maxTreeDepth": 6,
}


def synthetic_dataset():
    observations = []
    for index in range(ROW_COUNT):
        prediction = ((index * 37) % 100) / 100
        timing = ((index * 53) % 100) / 100
        features = {"prediction": prediction, "timing": timing}
        if index % 5:
            features["hint"] = float(index % 2)
        observations.append({
            "rowId": f"r{index}",
            "groupId": f"g{index % GROUPS}",
            "split": "validation" if index % 3 == 0 else "fit",
            "label": 1 if prediction + 0.35 * timing > 0.9 else 0,
            "features": features,
            "baseline": BASELINE,
        })
    return {"schemaVersion": 1, "policy": POLICY, "features": FEATURES, "observations": observations}


def main(argv):
    import catboost

    if len(argv) != 1:
        raise SystemExit("Usage: boosting_fixture.py OUTPUT_DIRECTORY")
    dataset = synthetic_dataset()
    fit, _validation = split_rows(dataset)
    parameters = {**DEFAULT_PARAMETERS, "iterations": 100}
    model = catboost.CatBoostClassifier(random_seed=20260919, **parameters)
    model.fit(feature_matrix(fit, FEATURES), [float(row["label"]) for row in fit])
    exported = export_model_json(model)
    probabilities = [row[1] for row in model.predict_proba(feature_matrix(dataset["observations"], FEATURES))]
    directory = Path(argv[0])
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "dataset.json").write_text(json.dumps(dataset, indent=2) + "\n", encoding="utf-8")
    (directory / "catboost-model.json").write_text(json.dumps(exported, indent=2) + "\n", encoding="utf-8")
    (directory / "expected.json").write_text(json.dumps({
        "framework": {"name": "catboost", "version": catboost.__version__, "parameters": parameters},
        "probabilities": {row["rowId"]: probability for row, probability in zip(dataset["observations"], probabilities)},
    }, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))