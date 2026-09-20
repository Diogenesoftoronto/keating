# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "numpy==2.2.6", "pandas==2.3.3", "matplotlib==3.10.8"]
# ///
"""Read-only actual observer capture viewer; blank input means unavailable."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import sys
    from pathlib import Path
    import marimo as mo
    import matplotlib.pyplot as plt
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/training"))
    from observer_report import figures, load_capture
    return Path, figures, load_capture, mo, plt


@app.cell
def _(mo):
    mo.md("""
    # Inspect a recorded observer capture

    This viewer reads a completed job's numeric extraction. It checks the input
    projection, manifest, row hashes and receipt-backed output before plotting.
    It does not load a model, call a provider, fit a probe, or write files.

    **Unnamed SAE coordinates have no assigned concept meaning here.** These
    numbers describe a model's representation of supplied text; they do not
    measure a learner's mind or establish learning.

    Leave the path blank to keep actual measurements **unavailable**. There is
    no default activation fixture. A failed job's log is not an extraction.
    """)
    return


@app.cell
def _(mo):
    job_directory = mo.ui.text(value="", label="Completed observer job directory", full_width=True)
    coordinate_count = mo.ui.slider(start=1, stop=32, value=16, step=1,
                                     label="Shared coordinate count", show_value=True)
    mo.vstack([job_directory, coordinate_count])
    return coordinate_count, job_directory


@app.cell
def _(Path, job_directory, load_capture):
    capture = None
    unavailable = "No completed job selected. Actual activation measurements are unavailable."
    if job_directory.value.strip():
        try:
            capture = load_capture(Path(job_directory.value.strip()))
            unavailable = None
        except (OSError, ValueError, KeyError, TypeError) as _error:
            unavailable = f"Capture unavailable: {_error}"
    return capture, unavailable


@app.cell
def _(capture, mo, unavailable):
    if unavailable:
        mo.output.replace(mo.md(unavailable))
    else:
        _manifest = capture["document"]["manifest"]
        mo.output.replace(mo.vstack([
            mo.md("**Recorded extraction validated against the supplied manager state and receipt.**"),
            mo.ui.table([
                {"field": "model", "value": _manifest["observer_model"]},
                {"field": "model revision", "value": _manifest["observer_revision"]},
                {"field": "SAE revision", "value": _manifest["sae_revision"]},
                {"field": "module", "value": _manifest["module"]},
                {"field": "precision", "value": _manifest["dtype"]},
                {"field": "artifact SHA256", "value": capture["artifact_sha256"]},
            ], selection=None),
        ]))
    return


@app.cell
def _(capture, coordinate_count, figures, mo, plt):
    mo.stop(capture is None)
    capture_charts, capture_rows, boundary_totals, shared_coordinates = figures(capture, int(coordinate_count.value))
    # Figure objects still render after their pyplot windows are unregistered;
    # repeated slider updates do not accumulate open figure managers.
    for _figure in capture_charts.values():
        plt.close(_figure)
    return boundary_totals, capture_charts, capture_rows, shared_coordinates


@app.cell
def _(boundary_totals, capture_rows, mo):
    mo.vstack([mo.md("## Counts by observation boundary"), mo.ui.table(boundary_totals, selection=None),
               mo.ui.table(capture_rows, selection=None)])
    return


@app.cell
def _(capture_charts):
    capture_charts["token-counts"]
    return


@app.cell
def _(capture_charts, mo):
    mo.vstack([mo.md("""
    ## Magnitude of the pooled raw residual

    The stored vector is the **mean over selected tokens**. This plots the L2
    norm of that mean. Per-token raw norms are unavailable in this artifact.
    Different prefixes and selected spans can produce different magnitudes;
    a larger norm is not a quality or learning score.
    """), capture_charts["residual-norms"]])
    return


@app.cell
def _(capture_charts, mo, shared_coordinates):
    mo.vstack([mo.md(f"""
    ## The same coordinates across all records

    Displaying **{len(shared_coordinates)}** unnamed coordinates, chosen by the
    largest mean absolute pooled value across this artifact. Every row uses
    the same coordinate IDs and color scale; missing sparse coordinates are
    zero. Values retain their signs. This is descriptive selection on the
    displayed data, with no concept labels or held-out quality claim.
    """), capture_charts["shared-coordinates"]])
    return


@app.cell
def _(mo):
    mo.md("""
    Static PNG/SVG/HTML export uses the explicit `observer_report.py` CLI
    documented in `docs/observer-pipeline.md`. This notebook only reads.
    Coordinate meanings, probe accuracy, intervention effects, and human
    learning outcomes require separate evidence and remain **unestablished**.
    """)
    return


if __name__ == "__main__":
    app.run()
