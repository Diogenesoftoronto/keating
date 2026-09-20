# /// script
# requires-python = ">=3.12"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy>=2,<3", "matplotlib==3.10.*"]
# ///
"""Inspect local TutorMoments supervision coverage without importing private text."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import hashlib
    import json
    import os
    from pathlib import Path
    import marimo as mo
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False,
        "axes.spines.right": False, "axes.spines.left": False,
        "axes.titleweight": "bold", "text.color": "#254e63",
        "axes.labelcolor": "#254e63", "svg.hashsalt": "keating-source-supervision-v1"})
    default_directory = os.environ.get("KEATING_SOURCE_SUPERVISION", str(
        Path(__file__).resolve().parents[1] / ".keating/outputs/tutormoments-sar-admitted-v1"))
    return Path, default_directory, hashlib, json, mo, np, pd, plt


@app.cell
def _(default_directory, mo):
    directory = mo.ui.text(value=default_directory, label="Local supervision bundle", full_width=True)
    mo.vstack([mo.md("""# Which source labels can we actually use?

    A published label still needs an appropriate observation boundary and an
    admitted source family. Compare the source inventory with usable targets,
    then inspect whether independent groups reach calibration and test.

    This notebook reads only local aggregate manifests. It never retrieves data,
    displays private teacher/student text, changes splits, or dispatches inference.
    Build the bundle with the commands in `docs/tutormoments-supervision.md`.
    """), directory])
    return (directory,)


@app.cell
def _(Path, directory, hashlib, json, mo):
    _path = Path(directory.value).expanduser()
    mo.stop(not (_path / "manifest.json").is_file(), mo.md("No local supervision bundle at this path yet."))
    _error = None
    manifest, partitions = None, None
    try:
        manifest = json.loads((_path / "manifest.json").read_text())
        partitions = json.loads((_path / "family-splits.json").read_text())
        _canonical = json.dumps(partitions, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"), allow_nan=False).encode()
        if hashlib.sha256(_canonical).hexdigest() != manifest["split_sha256"]:
            raise ValueError("Family split digest does not match the bundle manifest")
        if manifest["scope"] != "source_supervision_only_not_native_episode_labels":
            raise ValueError("Expected a source-supervision aggregate manifest")
    except (ValueError, KeyError, OSError) as _exc:
        _error = str(_exc)
    mo.stop(_error is not None, mo.md(f"Cannot inspect this bundle: `{_error}`"))
    return manifest, partitions


@app.cell
def _(manifest, mo, pd):
    _admission = manifest.get("source_admission", {})
    mo.vstack([mo.md(f"""**{manifest['dataset']}** · revision `{manifest['revision']}`

    {manifest['input_rows']['transcripts.jsonl']:,} source transcripts;
    {manifest['input_rows']['annotations.jsonl']:,} annotation records;
    {manifest['source_sar_examples']:,} extracted SAR moments;
    {manifest['frozen_reference_examples']:,} preserved reference moments.
    These are different counting units, and the two moment collections can overlap.

    Admission: **{_admission.get('status', 'not admitted')}**.
    Splits: **{manifest['split_status']}**.
    Source labels describe source interactions; they do not label newly generated
    native behavior or establish human learning gains.
    """), mo.ui.table(pd.DataFrame([
        {"join": _name, "SAR moments": _count}
        for _name, _count in manifest["sar_join_reasons"].items()
    ]), selection=None)])
    return


@app.cell
def _(manifest, mo, pd):
    label_counts = pd.DataFrame([
        {"target": _name, **_counts} for _name, _counts in manifest["labels"].items()
    ])
    target_choice = mo.ui.dropdown(options=label_counts["target"].tolist(),
        value=label_counts["target"].iloc[0], label="Inspect one target")
    mo.vstack([mo.ui.table(label_counts, selection=None), target_choice])
    return label_counts, target_choice


@app.cell
def _(label_counts, mo, np, plt):
    _positions = np.arange(len(label_counts))
    _figure, _axes = plt.subplots(1, 2, figsize=(11, 5.3), sharey=True)
    for _axis, _column, _title, _color in zip(_axes,
            ["known", "fit_eligible"], ["Known source labels", "Admitted temporal targets"],
            ["#0072B2", "#00836B"]):
        _axis.barh(_positions, label_counts[_column], color=_color)
        _axis.set_title(_title)
        _axis.set_xlabel("Label-bearing rows")
        _axis.set_yticks(_positions, label_counts["target"])
        _axis.grid(axis="x", color="#dce4e8", alpha=.6)
        _axis.set_axisbelow(True)
        for _position, _count in zip(_positions, label_counts[_column]):
            _axis.annotate(f"{_count:,}", (_count, _position), xytext=(4, 0),
                textcoords="offset points", va="center", fontsize=8)
        _axis.margins(x=.2)
    _axes[0].invert_yaxis()
    _figure.tight_layout()
    plt.close(_figure)
    mo.vstack([_figure, mo.md("The panels use different horizontal scales. Counts are label rows, not independent students. Conflicting labels and missing observation boundaries are retained in the audit.")])
    return


@app.cell
def _(mo, partitions, pd, plt, target_choice):
    _target = target_choice.value
    _coverage = partitions["target_coverage"][_target]
    _rows = [{"partition": _split, "reserved groups": len(partitions[_split]),
        **_coverage[_split]} for _split in ("train", "calibration", "test")]
    _figure, _axis = plt.subplots(figsize=(7, 3.4))
    _axis.bar([_row["partition"] for _row in _rows],
        [_row["student_groups"] for _row in _rows], color=["#0072B2", "#C97900", "#00836B"])
    _axis.set_ylabel("Groups with usable target labels")
    _axis.set_title(_target)
    _axis.set_ylim(0, max(1, max(_row["student_groups"] for _row in _rows)) + .6)
    for _index, _row in enumerate(_rows):
        _axis.text(_index, _row["student_groups"] + .08, str(_row["student_groups"]), ha="center")
    _figure.tight_layout()
    plt.close(_figure)
    _missing = [_row["partition"] for _row in _rows if _row["student_groups"] == 0]
    mo.vstack([_figure, mo.ui.table(pd.DataFrame(_rows), selection=None),
        mo.md("**No usable labels in: " + ", ".join(_missing) + ".** Those partitions cannot support a probe comparison for this target."
            if _missing else "Every partition has usable labels. Inspect group counts, class coverage and independence before fitting."),
        mo.md("The control changes the displayed target only. It never moves families between partitions. A reserved group without usable labels is still reserved; the split is not a release holdout.")])
    return


if __name__ == "__main__":
    app.run()
