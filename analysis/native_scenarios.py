# /// script
# requires-python = ">=3.12"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy>=2,<3", "matplotlib==3.10.*"]
# ///
"""Compare pinned original records with admitted native starting states. Read-only."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import json
    from pathlib import Path
    import marimo as mo
    import pandas as pd
    import numpy as np
    import matplotlib.pyplot as plt
    root = Path(__file__).resolve().parents[1]
    packs = {}
    for _path in sorted((root / '.keating/native-learning/scenarios').glob('*/scenarios.json')):
        _value = json.loads(_path.read_text())
        if isinstance(_value, dict) and 'scenarios' in _value:
            packs[str(_path.relative_to(root))] = _value
    plt.rcParams.update({'axes.spines.top': False, 'axes.spines.right': False,
                         'svg.hashsalt': 'keating-native-scenarios-v1', 'font.family': 'DejaVu Sans'})
    return json, mo, np, packs, pd, plt


@app.cell
def _(mo, packs):
    mo.md(f'''# From published records to native starting states

    **{len(packs)} local scenario packs** available. The importer preserves the
    problem and pre-decision learner evidence. Keating chooses the next teaching
    move when an episode runs. Original tutor candidates, later continuations,
    private solutions, and source annotations remain evaluator material.

    Development admission excludes protected source families, including their
    appearances in other collections. The reference track permits descriptive
    comparisons; it retains development-exposure labels and is a different
    condition from each publisher's original benchmark. Counts below describe
    source records, not independent people or measured learning.

    Build packs explicitly with `scripts/training/native_scenarios.py build`.
    This notebook only reads saved packs and never downloads, admits, or runs them.
    ''')
    return


@app.cell
def _(mo, packs, pd):
    _rows = []
    for _name, _pack in packs.items():
        for _source in sorted({s['source']['dataset'] for s in _pack['scenarios']} |
                              {r['dataset'] for r in _pack.get('rejected', [])}):
            _selected = [s for s in _pack['scenarios'] if s['source']['dataset'] == _source]
            _rows.append({'pack': _name, 'purpose': _pack['purpose'], 'source': _source,
                          'admitted_records': len(_selected), 'admitted_families': len({s['family'] for s in _selected}),
                          'rejected_records': sum(r['dataset'] == _source for r in _pack.get('rejected', []))})
    coverage = pd.DataFrame(_rows)
    mo.ui.table(coverage, selection=None)
    return (coverage,)


@app.cell
def _(coverage, mo, plt):
    mo.stop(coverage.empty, mo.md('Build a scenario pack to inspect admission coverage.'))
    _fig, _ax = plt.subplots(figsize=(10, max(3, .4 * len(coverage))))
    _labels = coverage['source'] + ' · ' + coverage['purpose']
    _ax.barh(range(len(coverage)), coverage['admitted_records'], label='Admitted', color='#00836B')
    _ax.barh(range(len(coverage)), coverage['rejected_records'], left=coverage['admitted_records'], label='Rejected', color='#89969C')
    _ax.set_yticks(range(len(coverage)), _labels)
    _ax.set_xlabel('Source records; variants may share a family')
    _ax.set_title('Admission preserves the failure denominator')
    _ax.legend()
    _fig.tight_layout()
    _fig
    return


@app.cell
def _(mo, packs):
    pack_choice = mo.ui.dropdown(options=list(packs) or ['No pack'], value=next(iter(packs), 'No pack'), label='Pack')
    pack_choice
    return (pack_choice,)


@app.cell
def _(mo, pack_choice, packs):
    mo.stop(pack_choice.value not in packs, mo.md('No pack available.'))
    pack = packs[pack_choice.value]
    case_choice = mo.ui.dropdown(options={s['id']: s['id'] for s in pack['scenarios']},
                                 value=next((s['id'] for s in pack['scenarios']), None), label='Scenario')
    case_choice
    return case_choice, pack


@app.cell
def _(case_choice, json, mo, pack):
    mo.stop(not case_choice.value, mo.md('No admitted scenario in this pack.'))
    scenario = next(s for s in pack['scenarios'] if s['id'] == case_choice.value)
    mo.vstack([
        mo.md(f"### {scenario['source']['dataset']} · {scenario['source']['record_id']}\nFamily: `{scenario['family']}`"),
        mo.md('**Actor input at the native decision boundary**'),
        mo.plain_text(scenario['actor']['opening_message']),
        mo.md('**Learner evidence and labeled assumptions**'),
        mo.plain_text(json.dumps(scenario['learner'], ensure_ascii=False, indent=2)),
        mo.accordion({'Original and private assessment material — researcher only':
                         mo.plain_text(json.dumps(scenario['evaluation_only'], ensure_ascii=False, indent=2)),
                      'Source hash and transformation history':
                         mo.plain_text(json.dumps(scenario['source'], indent=2))}),
    ])
    return (scenario,)


@app.cell
def _(mo, pack, pd):
    _rejected = pd.DataFrame(pack.get('rejected', []))
    mo.md('### Rejections require review, not invented context')
    mo.ui.table(_rejected, selection=None)
    return


if __name__ == '__main__':
    app.run()
