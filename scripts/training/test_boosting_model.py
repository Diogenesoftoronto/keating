import json
import math
import struct
import unittest

from boosting_model import DEFAULT_PARAMETERS, SEED, export_model_json, feature_matrix, split_rows, train_and_export

FEATURES = ["prediction", "timing", "hint"]


def synthetic_dataset(row_count=180):
    observations = []
    for index in range(row_count):
        prediction = ((index * 37) % 100) / 100
        timing = ((index * 53) % 100) / 100
        label = 1 if prediction + 0.35 * timing > 0.9 else 0
        features = {"prediction": prediction, "timing": timing}
        if index % 5:
            features["hint"] = float(index % 2)
        observations.append({
            "rowId": f"r{index}",
            "groupId": f"g{index % 24}",
            "split": "validation" if index % 3 == 0 else "fit",
            "label": label,
            "features": features,
            "baseline": 0.5,
        })
    return {"schemaVersion": 1, "features": FEATURES, "observations": observations}


def float32(value):
    """CatBoost binarizes float32 values, so a float64 compare can pick a different child."""
    return struct.unpack("f", struct.pack("f", value))[0]


def exported_nan_mode(exported):
    params = exported.get("model_info", {}).get("params", {})
    declared = params.get("flat_params", {}).get("nan_mode")
    return (declared or "Min").lower()


def exported_scale_and_bias(exported):
    def single(entry):
        return entry[0] if isinstance(entry, list) else entry

    value = exported["scale_and_bias"]
    return single(value[0]), single(value[1])


def walk_exported(exported, features, row):
    """Independent tree walk, so the portable walker is checked against CatBoost itself."""
    total = 0.0
    for tree in exported["oblivious_trees"]:
        leaf = 0
        for depth, split in enumerate(tree["splits"]):
            value = row["features"].get(features[split["float_feature_index"]])
            if value is None:
                goes_right = exported_nan_mode(exported) == "max"
            else:
                goes_right = float32(float(value)) > float32(split["border"])
            if goes_right:
                leaf |= 1 << depth
        total += tree["leaf_values"][leaf]
    scale, bias = exported_scale_and_bias(exported)
    return 1 / (1 + math.exp(-(scale * total + bias)))


def trained_export(dataset):
    """Train in-process so CatBoost's own predict_proba can score the same rows."""
    import catboost

    fit, _validation = split_rows(dataset)
    model = catboost.CatBoostClassifier(random_seed=SEED, **DEFAULT_PARAMETERS)
    model.fit(feature_matrix(fit, FEATURES), [float(row["label"]) for row in fit])
    return export_model_json(model), model


class BoostingModelTests(unittest.TestCase):
    def test_exported_trees_reproduce_catboost_probabilities(self):
        dataset = synthetic_dataset()
        exported, model = trained_export(dataset)
        _fit, validation = split_rows(dataset)
        predicted = [row[1] for row in model.predict_proba(feature_matrix(validation, FEATURES))]
        self.assertEqual(len(predicted), len(validation))
        for row, probability in zip(validation, predicted):
            self.assertAlmostEqual(walk_exported(exported, FEATURES, row), probability, places=9)
        self.assertEqual(train_and_export(dataset)["model"]["oblivious_trees"], exported["oblivious_trees"])

    def test_determinism_and_validation_independence(self):
        dataset = synthetic_dataset()
        first = train_and_export(dataset)
        second = train_and_export(dataset)
        self.assertEqual(first["model"]["oblivious_trees"], second["model"]["oblivious_trees"])
        flipped = synthetic_dataset()
        for row in flipped["observations"]:
            if row["split"] == "validation":
                row["label"] = 1 - row["label"]
        self.assertEqual(first["model"]["oblivious_trees"], train_and_export(flipped)["model"]["oblivious_trees"])

    def test_declared_parameters_are_logloss_deterministic_and_serializable(self):
        self.assertEqual(DEFAULT_PARAMETERS["loss_function"], "Logloss")
        self.assertEqual(DEFAULT_PARAMETERS["nan_mode"], "Min")
        self.assertIs(DEFAULT_PARAMETERS["allow_writing_files"], False)
        self.assertEqual(DEFAULT_PARAMETERS["thread_count"], 1)
        json.dumps(DEFAULT_PARAMETERS)

    def test_rejects_unknown_features_and_missing_validation_rows(self):
        dataset = synthetic_dataset()
        dataset["observations"][0]["features"] = {"prediction": 0.1, "unexpected": 0.2}
        with self.assertRaises(ValueError):
            train_and_export(dataset)
        dataset = synthetic_dataset()
        for row in dataset["observations"]:
            row["split"] = "fit"
        with self.assertRaises(ValueError):
            train_and_export(dataset)

    def test_rejects_non_logloss_and_unknown_parameters(self):
        with self.assertRaises(ValueError):
            train_and_export(synthetic_dataset(), parameters={"loss_function": "RMSE"})
        with self.assertRaises(ValueError):
            train_and_export(synthetic_dataset(), parameters={"iterations_": 10})


if __name__ == "__main__":
    unittest.main()