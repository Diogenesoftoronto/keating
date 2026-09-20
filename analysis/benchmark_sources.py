# /// script
# requires-python = ">=3.12"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy>=2,<3", "matplotlib==3.10.*"]
# ///
"""Explore pinned original resources without downloading or running providers."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import sys
    from pathlib import Path
    import json
    import marimo as mo
    import pandas as pd
    import numpy as np
    import matplotlib.pyplot as plt
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/training'))
    import benchmark_sources as sources
    catalog = sources.source_catalog()
    inventory = pd.DataFrame(sources.inventory())
    plt.rcParams.update({'axes.spines.top': False, 'axes.spines.right': False,
                         'svg.hashsalt': 'keating-benchmark-sources-v1'})
    return catalog, inventory, json, mo, np, pd, plt, sources


@app.cell
def _(mo):
    mo.md('''
    # Original benchmark sources

    Browse the original records beside their pinned provenance before designing
    Keating events. This is an **evaluator view**: records can contain answers,
    future dialogue, labels, and annotations that must stay out of tutor inputs.

    Files are verified locally. To download missing files, run
    `python scripts/training/benchmark_sources.py fetch`; this notebook never
    downloads data, executes upstream code, or calls a model.

    Counts describe selected files, **not independent evaluation examples**.
    MathDial, Bridge, MRBench and MathTutorBench overlap. StudentSim is software;
    its documentation and license are cached, with no student simulation run.
    ''')
    return


@app.cell
def _(inventory, mo):
    mo.ui.table(inventory, selection=None)
    return


@app.cell
def _(inventory, np, plt):
    _data = inventory[inventory['rows'].notna()]
    _fig, _ax = plt.subplots(figsize=(10, max(3, len(_data) * .35)))
    _ax.barh(np.arange(len(_data)), _data['rows'], color='#0072B2')
    _ax.set_yticks(np.arange(len(_data)), _data['source'] + '/' + _data['file'])
    _ax.set_xlabel('Original records per selected file (overlaps not deduplicated)')
    _fig.tight_layout()
    _fig
    return


@app.cell
def _(catalog, mo):
    source_choice = mo.ui.dropdown(options=[s['id'] for s in catalog], value='mathdial', label='Source')
    source_choice
    return (source_choice,)


@app.cell
def _(catalog, mo, source_choice):
    selected = next(s for s in catalog if s['id'] == source_choice.value)
    mo.md(f"""## {selected['title']}

    {selected['scope']}

    License declaration: **{selected['license']}** · Reuse status: **{selected['reuse_status']}**

    Revision: `{selected['revision']}` · [Publisher]({selected['url']})

    These statuses record known terms and uncertainties; local availability does
    not resolve commercial permissions. Only TutorMoments currently has authored
    Keating adaptations; the other data here remain original source material.
    """)
    return (selected,)


@app.cell
def _(mo, selected):
    file_choice = mo.ui.dropdown(options=[f['path'] for f in selected['files']],
                                 value=selected['files'][0]['path'], label='Original file')
    file_choice
    return (file_choice,)


@app.cell
def _(file_choice, selected, sources):
    asset = next(f for f in selected['files'] if f['path'] == file_choice.value)
    records = []
    original_text = ''
    if sources.original_path(selected, asset).exists():
        records = sources.original_records(selected, asset)
        if not asset['path'].endswith(('.json', '.jsonl')):
            original_text = sources.checked_bytes(selected, asset).decode('utf-8')
    return asset, original_text, records


@app.cell
def _(mo, records):
    record_index = mo.ui.number(start=0, stop=max(0, len(records)-1), value=0, step=1, label='Record index')
    record_index
    return (record_index,)


@app.cell
def _(asset, json, mo, original_text, record_index, records):
    _text = json.dumps(records[int(record_index.value)], indent=2, ensure_ascii=False) if records else original_text
    mo.vstack([mo.md(f"SHA-256: `{asset['sha256']}`"),
               mo.ui.code_editor(value=_text or 'Not downloaded.', language='json' if records else 'markdown', disabled=True)])
    return


if __name__ == '__main__':
    app.run()
