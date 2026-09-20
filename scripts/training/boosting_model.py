"""Fit the CatBoost ensemble that the portable boosting artifact pins.

The artifact contract lives in TypeScript: it validates the exported model,
recomputes every metric from the held-out rows and derives the fit status. This
module therefore reports no score at all. It trains on fit rows only, so the
held-out groups stay independent, and it exports the model in CatBoost's JSON
format, which is the one shape the portable normalizer accepts.

Determinism is deliberate: one thread, a fixed seed and Plain boosting, so the
same dataset always produces the same ensemble.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

SEED = 20260919
MAX_OBSERVATIONS = 20_000
MAX_FEATURES = 512

DEFAULT_PARAMETERS = {
    "loss_function": "Logloss",
    "boosting_type": "Plain",
    "iterations": 300,
    "depth": 4,
    "learning_rate": 0.05,
    "l2_leaf_reg": 3.0,
    "random_strength": 1.0,
    "bootstrap_type": "Bernoulli",
    "subsample": 0.8,
    "rsm": 1.0,
    "nan_mode": "Min",
    "thread_count": 1,
    "allow_writing_files": False,
    "verbose": False,
}


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _features(dataset):
    features = dataset.get("features")
    _require(isinstance(features, list) and 0 < len(features) <= MAX_FEATURES, "Dataset needs a feature list")
    _require(len(set(features)) == len(features), "Feature names must be unique")
    _require(all(isinstance(name, str) and name for name in features), "Feature names must be non-empty strings")
    return features


def split_rows(dataset):
    """Split observations by their declared split, refusing anything else."""
    declared = set(_features(dataset))
    observations = dataset.get("observations")
    _require(isinstance(observations, list) and 0 < len(observations) <= MAX_OBSERVATIONS, "Dataset needs observations")
    fit, validation = [], []
    for row in observations:
        _require(isinstance(row, dict), "Each observation must be an object")
        which = row.get("split")
        _require(which in ("fit", "validation"), "Observations must declare a fit or validation split")
        _require(row.get("label") in (0, 1), "Labels must be observed 0 or 1")
        values = row.get("features")
        _require(isinstance(values, dict) and values, "Each observation needs a features object")
        _require(set(values) <= declared, "Unknown feature name")
        _require(all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values.values()),
                 "Feature values must be numbers")
        (fit if which == "fit" else validation).append(row)
    _require(fit, "No fit rows")
    _require(validation, "No validation rows")
    return fit, validation


def feature_matrix(rows, features):
    """Dense numeric matrix in the declared order; a missing feature is NaN."""
    return [[float(row["features"][name]) if name in row["features"] else float("nan") for name in features]
            for row in rows]


def export_model_json(model):
    """CatBoost's JSON export, read back from a private temporary file."""
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "model.json"
        model.save_model(str(path), format="json")
        return json.loads(path.read_text(encoding="utf-8"))


def train_and_export(dataset, parameters=None, seed=SEED):
    """Train on fit rows and return the export the artifact contract accepts."""
    import catboost

    features = _features(dataset)
    fit, _validation = split_rows(dataset)
    matrix = feature_matrix(fit, features)
    labels = [float(row["label"]) for row in fit]
    resolved = dict(DEFAULT_PARAMETERS)
    if parameters:
        unknown = set(parameters) - set(DEFAULT_PARAMETERS)
        _require(not unknown, "Unknown training parameter")
        resolved.update(parameters)
    _require(resolved["loss_function"] == "Logloss", "The artifact contract describes Logloss models only")
    _require(resolved["nan_mode"] in ("Min", "Max"), "Unsupported nan_mode")
    _require(int(resolved["depth"]) == resolved["depth"] and 1 <= resolved["depth"] <= 12, "Depth must be an integer in 1..12")
    model = catboost.CatBoostClassifier(random_seed=seed, **resolved)
    model.fit(matrix, labels)
    return {
        "framework": {"name": "catboost", "version": catboost.__version__, "parameters": resolved},
        "model": export_model_json(model),
    }


def main(argv):
    _require(len(argv) == 2, "Usage: boosting_model.py dataset.json output.json")
    dataset = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    result = train_and_export(dataset)
    Path(argv[1]).write_text(json.dumps(result), encoding="utf-8")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the TypeScript entrypoint
    import sys

    sys.exit(main(sys.argv[1:]))