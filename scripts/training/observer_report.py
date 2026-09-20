# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["numpy==2.2.6", "pandas==2.3.3", "matplotlib==3.10.8"]
# ///
"""Validate a completed observer job and export descriptive PNG/SVG/HTML.

Reads only features.local.json, input.review.json, outputs.tar and state.json
in the explicitly selected job directory. No Torch, providers, or model loads.
Use --self-test for clearly authored protocol/plot checks, never real results.
"""
import argparse
import copy
import hashlib
import html
import io
import json
import math
from pathlib import Path
import re
import tarfile
import tempfile
import unittest

from observer_core import TEMPLATE, boundary_view, canonical, digest, token_spans
from observer_models import DEFAULT_PROFILE, PROFILES, get_profile, manifest_profile

LIMIT = 128 * 1024 * 1024
PHASES = ("pre_action", "delivered", "retrospective")
COLORS = {"pre_action": "#0072B2", "delivered": "#00836B", "retrospective": "#C97900"}
LOCAL_FIELDS = {"labels", "label_provenance", "source", "group_ids", "split", "local_source_record_sha256"}
POOLING = "mean_of_unique_selected_tokens"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read_file(path, limit=LIMIT):
    require(not path.is_symlink() and path.is_file(), f"Required regular file unavailable: {path.name}")
    require(path.stat().st_size <= limit, f"File too large: {path.name}")
    return path.read_bytes()


def read_json(body):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def constant(_value):
        raise ValueError("Nonfinite JSON number")
    result = json.loads(body, object_pairs_hook=pairs, parse_constant=constant)
    canonical(result)  # Also catches finite-looking exponent overflow (1e999).
    return result


def is_hash(value, size=64):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{" + str(size) + r"}", value) is not None


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_manifest(manifest, *, profile=None, expected_pins=None, _allow_authored=False):
    require(isinstance(manifest, dict) and manifest.get("schema_version") == 1, "Unknown manifest schema")
    authored = manifest.get("evidence") == "authored_smoke_fixture"
    require(manifest.get("evidence") == "model_extraction" or (_allow_authored and authored),
            "Actual model extraction required; authored fixtures are self-test only")
    dimensions = manifest.get("dimensions", {})
    require(isinstance(dimensions, dict), "Invalid feature dimensions")
    for name in ("hidden", "width", "top_k"):
        require(type(dimensions.get(name)) is int and dimensions[name] > 0, "Invalid feature dimensions")
    require(dimensions["top_k"] <= dimensions["width"], "Top-K exceeds dictionary width")
    selected = get_profile(DEFAULT_PROFILE)
    if authored:
        require(profile is None and expected_pins is None and "observer_profile" not in manifest,
                "Authored fixtures cannot select a real observer profile")
    else:
        selected = manifest_profile(manifest, profile=profile, expected_pins=expected_pins)
    for field in ("observer_revision", "tokenizer_revision", "sae_revision"):
        require(is_hash(manifest.get(field), 40), f"Unpinned {field}")
    layer = manifest.get("layer")
    require(type(layer) is int and 0 <= layer < selected.layers, "Invalid observer layer")
    require(manifest.get("module") == f"language_model.layers.{layer}" and
            manifest.get("sae_file") == f"layer{layer}.sae.pt", "Module/SAE layer mismatch")
    require(manifest.get("dtype") in {"float32", "bfloat16"} and manifest.get("sae_dtype") == manifest["dtype"],
            "Unmapped residual/SAE precision")
    require(manifest.get("device") in {"cpu", "cuda"}, "Unknown extraction device")
    require(manifest.get("hook") == "residual_post_block" and manifest.get("pooling") == POOLING,
            "Unknown capture or pooling convention")
    require(manifest.get("encoding") == "affine_then_signed_topk_no_relu_no_centering", "Unknown SAE encoding")
    require(manifest.get("truncation") is False and manifest.get("chat_template_applied") is False,
            "Unsupported text serialization/truncation")
    require(manifest.get("template") == TEMPLATE and manifest.get("template_sha256") == sha(TEMPLATE.encode()),
            "Observer template hash mismatch")
    require(type(manifest.get("max_tokens")) is int and 0 < manifest["max_tokens"] <= 65536, "Invalid token limit")
    for field in ("sae_sha256", "config_sha256", "tokenizer_chat_template_sha256"):
        require(is_hash(manifest.get(field)), f"Missing {field}")
    for field in ("model_files_sha256", "tokenizer_files_sha256", "implementation_files_sha256"):
        hashes = manifest.get(field)
        require(isinstance(hashes, dict) and bool(hashes) and all(is_hash(v) for v in hashes.values()),
                f"Missing file pins: {field}")
    implementation = {"observer_core.py", "observer_extract.py"}
    if "observer_profile" in manifest or selected.name != DEFAULT_PROFILE:
        implementation.add("observer_models.py")
    require(set(manifest["implementation_files_sha256"]) == implementation,
            "Unexpected extraction implementation manifest")
    require(all(isinstance(manifest.get("software", {}).get(name), str) and manifest["software"][name]
                for name in ("torch", "transformers", "numpy", "tokenizers")), "Missing runtime versions")
    return authored


def validate_rows(document, projection):
    manifest, rows = document["manifest"], document["rows"]
    records = projection["records"]
    require(isinstance(records, list) and bool(records) and isinstance(rows, list), "No extraction records")
    ids = [r["record_id"] for r in records]
    require(len(set(ids)) == len(ids), "Duplicate input records")
    require([r["record_id"] for r in rows] == ids, "Missing, extra, duplicate or reordered output rows")
    hidden, width, top_k = (manifest["dimensions"][k] for k in ("hidden", "width", "top_k"))
    for row, record in zip(rows, records):
        require(row["record_sha256"] == digest(record), "Input row hash mismatch")
        require(row["observer_manifest_sha256"] == document["manifest_sha256"], "Row manifest hash mismatch")
        require(row["view"] == boundary_view(record), "Invalid or changed temporal projection")
        require(row["text"] == row["view"]["text"] and row["boundary"] == record["boundary"]
                and row["family_id"] == record["family_id"], "Changed row provenance/text")
        require(row.get("pooling") == POOLING and row.get("sae_width") == width, "Changed pooling or dictionary width")
        raw = row.get("raw")
        require(isinstance(raw, list) and len(raw) == hidden and all(number(v) for v in raw), "Invalid finite residual dimensions")
        ids, selected, sparse = row["input_token_ids"], row["selected_token_indices"], row["sparse_tokens"]
        require(isinstance(ids, list) and 0 < len(ids) <= manifest["max_tokens"] and
                all(type(i) is int and i >= 0 for i in ids), "Invalid token IDs/length")
        require(isinstance(selected, list) and bool(selected) and
                all(type(i) is int and 0 <= i < len(ids) for i in selected) and
                selected == sorted(set(selected)), "Invalid selected token indices")
        require(isinstance(sparse, list) and [s["token_index"] for s in sparse] == selected, "Sparse token alignment mismatch")
        offsets, pooled = [(0, 0)] * len(ids), {}
        for token in sparse:
            coordinates, values, span = token["indices"], token["values"], token["character_offsets"]
            require(isinstance(coordinates, list) and len(coordinates) == top_k and
                    all(type(i) is int and 0 <= i < width for i in coordinates) and len(set(coordinates)) == top_k,
                    "Invalid sparse coordinate dimensions")
            require(isinstance(values, list) and len(values) == top_k and all(number(v) for v in values), "Invalid finite sparse values")
            require(isinstance(span, list) and len(span) == 2 and all(type(i) is int for i in span) and
                    0 <= span[0] < span[1] <= len(row["text"]), "Invalid sparse character offsets")
            offsets[token["token_index"]] = span
            for coordinate, value in zip(coordinates, values):
                pooled[str(coordinate)] = pooled.get(str(coordinate), 0.0) + value / len(selected)
        require(token_spans(row["text"], offsets, row["view"]["spans"], [1] * len(ids)) == selected,
                "Unmapped selected token spans")
        require(isinstance(row["sae"], dict) and set(row["sae"]) == set(pooled), "Pooled sparse coordinates mismatch")
        require(all(number(row["sae"][k]) and math.isclose(row["sae"][k], v, rel_tol=1e-10, abs_tol=1e-12)
                    for k, v in pooled.items()), "Pooled sparse values mismatch")


def receipt_features(body):
    files = {}
    with tarfile.open(fileobj=io.BytesIO(body), mode="r:") as archive:
        total = 0
        for member in archive:
            total += member.size
            require(member.name in {"receipt.json", "extract.log", "features.json"} and member.name not in files
                    and member.isfile() and 0 <= total <= LIMIT, "Unsafe or unexpected receipt archive member")
            files[member.name] = archive.extractfile(member).read()
    require(set(files) == {"receipt.json", "extract.log", "features.json"}, "Incomplete extraction receipt")
    receipt = read_json(files["receipt.json"])
    require(type(receipt.get("exit_code")) is int and receipt["exit_code"] == 0, "Extraction did not complete successfully")
    require(receipt.get("files") == {k: sha(v) for k, v in files.items() if k != "receipt.json"}, "Receipt file hash mismatch")
    return read_json(files["features.json"])


def load_capture(job_dir, *, profile=None, _allow_authored=False):
    """All four files are required. Missing data never becomes empty/fake output."""
    job_dir = Path(job_dir).expanduser()
    local_body = read_file(job_dir / "features.local.json")
    input_body = read_file(job_dir / "input.review.json", 2 * 1024 * 1024)
    archive = read_file(job_dir / "outputs.tar")
    state = read_json(read_file(job_dir / "state.json", 2 * 1024 * 1024))
    require(state.get("extraction_valid") is True and state.get("outputs_sha256") == sha(archive),
            "Manager state does not validate the preserved extraction archive")
    document, remote, projection = read_json(local_body), receipt_features(archive), read_json(input_body)
    require(set(document) == set(remote) == {"manifest", "manifest_sha256", "input_sha256", "rows"}, "Unknown artifact schema")
    require(all(document[k] == remote[k] for k in ("manifest", "manifest_sha256", "input_sha256")),
            "Local manifest differs from receipt-backed extraction")
    require(document["manifest_sha256"] == digest(document["manifest"]), "Manifest hash mismatch")
    require(document["input_sha256"] == sha(input_body), "Projection file hash mismatch")
    authored = validate_manifest(document["manifest"], profile=profile, _allow_authored=_allow_authored)
    require(len(document["rows"]) == len(remote["rows"]), "Local and remote row counts differ")
    for local_row, remote_row in zip(document["rows"], remote["rows"]):
        require({k: v for k, v in local_row.items() if k not in LOCAL_FIELDS} ==
                {k: v for k, v in remote_row.items() if k not in LOCAL_FIELDS},
                "Local measurement differs from receipt-backed extraction")
    validate_rows(document, projection)
    return {"document": document, "authored": authored, "artifact_sha256": sha(local_body),
            "outputs_sha256": sha(archive), "input_sha256": sha(input_body), "manager_plan_sha256": state.get("plan_sha256")}


def measurements(capture, top_k=16):
    import numpy as np
    import pandas as pd
    require(type(top_k) is int and 1 <= top_k <= 64, "Display 1–64 shared coordinates")
    rows = capture["document"]["rows"]
    entries, strength = [], {}
    for index, row in enumerate(rows):
        raw = np.asarray(row["raw"], dtype=np.float64)
        scale = float(np.max(np.abs(raw)))
        norm = 0.0 if scale == 0 else float(scale * np.linalg.norm(raw / scale))
        require(math.isfinite(norm), "Residual norm overflows the plotting range")
        entries.append({"record": index + 1, "record_id": row["record_id"], "boundary": row["boundary"],
                        "input_tokens": len(row["input_token_ids"]), "selected_tokens": len(row["selected_token_indices"]),
                        "pooled_residual_l2": norm})
        for key, value in row["sae"].items():
            coordinate = int(key)
            strength[coordinate] = strength.get(coordinate, 0.0) + abs(value) / len(rows)
    coordinates = sorted(strength, key=lambda c: (-strength[c], c))[:top_k]
    matrix = np.asarray([[row["sae"].get(str(c), 0.0) for c in coordinates] for row in rows], dtype=float)
    require(coordinates and np.isfinite(matrix).all() and all(math.isfinite(v) for v in strength.values()),
            "Invalid shared feature matrix")
    table = pd.DataFrame(entries)
    table["boundary"] = pd.Categorical(table["boundary"], categories=PHASES, ordered=True)
    table = table.sort_values(["boundary", "record"], kind="stable")
    matrix = matrix[table["record"].to_numpy() - 1]
    summary = table.groupby("boundary", observed=True).agg(
        records=("record", "count"), input_tokens=("input_tokens", "sum"),
        selected_tokens=("selected_tokens", "sum"), mean_pooled_residual_l2=("pooled_residual_l2", "mean")).reset_index()
    return table, summary, coordinates, matrix


def figures(capture, top_k=16):
    import numpy as np
    import matplotlib.pyplot as plt
    table, summary, coordinates, matrix = measurements(capture, top_k)
    title_prefix = "AUTHORED FIXTURE · " if capture["authored"] else ""
    height = max(3.5, 0.35 * len(table) + 1.8)
    labels = [f"{r.boundary} · record {r.record}" for r in table.itertuples()]
    y = np.arange(len(table))
    palette = [COLORS[str(boundary)] for boundary in table["boundary"]]
    style = {"font.family": "DejaVu Sans", "text.color": "#254e63", "axes.labelcolor": "#536570",
             "axes.spines.top": False, "axes.spines.right": False,
             "svg.hashsalt": "keating-observer-capture-v1", "figure.facecolor": "white"}
    with plt.rc_context(style):
        counts, ax = plt.subplots(figsize=(11, height), layout="constrained")
        ax.barh(y - .18, table["input_tokens"], height=.34, color="#89969C", label="Full serialized input")
        ax.barh(y + .18, table["selected_tokens"], height=.34, color=palette, label="Tokens selected for pooling")
        ax.set_yticks(y, labels); ax.invert_yaxis(); ax.set_xlabel("Token count")
        ax.set_title(title_prefix + "Input and selected tokens at each boundary", loc="left")
        ax.legend(loc="best")
        norms, ax = plt.subplots(figsize=(11, height), layout="constrained")
        ax.barh(y, table["pooled_residual_l2"], color=palette)
        ax.set_yticks(y, labels); ax.invert_yaxis(); ax.set_xlabel("L2 norm of the stored mean residual vector")
        ax.set_title(title_prefix + "Pooled raw residual magnitude", loc="left")
        heatmap, ax = plt.subplots(figsize=(max(11, len(coordinates) * .42), height), layout="constrained")
        limit = float(np.max(np.abs(matrix))) or 1.0
        plot = ax.imshow(matrix, aspect="auto", interpolation="nearest", cmap="RdBu_r", vmin=-limit, vmax=limit)
        ax.set_yticks(y, labels); ax.set_xticks(np.arange(len(coordinates)), [str(c) for c in coordinates], rotation=60)
        ax.set_xlabel("Shared unnamed SAE coordinate IDs; selected by mean absolute pooled value")
        ax.set_title(title_prefix + "Signed pooled values on the same coordinate axis", loc="left")
        heatmap.colorbar(plot, ax=ax, label="Mean SAE activation over selected tokens")
    return {"token-counts": counts, "residual-norms": norms, "shared-coordinates": heatmap}, table, summary, coordinates


def export_capture(job_dir, output, top_k=16, *, profile=None, _allow_authored=False):
    """Validate first; render privately; publish only a complete new directory."""
    capture = load_capture(job_dir, profile=profile, _allow_authored=_allow_authored)
    output = Path(output).expanduser()
    require(not output.exists(), "Output already exists; select a new report directory")
    require(output.parent.is_dir(), "Output parent directory must already exist")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    charts, table, summary, coordinates = figures(capture, top_k)
    manifest = capture["document"]["manifest"]
    evidence = "AUTHORED SMOKE FIXTURE — NOT QWEN MEASUREMENTS" if capture["authored"] else "Recorded observer extraction"
    description = ("These unnamed coordinates and residual magnitudes describe the supplied model extraction. "
                   "They do not identify psychological concepts or label human learning. "
                   "The raw norm is the norm of the mean selected residual, not a mean of per-token norms. "
                   "Coordinates share one axis across all rows; absent sparse coordinates contribute zero.")
    report = {"schema_version": 1, "evidence": manifest["evidence"], "artifact_sha256": capture["artifact_sha256"],
              "outputs_sha256": capture["outputs_sha256"], "input_sha256": capture["input_sha256"],
              "observer_manifest_sha256": capture["document"]["manifest_sha256"],
              "manager_plan_sha256": capture["manager_plan_sha256"], "shared_coordinate_ids": coordinates,
              "selection": "largest mean absolute pooled SAE value across all records; deterministic coordinate-ID tie break",
              "rows": table.to_dict(orient="records"), "by_boundary": summary.to_dict(orient="records"),
              "limitations": [description, "Independent weight execution attestation and learning outcomes are outside this report.",
                              "Hashes are checked against the supplied manager state; this is not a signed external attestation."]}
    try:
        with tempfile.TemporaryDirectory(prefix=".observer-report-", dir=output.parent) as staging:
            staging = Path(staging)
            sections = []
            for name, figure in charts.items():
                figure.savefig(staging / f"{name}.png", dpi=160)
                figure.savefig(staging / f"{name}.svg", metadata={"Date": None, "Description": evidence})
                svg = (staging / f"{name}.svg").read_text()
                sections.append('<section aria-label="' + html.escape(name) + '">' + svg[svg.index("<svg"):] + '</section>')
            details = {k: manifest[k] for k in ("observer_model", "observer_revision", "tokenizer_revision", "sae_model",
                                                "sae_revision", "sae_sha256", "module", "layer", "dtype", "dimensions")}
            page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Observer capture</title><style>body{max-width:1200px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;color:#254e63;background:#fcfcf9}h1{line-height:1.15}section{margin:32px 0;overflow:auto}svg{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef3f5;padding:16px}table{border-collapse:collapse;font-size:14px}td,th{padding:8px;border-bottom:1px solid #dce4e8;text-align:left}.table{overflow:auto}</style>
<h1>Observer capture</h1><p><strong>''' + html.escape(evidence) + '</strong></p><p>' + html.escape(description) + '</p>'
            page += '<p>Input and receipt hashes verified. Labels and transcript prose are not included in this report.</p>'
            page += '<h2>Boundary totals</h2><div class="table">' + summary.to_html(index=False, escape=True) + '</div>'
            page += ''.join(sections)
            page += '<h2>Record measurements</h2><div class="table">' + table.to_html(index=False, escape=True) + '</div>'
            page += '<h2>Recorded measurement manifest</h2><pre>' + html.escape(json.dumps(details, indent=2)) + '</pre>'
            page += '<p>Artifact SHA256: <code>' + capture["artifact_sha256"] + '</code></p>'
            page += '<p>Human learning, coordinate meanings and intervention effects: <strong>not established</strong>.</p></html>'
            (staging / "index.html").write_text(page)
            (staging / "measurements.json").write_text(canonical(report) + "\n")
            require(not output.exists(), "Output appeared during rendering; refusing overwrite")
            staging.rename(output)
    finally:
        for figure in charts.values():
            plt.close(figure)
    return report


def _authored_job(directory):
    """Private test fixture: wholly authored tensors, never Qwen evidence."""
    directory.mkdir()
    manifest = {"schema_version": 1, "evidence": "authored_smoke_fixture", "observer_model": "authored/toy-observer",
                "tokenizer_model": "authored/toy-observer", "sae_model": "authored/toy-dictionary",
                "observer_revision": "a" * 40, "tokenizer_revision": "a" * 40, "sae_revision": "b" * 40,
                "layer": 12, "module": "language_model.layers.12", "sae_file": "layer12.sae.pt", "sae_sha256": "c" * 64,
                "dtype": "float32", "sae_dtype": "float32", "device": "cpu", "hook": "residual_post_block",
                "dimensions": {"hidden": 4, "width": 8, "top_k": 2}, "pooling": POOLING,
                "encoding": "affine_then_signed_topk_no_relu_no_centering", "truncation": False,
                "max_tokens": 1024, "template": TEMPLATE, "template_sha256": sha(TEMPLATE.encode()),
                "chat_template_applied": False, "tokenizer_chat_template_sha256": "d" * 64, "config_sha256": "e" * 64,
                "model_files_sha256": {"authored-fixture": "f" * 64}, "tokenizer_files_sha256": {"authored-fixture": "f" * 64},
                "implementation_files_sha256": {"observer_core.py": "f" * 64, "observer_extract.py": "f" * 64},
                "software": {name: "authored-fixture" for name in ("torch", "transformers", "numpy", "tokenizers")}}
    records, rows = [], []
    for index, boundary in enumerate(PHASES):
        record = {"record_id": f"authored-{index}", "family_id": "authored-family", "boundary": boundary,
                  "latest_allowed_event_id": "event", "events": [{"event_id": "event", "phase": boundary,
                    "kind": "actor_message" if boundary == "delivered" else "learner_message",
                    "visibility": "public", "text": "Try units."}],
                  "spans": [{"event_id": "event", "start": 0, "end": 10}]}
        view = boundary_view(record)
        start = view["spans"][0]["start"]
        values = [float(index + 1), -0.5]
        sparse = [{"token_index": 2, "character_offsets": [start, start + 3], "indices": [index, 7], "values": values},
                  {"token_index": 3, "character_offsets": [start + 4, start + 10], "indices": [index, 7], "values": values}]
        rows.append({"record_id": record["record_id"], "family_id": record["family_id"], "boundary": boundary,
                     "text": view["text"], "view": view, "record_sha256": digest(record), "observer_manifest_sha256": digest(manifest),
                     "pooling": POOLING, "input_token_ids": list(range(5 + index)), "selected_token_indices": [2, 3],
                     "sparse_tokens": sparse, "raw": [3., 4., 0., 0.], "sae": {str(index): values[0], "7": -.5},
                     "sae_width": 8, "source": "authored", "labels": {}, "label_provenance": {}, "group_ids": []})
        records.append(record)
    input_body = (canonical({"records": records}) + "\n").encode()
    document = {"manifest": manifest, "manifest_sha256": digest(manifest), "input_sha256": sha(input_body), "rows": rows}
    (directory / "input.review.json").write_bytes(input_body)
    _save_authored_output(directory, document)
    return document


def _save_authored_output(directory, document):
    files = {"features.json": canonical(document).encode(), "extract.log": b"AUTHORED FIXTURE; no Torch or Qwen was run"}
    files["receipt.json"] = canonical({"exit_code": 0, "files": {k: sha(v) for k, v in files.items()}}).encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, body in files.items():
            info = tarfile.TarInfo(name); info.size = len(body); archive.addfile(info, io.BytesIO(body))
    (directory / "outputs.tar").write_bytes(buffer.getvalue())
    (directory / "features.local.json").write_text(canonical(document))
    (directory / "state.json").write_text(canonical({"extraction_valid": True, "outputs_sha256": sha(buffer.getvalue())}))


def self_test():
    class ReportTests(unittest.TestCase):
        def setUp(self):
            self.temp = tempfile.TemporaryDirectory(prefix="observer-report-authored-")
            self.addCleanup(self.temp.cleanup)
            self.root = Path(self.temp.name); self.job = self.root / "authored-job"
            self.doc = _authored_job(self.job)

        def test_authored_fixture_rejected_by_normal_loader(self):
            with self.assertRaisesRegex(ValueError, "Actual model"):
                load_capture(self.job)

        def test_signed_shared_axes_and_pooled_norm(self):
            capture = load_capture(self.job, _allow_authored=True)
            table, summary, coordinates, matrix = measurements(capture, 4)
            self.assertEqual(table["pooled_residual_l2"].tolist(), [5., 5., 5.])
            self.assertEqual(coordinates, [2, 1, 7, 0])
            self.assertEqual(matrix[:, 2].tolist(), [-.5, -.5, -.5])
            self.assertEqual(summary["selected_tokens"].tolist(), [2, 2, 2])

        def test_changed_finite_measurement_rejected_against_receipt(self):
            self.doc["rows"][0]["raw"][0] = 100.
            (self.job / "features.local.json").write_text(canonical(self.doc))
            with self.assertRaisesRegex(ValueError, "Local measurement"):
                load_capture(self.job, _allow_authored=True)

        def test_row_hash_and_dimensions_rejected_even_with_updated_receipt(self):
            for kind in ("row_hash", "dimension", "pooled", "view"):
                changed = copy.deepcopy(self.doc)
                row = changed["rows"][0]
                if kind == "row_hash": row["record_sha256"] = "0" * 64
                if kind == "dimension": row["raw"].append(0.)
                if kind == "pooled": row["sae"]["0"] = 999.
                if kind == "view": row["view"]["latest_allowed_event_id"] = "future"
                _save_authored_output(self.job, changed)
                with self.subTest(kind=kind), self.assertRaises(ValueError):
                    load_capture(self.job, _allow_authored=True)

        def test_missing_input_writes_no_placeholder(self):
            (self.job / "input.review.json").unlink()
            output = self.root / "must-not-exist"
            with self.assertRaises(ValueError): export_capture(self.job, output, _allow_authored=True)
            self.assertFalse(output.exists())

        def test_json_nonfinite_and_duplicate_keys(self):
            for body in ('{"x":NaN}', '{"x":1e999}', '{"x":1,"x":2}'):
                with self.subTest(body=body), self.assertRaises(ValueError): read_json(body)

        def test_static_exports_label_authored_and_refuse_overwrite(self):
            output = self.root / "authored-report"
            export_capture(self.job, output, 4, _allow_authored=True)
            self.assertEqual(len(list(output.glob("*.png"))), 3)
            self.assertEqual(len(list(output.glob("*.svg"))), 3)
            self.assertIn("AUTHORED SMOKE FIXTURE", (output / "index.html").read_text())
            with self.assertRaisesRegex(ValueError, "already exists"):
                export_capture(self.job, output, _allow_authored=True)

    return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReportTests)).wasSuccessful()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_dir", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("--profile", choices=tuple(PROFILES),
                        help="Require this observer/dictionary pair; otherwise use manifest profile or legacy 9B")
    parser.add_argument("--top-k", type=int, default=16, help="1–64 shared display coordinates, selected across all rows")
    parser.add_argument("--self-test", action="store_true", help="Authored local checks only; writes only temporary fixtures")
    args = parser.parse_args(argv)
    if args.self_test:
        raise SystemExit(0 if self_test() else 1)
    if args.job_dir is None or args.output is None:
        parser.error("Supply an existing completed job directory and a new output directory")
    report = export_capture(args.job_dir, args.output, args.top_k, profile=args.profile)
    print(canonical({"output": str(args.output), "records": len(report["rows"]), "evidence": report["evidence"],
                     "artifact_sha256": report["artifact_sha256"]}))


if __name__ == "__main__":
    main()
