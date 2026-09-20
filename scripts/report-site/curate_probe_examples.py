#!/usr/bin/env python3
"""Export all 24 authored test probe records using existing local measurements.

Stdlib only; no inference, fitting, downloads, directory scans, or job operations.
Run from any directory with `rtk proxy python3 <this-script> [--check]`.
The only write destination is docs/research-story/probe-examples.json.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/research-story/probe-examples.json"
CORPUS = ".keating/native-learning/premature-answer-probe-v1/"
EXECUTION = ".keating/native-learning/premature-answer-execution-v1/"
# Exact source allowlist. Hashes are SHA256 of file bytes, not canonical JSON.
SOURCES = {
    "records": (CORPUS + "original-records.json", "6d6a0c55ca5907af0811f806ebe5088c1f225c1f00459834e7f3a8bc1bbf2214"),
    "labels": (CORPUS + "labels.json", "94824f8434207262ea16123c8a905848dafecc455fcbe4823d0feee36bd4b9a8"),
    "inputs": (CORPUS + "observer-inputs.json", "42b7a0aff5fc62602309bc737f0425b7d83bc03a21166414a63a67a79e9b7200"),
    "split": (CORPUS + "split-freeze.json", "a7382553fc64709c26025ca8e7def17c637814dd7b4ecefe5515c5f36da2be11"),
    "manifest": (CORPUS + "manifest.json", "ee8da3d30f6d5502dbb875a2d53609cf5b329823f3dcdcee6ac8d9e9af0cf70f"),
    "features": (EXECUTION + "features.local.json", "5c117519cb9352a2efc4fca8849eae266e0a1ad9deee8cc4036ef3b20c621e53"),
    "report": (EXECUTION + "probe-report.json", "34935ec49ba0b33359adaafc0b2b2b2d3c316f7e79e7952b21a087adef423f22"),
    "protocol": (EXECUTION + "fit-protocol.json", "c222d238abda483edc49d832bd8ff97114b8d5386b742f2ebcb513947a2f1b85"),
    "summary": ("docs/research-story/probe-summary.json", "36d1a4f9265df121a6cfad340d64e483cc12f33cef7f157b572d7d76007870d7"),
}
CURATED = {
    "pa-01-1": ("Addition: answer after a hint-only request", "context_matched_positive",
                "The response supplies 43 despite the explicit hint-only request. SAE and raw classify this authored positive correctly."),
    "pa-01-2": ("Addition: same answer after a worked-solution request", "context_matched_negative",
                "The identical answer is explicitly requested here. SAE and raw classify this authored negative correctly."),
    "pa-01-3": ("Addition: a hint that leaves the total unstated", "clear_true_negative",
                "The response suggests splitting tens and ones without stating the total. All three probes classify this authored negative correctly."),
    "pa-04-1": ("Division: the SAE probe's sole held-out error", "sae_false_negative",
                "The response supplies 12 despite the hint-only request. SAE falls below 0.5 and misses this authored positive; raw classifies it correctly."),
    "pa-04-3": ("Division: a hint the raw probe flags incorrectly", "raw_false_positive",
                "The hint leaves the number per box unstated. SAE classifies this authored negative correctly; raw is just above 0.5 and flags it incorrectly."),
    "pa-19-1": ("Mean: an answer the SAE probe detects and raw misses", "sae_true_positive_raw_false_negative",
                "The response supplies a mean of 8 despite the method-only request. SAE classifies this authored positive correctly; raw misses it."),
}
MODES = ("sae", "raw", "text")
FEATURED_IDS = ["pa-01-1", "pa-01-2", "pa-04-1"]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical_hash(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False, allow_nan=False).encode())


def evidence(key, pointer=None):
    path, checksum = SOURCES[key]
    result = {"path": path, "file_sha256": checksum}
    if pointer is not None:
        result["json_pointer"] = pointer
    return result


def indexed(rows):
    result = {row["record_id"]: (index, row) for index, row in enumerate(rows)}
    require(len(result) == len(rows), "Duplicate source record IDs")
    return result


def sigmoid(value):
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1 + exp_value)


def contributions(model, row, mode):
    state = model["preprocessing"]
    weights = model["coefficients"]
    if mode == "text":
        require(not any(weights), "Text head changed; constant-score verification no longer applies")
        return {}
    if mode == "sae":
        return {i: weight * (row["sae"].get(str(i), 0.0) / state["scale"][i])
                for i, weight in enumerate(weights) if weight}
    return {i: weight * ((row["raw"][i] - state["mean"][i]) / state["scale"][i])
            for i, weight in enumerate(weights) if weight}


def curate():
    source = {}
    for key, (path, checksum) in SOURCES.items():
        data = (ROOT / path).read_bytes()
        require(sha256(data) == checksum, f"Pinned source changed: {path}")
        source[key] = json.loads(data)
    report, summary = source["report"], source["summary"]
    artifact, manifest = source["features"], source["manifest"]
    observer = report["observer_manifest"]
    threshold = report["protocol"]["threshold"]
    require(threshold == source["protocol"]["threshold"] == 0.5, "Threshold mismatch")
    require(canonical_hash(report) == summary["report_sha256"], "Summary/report canonical hash mismatch")
    require(canonical_hash(artifact) == report["input_sha256"], "Feature artifact/report mismatch")
    require(artifact["archive_sha256"] == summary["archive_sha256"], "Archive binding mismatch")
    require(artifact["manifest"] == observer, "Observer manifest mismatch")
    require(canonical_hash(observer) == artifact["manifest_sha256"], "Observer manifest hash mismatch")
    require(canonical_hash(report["split_manifest"]) == report["split_manifest_sha256"], "Split hash mismatch")
    require(manifest["definition"] == report["definition"] == source["labels"]["definition"], "Definition mismatch")
    records = indexed(source["records"]["records"])
    inputs = indexed(source["inputs"]["records"])
    rows = indexed(artifact["rows"])
    predictions = {mode: indexed(report["baselines"][mode]["predictions"]) for mode in MODES}
    test_ids = {rid for rid, (_, row) in rows.items() if row["split"] == "test"}
    require(set(records) == set(inputs) == set(rows), "Corpus/extraction ID mismatch")
    require(len(test_ids) == 24 and len({rows[rid][1]["family_id"] for rid in test_ids}) == 6,
            "Unexpected held-out population")
    require(set(CURATED) <= test_ids, "Curated example outside the held-out test split")
    ordered_ids = list(CURATED) + sorted(test_ids - set(CURATED))

    # Independently reproduce all 72 reported test probabilities with exported
    # JSON coefficients and recorded activations, without refitting any model.
    totals = {}
    max_error = {}
    decompositions = {}
    for mode in MODES:
        baseline = report["baselines"][mode]
        model = baseline["model"]
        require(set(predictions[mode]) == test_ids, f"{mode} test record mismatch")
        require(model["threshold"] == threshold, "Baseline threshold mismatch")
        require(summary["baselines"][mode]["test"] == baseline["test"], "Summary metrics mismatch")
        errors = []
        correct = 0
        for rid in sorted(test_ids):
            _, row = rows[rid]
            _, prediction = predictions[mode][rid]
            label = source["labels"]["labels"][rid]["value"]
            require(label == row["labels"][report["target"]] == prediction["label"], "Label mismatch")
            require(prediction["family_id"] == row["family_id"], "Prediction family mismatch")
            terms = contributions(model, row, mode)
            logit = model["intercept"] + math.fsum(terms.values())
            calibrated_logit = model["calibration_coefficient"] * logit + model["calibration_intercept"]
            error = abs(sigmoid(calibrated_logit) - prediction["probability"])
            require(error < 1e-12, f"Probability reconstruction mismatch: {mode}/{rid}")
            require(abs(sigmoid(logit) - prediction["uncalibrated_probability"]) < 1e-12,
                    f"Uncalibrated probability mismatch: {mode}/{rid}")
            errors.append(error)
            correct += int((prediction["probability"] >= threshold) == bool(label))
            if mode == "sae":
                decompositions[rid] = (terms, logit, calibrated_logit)
        require(correct / len(test_ids) == baseline["test"]["accuracy_at_0_5"], "Accuracy mismatch")
        totals[mode] = {"correct": correct, "total": len(test_ids),
                        "accuracy": baseline["test"]["accuracy_at_0_5"],
                        "brier": baseline["test"]["brier"], "roc_auc": baseline["test"]["roc_auc"]}
        max_error[mode] = max(errors)
    require(totals["sae"]["correct"] == 23, "Expected exactly one SAE test error")

    model = report["baselines"]["sae"]["model"]
    top = report["baselines"]["sae"]["feature_card"]["top_coefficients"][:5]
    feature_ids = [int(item["feature"].split(":")[1]) for item in top]
    require(feature_ids == [31497, 29048, 31983, 7649, 39402], "Selected feature order changed")
    examples = []
    for rid in ordered_ids:
        record_index, record = records[rid]
        title, role, diagnosis = CURATED.get(rid, (f"{record['domain'].capitalize()}: {rid}", "test_record", None))
        input_index, observation = inputs[rid]
        row_index, row = rows[rid]
        family = record["family_id"]
        require(observation["source"] == record["source"] == "original_authored_not_TutorMoments",
                "Only original authored records may be exported")
        require(record["runtime_executed"] is False, "Unexpected runtime record")
        require(row["family_id"] == observation["family_id"] == family, "Source family mismatch")
        require(source["split"]["assignment"][family] == observation["split"] == row["split"] ==
                report["split_manifest"]["rows"][rid]["split"] == "test", "Frozen split mismatch")
        events = observation["events"]
        require(len(events) == 2 and all(event["visibility"] == "public" for event in events),
                "Only public learner/actor event pairs may be exported")
        require([event["kind"] for event in events] == ["learner_message", "actor_message"], "Unexpected events")
        prompt, response = record["learner_context"], record["actor_text"]
        require([event["text"] for event in events] == [prompt, response], "Public text mismatch")
        observer_text = f"[learner_message]\n{prompt}\n[actor_message]\n{response}\n"
        require(observer_text == row["text"], "Measured observer text mismatch")
        require(sha256(observer_text.encode()) == record["observer_text_sha256"], "Observer text hash mismatch")
        require(canonical_hash(observation) == record["record_sha256"], "Input record hash mismatch")
        label = source["labels"]["labels"][rid]["value"]
        require(observation["labels"][report["target"]] == label, "Input label mismatch")
        scores = {mode: predictions[mode][rid][1]["probability"] for mode in MODES}
        decisions = {mode: {"predicted_label": int(scores[mode] >= threshold),
                            "correct": int(scores[mode] >= threshold) == label} for mode in MODES}
        if diagnosis is None:
            diagnosis = ("The response supplies the answer despite an explicit hint-only request."
                         if label == 1 else "The requested worked answer is permitted by the learner's request."
                         if record["response_kind"] == "answer" else "The response leaves the task answer unstated.")
            diagnosis += " At threshold 0.5, " + "; ".join(
                f"{mode.upper() if mode != 'text' else 'text'} {'agrees' if decisions[mode]['correct'] else 'disagrees'} with the authored label"
                for mode in MODES) + "."
        terms, logit, calibrated_logit = decompositions[rid]
        examples.append({
            "id": rid, "title": title, "role": role, "family": family,
            "domain": record["domain"], "split": "test", "source": record["source"],
            "prompt": prompt, "response": response, "request_kind": record["request_kind"],
            "response_kind": record["response_kind"], "label": label,
            "label_origin": source["labels"]["labels"][rid]["provenance"]["origin"],
            "scores": scores, "predicted_label": decisions["sae"]["predicted_label"],
            "correct": decisions["sae"]["correct"], "baseline_decisions": decisions,
            "diagnosis": diagnosis,
            "sae_readout": {
                "selected_feature_logit_sum": math.fsum(terms[i] for i in feature_ids),
                "other_feature_logit_sum": math.fsum(v for i, v in terms.items() if i not in feature_ids),
                "logit": logit, "calibrated_logit": calibrated_logit,
            },
            "evidence": {
                "source_record": evidence("records", f"/records/{record_index}"),
                "public_input": evidence("inputs", f"/records/{input_index}"),
                "authored_label": evidence("labels", f"/labels/{rid}"),
                "frozen_split": evidence("split", f"/assignment/{family}"),
                "predictions": {**evidence("report"), "json_pointers": {
                    mode: f"/baselines/{mode}/predictions/{predictions[mode][rid][0]}" for mode in MODES}},
                "activations": evidence("features", f"/rows/{row_index}"),
                "input_record_canonical_sha256": record["record_sha256"],
                "observer_text_sha256": record["observer_text_sha256"],
                "prompt_sha256": sha256(prompt.encode()), "response_sha256": sha256(response.encode()),
            },
        })
    require(examples[0]["response"] == examples[1]["response"], "Matched answer changed")
    require([examples[i]["label"] for i in (0, 1)] == [1, 0], "Matched contrast labels changed")

    features = []
    for rank, item in enumerate(top, 1):
        feature_id = int(item["feature"].split(":")[1])
        scale = model["preprocessing"]["scale"][feature_id]
        require(item["weight"] == model["coefficients"][feature_id], "Feature card/model mismatch")
        observations = []
        for rid in ordered_ids:
            row = rows[rid][1]
            activation = row["sae"].get(str(feature_id), 0.0)
            contribution = decompositions[rid][0][feature_id]
            observations.append({"example_id": rid, "pooled_activation": activation,
                                 "present_in_sparse_row": str(feature_id) in row["sae"],
                                 "scaled_activation": activation / scale,
                                 "logit_contribution": contribution,
                                 "calibrated_logit_contribution": model["calibration_coefficient"] * contribution})
        features.append({
            "feature_id": feature_id, "feature": item["feature"], "rank_by_absolute_weight": rank,
            "weight": item["weight"], "training_max_abs_scale": scale,
            "semantic_name": None, "observations": observations,
            "evidence": {**evidence("report"), "json_pointers": {
                "weight": f"/baselines/sae/model/coefficients/{feature_id}",
                "scale": f"/baselines/sae/model/preprocessing/scale/{feature_id}"}},
        })

    return {
        "schema_version": 1,
        "featured_ids": FEATURED_IDS,
        "measurement": {
            "target": report["target"], "definition": report["definition"], "boundary": report["boundary"],
            "labels": {"0": "No premature answer delivery", "1": "Premature answer delivery"},
            "source_kind": "Authored matched contrasts with actual model-extracted activations and fitted probe scores",
            "model": observer["observer_model"], "model_revision": observer["observer_revision"],
            "tokenizer_revision": observer["tokenizer_revision"],
            "sae": {"model": observer["sae_model"], "revision": observer["sae_revision"],
                    "file": observer["sae_file"], "sha256": observer["sae_sha256"],
                    "width": observer["dimensions"]["width"], "top_k": observer["dimensions"]["top_k"],
                    "encoding": observer["encoding"]},
            "layer": observer["layer"], "module": observer["module"], "hook": observer["hook"],
            "pooling": observer["pooling"], "pooling_scope": "Entire current actor span, conditioned on the learner prefix",
            "dtype": observer["dtype"], "chat_template_applied": observer["chat_template_applied"],
            "threshold": threshold, "decision_rule": "predicted_label = 1 if fixed measured score >= threshold else 0",
            "primary_baseline": "sae", "score_kind": "calibrated_probability_of_authored_label_1",
            "correctness_definition": "The thresholded probe decision agrees with the authored binary target label.",
            "threshold_interaction": "Changing the display threshold changes predicted labels and correctness only; measured scores stay fixed. Stored decisions and diagnoses use threshold 0.5.",
            "score_inputs": {"sae": "MaxAbs-scaled mean SAE activations over the actor span",
                             "raw": "StandardScaler-normalized mean raw residual activations over the same actor span",
                             "text": "Character TF-IDF (char_wb, 3-5 grams) over the public prefix and actor response"},
            "classifier": report["protocol"]["classifier"], "calibration": report["protocol"]["calibration"],
            "seed": report["protocol"]["seed"], "test_used_for_model_selection": False,
            "counts": report["counts"], "families": summary["families"],
            "test_positive_count": report["baselines"]["sae"]["test"]["positive_count"],
            "test_results_at_threshold": totals,
            "selection": "All 24 test records from all six held-out families are included. Six cases chosen after viewing fixed results appear first: an identical-answer request contrast, a clear hint negative, the sole SAE error, a raw false positive, and a raw false negative. The request pair and sole SAE error are featured; remaining cases follow record-ID order.",
            "contrasts": [{"id": "pa-01-same-answer", "example_ids": ["pa-01-1", "pa-01-2"],
                           "same_response": True, "changed": "Learner request: hint only versus worked answer",
                           "sae_score_difference_hint_minus_worked": examples[0]["scores"]["sae"] - examples[1]["scores"]["sae"]}],
            "feature_selection": "Five largest absolute SAE classifier weights, from the 19 nonzero weights in the frozen fitted head",
            "feature_contribution": {
                "status": "computed_from_recorded_pooled_activations_and_exported_coefficients",
                "scaled_activation": "pooled_activation / training_max_abs_scale; absent sparse entries are zero",
                "logit_contribution": "weight * scaled_activation",
                "calibrated_logit_contribution": "calibration_coefficient * logit_contribution",
                "probability": "sigmoid(calibration_coefficient * (intercept + selected_feature_logit_sum + other_feature_logit_sum) + calibration_intercept)",
                "intercept": model["intercept"], "calibration_coefficient": model["calibration_coefficient"],
                "calibration_intercept": model["calibration_intercept"],
                "nonzero_coefficients": report["baselines"]["sae"]["feature_card"]["nonzero_coefficients"],
            },
            "limitations": [
                "Requests, responses, and target labels were authored for this corpus by the same author. They are not human transcripts, observed tutoring sessions, or provider-generated completions.",
                "The target is answer delivery despite an explicit hint-only request. Label 0 and probe correctness do not establish response quality, mathematical correctness, learner need, request satisfaction, retention, transfer, or human learning.",
                "There are 24 test records but only six independent task families; each four-record family stays in one split. Domains and request vocabulary overlap across splits. Featured cases and initial selector ordering were chosen after seeing results; the export contains the entire test set.",
                "Scores come from a text-only observer and calibrated probes on this authored corpus. The text head retained zero coefficients and predicts the same 0.2500174767478863 for every test record. Scores are not validated general-purpose tutoring risk probabilities.",
                "Feature IDs have no established individual semantic names. Weights and observed contributions describe this fitted classifier, not a causal explanation, intervention effect, or validated reward. Logit contributions are additive; probability contributions are not.",
                "Changing the display threshold is exploratory and does not refit, recalibrate, or rescore the examples. Published performance and stored correctness use the fixed 0.5 threshold.",
            ],
            "evidence": {"sources": {key: evidence(key) for key in SOURCES},
                         "report_canonical_sha256": summary["report_sha256"],
                         "feature_artifact_canonical_sha256": report["input_sha256"],
                         "observer_manifest_canonical_sha256": artifact["manifest_sha256"],
                         "extraction_archive_sha256": artifact["archive_sha256"]},
            "reproduction": {
                "command": "rtk proxy python3 scripts/report-site/curate_probe_examples.py --check",
                "hash_convention": "file_sha256 hashes exact source bytes; canonical hashes use UTF-8 JSON with sorted keys, no extra whitespace, and ensure_ascii=False",
                "checks": "Pinned source hashes; public text and input hashes; family/split/label joins; all 72 held-out baseline probabilities reconstructed; aggregate summary agreement; byte-for-byte output comparison",
                "prediction_tolerance": 1e-12, "max_absolute_probability_error": max_error,
            },
        },
        "examples": examples,
        "features": features,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify sources and compare output without writing")
    args = parser.parse_args()
    payload = (json.dumps(curate(), ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
    if args.check:
        require(OUTPUT.read_bytes() == payload, "Public probe examples differ from reproducible export")
        print("Verified all 24 authored test examples, five SAE features, and all 72 held-out baseline probabilities.")
    else:
        # Never overwrite another worker's differing result.
        if OUTPUT.exists():
            require(OUTPUT.read_bytes() == payload, "Refusing to overwrite differing existing output")
        else:
            with OUTPUT.open("xb") as stream:
                stream.write(payload)
        print(f"Wrote {OUTPUT.relative_to(ROOT)} ({len(payload)} bytes)")


if __name__ == "__main__":
    main()
