# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["numpy==2.2.6", "scikit-learn==1.7.2"]
# ///
"""Reproducible text/raw/SAE probes with family grouping and held-out metrics.

Optional numpy/sklearn imports are deferred. No provider calls. Model coefficients
and preprocessing are exported as JSON, not an executable pickle. Use --help.
"""
import argparse
from importlib.metadata import version
import json
from pathlib import Path

from observer_core import canonical, digest


def split_groups(rows, seed=42):
    """Union family plus declared person/conversation/template aliases, then split.

Supply split on every row to use a preregistered split. Otherwise a seeded hash
ordering partitions whole connected groups 60/20/20, without consulting labels.
"""
    parents = {}

    def root(x):
        parents.setdefault(x, x)
        if parents[x] != x:
            parents[x] = root(parents[x])
        return parents[x]

    for row in rows:
        family = row.get("family_id")
        aliases = row.get("group_ids", [])
        if not isinstance(family, str) or not family or not isinstance(aliases, list):
            raise ValueError("Family and list of group aliases required")
        if any(not isinstance(a, str) or not a for a in aliases):
            raise ValueError("Group aliases must be nonempty namespaced strings")
        keys = ["family:" + family, *aliases]
        for key in keys:
            a, b = root(keys[0]), root(key)
            parents[max(a, b)] = min(a, b)
    components = [root("family:" + r["family_id"]) for r in rows]
    unique = sorted(set(components), key=lambda k: (digest([seed, k]), k))
    declared = any("split" in r for r in rows)
    if declared:
        assignments = {}
        for row, group in zip(rows, components):
            split = row.get("split")
            if split not in {"train", "calibration", "test"}:
                raise ValueError("Every row needs a valid declared split")
            if group in assignments and assignments[group] != split:
                raise ValueError("Related family/person/template crosses declared splits")
            assignments[group] = split
    else:
        if len(unique) < 5:
            raise ValueError("At least five independent groups required; do not split branches")
        n_test = max(1, len(unique) // 5)
        n_cal = max(1, len(unique) // 5)
        assignments = {g: "test" if i < n_test else "calibration" if i < n_test + n_cal else "train"
                       for i, g in enumerate(unique)}
    if set(assignments.values()) != {"train", "calibration", "test"}:
        raise ValueError("All three disjoint splits are required")
    return {"method": "declared" if declared else "sha256_group_order_60_20_20",
            "seed": seed, "group_assignment": assignments,
            "rows": {r["record_id"]: {"group": g, "split": assignments[g]} for r, g in zip(rows, components)}}


def calibration_metrics(labels, probabilities, bins=10):
    import numpy as np
    from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
    y, p = np.asarray(labels), np.asarray(probabilities, dtype=float)
    if not len(y) or y.shape != p.shape or not np.isin(y, [0, 1]).all():
        raise ValueError("Aligned nonempty binary labels required")
    if not np.isfinite(p).all() or ((p < 0) | (p > 1)).any() or type(bins) is not int or bins < 1:
        raise ValueError("Finite probabilities and positive bin count required")
    assignments = np.minimum((p * bins).astype(int), bins - 1)
    table = []
    for i in range(bins):
        mask = assignments == i
        n = int(mask.sum())
        table.append({"lower": i / bins, "upper": (i + 1) / bins, "count": n,
                      "mean_probability": float(p[mask].mean()) if n else None,
                      "positive_fraction": float(y[mask].mean()) if n else None})
    ece = sum(r["count"] * abs(r["mean_probability"] - r["positive_fraction"])
              for r in table if r["count"]) / len(y)
    return {"n": len(y), "positive_count": int(y.sum()), "brier": float(brier_score_loss(y, p)),
            "log_loss": float(log_loss(y, p, labels=[0, 1])),
            "accuracy_at_0_5": float(accuracy_score(y, p >= .5)),
            "roc_auc": float(roc_auc_score(y, p)) if len(set(y)) == 2 else None,
            "ece": float(ece), "reliability_bins": table}


def bootstrap_brier(labels, probabilities, groups, seed=42, repetitions=200):
    """Cluster bootstrap over connected test families, never over individual turns."""
    import numpy as np
    unique = sorted(set(groups))
    if len(unique) < 2:
        return {"interval_95": None, "reason": "Fewer than two independent test groups"}
    rng = np.random.default_rng(seed)
    by_group = {g: [i for i, x in enumerate(groups) if x == g] for g in unique}
    errors = (np.asarray(labels) - np.asarray(probabilities)) ** 2
    sampled = [float(errors[[i for g in rng.choice(unique, len(unique)) for i in by_group[g]]].mean())
               for _ in range(repetitions)]
    return {"interval_95": np.quantile(sampled, [.025, .975]).tolist(),
            "repetitions": repetitions, "unit": "connected_source_family", "seed": seed}


def feature_matrix(rows, mode, *, width=None):
    import numpy as np
    from scipy.sparse import csr_matrix
    if mode == "text":
        return [r["text"] for r in rows]
    if mode == "raw":
        matrix = np.asarray([r["raw"] for r in rows], dtype=float)
        if matrix.ndim != 2 or not matrix.shape[1] or not np.isfinite(matrix).all():
            raise ValueError("Aligned finite raw vectors required")
        return matrix
    if mode != "sae" or type(width) is not int or width < 1:
        raise ValueError("Valid sparse dictionary width required")
    values, columns, pointers = [], [], [0]
    for row in rows:
        for key, value in sorted(row["sae"].items(), key=lambda kv: int(kv[0])):
            index = int(key)
            if str(index) != key or not 0 <= index < width or not np.isfinite(value):
                raise ValueError("Invalid sparse feature index/value")
            values.append(value)
            columns.append(index)
        pointers.append(len(values))
    return csr_matrix((values, columns, pointers), shape=(len(rows), width), dtype=float)


def fit_probes(artifact, target, *, boundary, definition, seed=42):
    """Fit three identical-label baselines; calibration never sees test data.

Labels are 0, 1 or null/missing. Unknown labels still keep their family in one
split but do not train, calibrate, or evaluate. No hyperparameter test search.
"""
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import MaxAbsScaler, StandardScaler
    manifest, rows = artifact["manifest"], artifact["rows"]
    if artifact.get("manifest_sha256") != digest(manifest):
        raise ValueError("Measurement manifest checksum mismatch")
    if not rows or len({r["record_id"] for r in rows}) != len(rows):
        raise ValueError("Nonempty unique records required")
    if any(r.get("observer_manifest_sha256") != digest(manifest) for r in rows):
        raise ValueError("Mixed or missing observer manifests")
    if boundary not in {"pre_action", "delivered", "retrospective"} or not definition.strip():
        raise ValueError("Explicit boundary and operational concept definition required")
    # Group all supplied boundaries first, so excluding one cannot break alias links.
    split = split_groups(rows, seed)
    selected = sorted([r for r in rows if r.get("boundary") == boundary], key=lambda r: r["record_id"])
    if not selected:
        raise ValueError("No examples at requested boundary")
    known, unknown = [], []
    for row in selected:
        label = row.get("labels", {}).get(target)
        if label is None:
            unknown.append(row)
            continue
        if type(label) not in (int, bool) or label not in (0, 1):
            raise ValueError("Labels must be binary 0/1 or null; soft labels require a declared objective")
        if not row.get("label_provenance", {}).get(target):
            raise ValueError("Known labels require explicit provenance")
        known.append(row)
    partitions = {s: [r for r in known if split["rows"][r["record_id"]]["split"] == s]
                  for s in ("train", "calibration", "test")}
    for s, items in partitions.items():
        labels = {r["labels"][target] for r in items}
        if not items or (s != "test" and len(labels) != 2):
            raise ValueError(f"{s} requires known labels (both classes for train and calibration); do not resplit after inspecting test")
    train, cal, test = (partitions[s] for s in ("train", "calibration", "test"))
    y_train, y_cal, y_test = (np.array([r["labels"][target] for r in part]) for part in (train, cal, test))
    widths = {r["sae_width"] for r in known}
    if len(widths) != 1:
        raise ValueError("Mixed SAE dictionaries")
    width = widths.pop()
    results = {}
    for mode in ("text", "raw", "sae"):
        preprocessing = (TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), max_features=20000)
                         if mode == "text" else StandardScaler() if mode == "raw" else MaxAbsScaler())
        x_train = preprocessing.fit_transform(feature_matrix(train, mode, width=width))
        x_cal = preprocessing.transform(feature_matrix(cal, mode, width=width))
        x_test = preprocessing.transform(feature_matrix(test, mode, width=width))
        classifier = LogisticRegression(penalty="l1", solver="liblinear", C=1.0, max_iter=3000,
                                         random_state=seed).fit(x_train, y_train)
        if classifier.n_iter_.max() >= 3000:
            raise ValueError("Probe did not converge; metrics would be unreliable")
        calibrator = LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000, random_state=seed)
        calibrator.fit(classifier.decision_function(x_cal).reshape(-1, 1), y_cal)
        if calibrator.n_iter_.max() >= 1000:
            raise ValueError("Calibrator did not converge")
        uncalibrated = classifier.predict_proba(x_test)[:, 1]
        probabilities = calibrator.predict_proba(classifier.decision_function(x_test).reshape(-1, 1))[:, 1]
        names = (preprocessing.get_feature_names_out().tolist() if mode == "text"
                 else [f"{mode}:{i}" for i in range(x_train.shape[1])])
        coefficients = classifier.coef_[0]
        order = sorted(range(len(names)), key=lambda i: (-abs(coefficients[i]), names[i]))
        preprocessing_state = ({"vocabulary": {k: int(v) for k, v in preprocessing.vocabulary_.items()},
                                "idf": preprocessing.idf_.tolist(), "analyzer": "char_wb", "ngram_range": [3, 5]}
                               if mode == "text" else {"scale": preprocessing.scale_.tolist(),
                                    "mean": preprocessing.mean_.tolist() if mode == "raw" else None})
        results[mode] = {
            "test": calibration_metrics(y_test, probabilities),
            "uncalibrated_test": calibration_metrics(y_test, uncalibrated),
            "test_brier_bootstrap": bootstrap_brier(y_test, probabilities,
                    [split["rows"][r["record_id"]]["group"] for r in test], seed),
            "predictions": [{"record_id": r["record_id"], "family_id": r["family_id"],
                             "label": int(y), "probability": float(p), "uncalibrated_probability": float(u)}
                            for r, y, p, u in zip(test, y_test, probabilities, uncalibrated)],
            "feature_card": {"definition": definition, "target": target, "boundary": boundary,
                             "observer_manifest_sha256": digest(manifest), "pooling": manifest.get("pooling"),
                             "module": manifest.get("module"), "layer": manifest.get("layer"),
                             "nonzero_coefficients": int(np.count_nonzero(coefficients)),
                             "top_coefficients": [{"feature": names[i], "weight": float(coefficients[i])}
                                                  for i in order[:30] if coefficients[i] != 0],
                             "permitted_use": "Research classification at the declared boundary; not a validated reward or diagnosis",
                             "failure_cases": [p for p in [
                                 {"record_id": r["record_id"], "label": int(y), "probability": float(p)}
                                 for r, y, p in zip(test, y_test, probabilities)] if (p["probability"] >= .5) != p["label"]]},
            "model": {"preprocessing": preprocessing_state, "coefficients": coefficients.tolist(),
                      "intercept": float(classifier.intercept_[0]), "classes": [0, 1],
                      "calibration_coefficient": float(calibrator.coef_[0, 0]),
                      "calibration_intercept": float(calibrator.intercept_[0]), "threshold": .5}}
    return {"schema_version": 1, "evidence": manifest.get("evidence", "unspecified"),
            "target": target, "definition": definition, "boundary": boundary,
            "input_sha256": digest(artifact), "observer_manifest": manifest,
            "split_manifest": split, "split_manifest_sha256": digest(split),
            "protocol": {"seed": seed, "classifier": "L1 logistic C=1 liblinear",
                         "calibration": "sigmoid logistic C=1 fitted on calibration split only",
                         "threshold": .5, "test_used_for_selection": False,
                         "uncertainty_unit": "connected_source_family"},
            "counts": {s: len(p) for s, p in partitions.items()}, "unknown_labels_excluded": len(unknown),
            "known_label_provenance": {r["record_id"]: r["label_provenance"][target] for r in known},
            "software": {p: version(p) for p in ("numpy", "scipy", "scikit-learn")}, "baselines": results,
            "limitations": ["Public families must be admitted upstream; aliases are not inferred from prose.",
                            "Binary concept classification only; unknown labels are never negatives.",
                            "Calibration and CIs need adequate independent source families.",
                            "No causal feature, span-localization accuracy, or human learning claim established."]}


def predict_probe(model, rows, mode, *, width=None):
    """Use exported JSON coefficients/preprocessing without refitting or pickle."""
    import numpy as np
    from scipy.special import expit
    from sklearn.feature_extraction.text import TfidfVectorizer
    state = model["preprocessing"]
    x = feature_matrix(rows, mode, width=width)
    if mode == "text":
        transformer = TfidfVectorizer(analyzer=state["analyzer"], ngram_range=tuple(state["ngram_range"]),
                                      vocabulary=state["vocabulary"])
        transformer.idf_ = np.asarray(state["idf"])
        x = transformer.transform(x)
    elif mode == "raw":
        x = (x - np.asarray(state["mean"])) / np.asarray(state["scale"])
    else:
        x = x.multiply(1 / np.asarray(state["scale"]))
    scores = np.asarray(x @ np.asarray(model["coefficients"])).ravel() + model["intercept"]
    return expit(scores * model["calibration_coefficient"] + model["calibration_intercept"]).tolist()


def authored_fixture(families=30):
    """Deterministic demonstration data. Numeric vectors are authored, NOT Qwen.

Each family has a matched positive/negative/unknown. This is a mechanics demo,
not a test of pedagogical validity or simulator quality. No model/download.
"""
    import random
    rng = random.Random(17)
    manifest = {"evidence": "authored_fixture_not_model_activations", "layer": None,
                "module": None, "pooling": "authored_numeric_vectors", "schema_version": 1}
    rows = []
    for family in range(families):
        for label in (0, 1, None):
            signal = (label or 0) + rng.gauss(0, .8)
            rows.append({"record_id": f"authored-{family}-{label}", "family_id": f"authored-{family}",
                         "boundary": "delivered", "source": "authored", "group_ids": [],
                         "observer_manifest_sha256": digest(manifest),
                         "text": ("Learner requested a hint. Tutor supplied the final answer."
                                  if label else "Learner requested a hint. Tutor asked about unit size."),
                         "raw": [signal, rng.gauss(0, 1), .3 * signal], "sae": {"0": signal, "3": rng.random()},
                         "sae_width": 8, "labels": {"premature_answer": label},
                         "label_provenance": {"premature_answer": "authored illustration, not expert annotation"}})
    return {"manifest": manifest, "manifest_sha256": digest(manifest), "rows": rows}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Extraction artifact JSON")
    parser.add_argument("output", type=Path, help="New report JSON, refuses overwrite")
    parser.add_argument("--target", required=True)
    parser.add_argument("--boundary", choices=("pre_action", "delivered", "retrospective"), required=True)
    parser.add_argument("--definition", required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)
    if args.output.exists():
        raise FileExistsError(args.output)
    report = fit_probes(json.loads(args.input.read_text()), args.target, boundary=args.boundary,
                        definition=args.definition, seed=args.seed)
    with args.output.open("x") as stream:
        stream.write(canonical(report) + "\n")
    print(canonical({"output": str(args.output), "counts": report["counts"], "evidence": report["evidence"]}))


if __name__ == "__main__":
    main()
