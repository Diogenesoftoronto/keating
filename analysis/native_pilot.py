# /// script
# requires-python = ">=3.12"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy>=2,<3", "matplotlib==3.10.*"]
# ///
"""Read-only Stage 1 candidate coverage, denominators, and paired family effects."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import hashlib
    import json
    from pathlib import Path
    import marimo as mo
    import pandas as pd
    import numpy as np
    import matplotlib.pyplot as plt
    root = Path(__file__).resolve().parents[1]
    artifacts = {}
    artifact_errors = []
    for _directory in (root / '.keating/outputs', root / '.keating/native-learning/scenarios'):
        for _path in sorted(_directory.glob('native-pilot*/*.json')):
            if _path.name not in ('candidates.json', 'report.json'):
                continue
            try:
                _value = json.loads(_path.read_text())
                _seal = 'selection_sha256' if _path.name == 'candidates.json' else 'report_sha256'
                _body = {k: v for k, v in _value.items() if k != _seal}
                _hash = hashlib.sha256(json.dumps(_body, sort_keys=True, ensure_ascii=False,
                                                  separators=(',', ':'), allow_nan=False).encode()).hexdigest()
                if _value.get(_seal) != _hash:
                    raise ValueError('Artifact checksum mismatch')
                artifacts[str(_path.relative_to(root))] = _value
            except (ValueError, OSError, TypeError) as _error:
                artifact_errors.append({'file': str(_path.relative_to(root)), 'error': str(_error)})
    plt.rcParams.update({'axes.spines.top': False, 'axes.spines.right': False,
                         'font.family': 'DejaVu Sans', 'svg.hashsalt': 'keating-native-pilot-v1'})
    return artifact_errors, artifacts, mo, np, pd, plt


@app.cell
def _(artifact_errors, artifacts, mo):
    mo.vstack([
        mo.md('''# Stage 1: what is planned, what was observed

        The design is **30 source situations × 2 formats × 3 paired replicates**.
        Candidate selection establishes coverage. Exact runnable settings and
        independent source-context and format reviews precede dispatch.

        This notebook reads local artifacts. It never creates approvals, runs
        episodes, generates ratings, or calls a model. Zero known outcomes means
        **unknown**, including after a successful runtime trace.
        '''),
        mo.md(f'**{len(artifacts)} verified local artifacts**. Hash verification checks integrity, not review truth or runtime delivery.'),
        mo.ui.table(artifact_errors, selection=None) if artifact_errors else mo.md(''),
    ])
    return


@app.cell
def _(artifacts, mo):
    artifact_choice = mo.ui.dropdown(options=list(artifacts) or ['No artifact'],
                                    value=next(iter(artifacts), 'No artifact'), label='Pilot artifact')
    artifact_choice
    return (artifact_choice,)


@app.cell
def _(artifact_choice, artifacts, mo):
    mo.stop(artifact_choice.value not in artifacts,
            mo.md('Run `native_pilot.py candidates` or `report` into an ignored `native-pilot*` directory to inspect it here.'))
    artifact = artifacts[artifact_choice.value]
    return (artifact,)


@app.cell
def _(artifact, mo, np, pd, plt):
    if artifact['kind'] == 'native-stage1-candidates':
        _coverage = pd.DataFrame(artifact['coverage'])
        _fig, _ax = plt.subplots(figsize=(9, 3.8))
        _x = np.arange(len(_coverage))
        _ax.bar(_x - .18, _coverage['selected_situations'], width=.36, label='Situations', color='#0072B2')
        _ax.bar(_x + .18, _coverage['selected_source_families'], width=.36, label='Source families', color='#00836B')
        _ax.set_xticks(_x, _coverage['dataset'], rotation=18)
        _ax.set_ylabel('Selected count')
        _ax.set_title('Candidate coverage before model settings or reviews')
        _ax.legend()
        _fig.tight_layout()
        _view = mo.vstack([mo.md(artifact['reason']), _fig,
                           mo.md('**No episodes or learning outcomes are implied by these counts.**'),
                           mo.ui.table(_coverage, selection=None),
                           mo.ui.table(artifact['source_family_groups'], selection=None),
                           mo.md('Required before dispatch: ' + '; '.join(artifact['required_before_dispatch']))])
    else:
        _view = mo.md(f"**{artifact['planned']} planned · {artifact['attempted']} attempted · {artifact['unattempted']} unattempted**\n\n"
                      f"{artifact['source_situations']} source situations in {artifact['source_families']} source-family groups.")
    _view
    return


@app.cell
def _(artifact, mo, np, pd, plt):
    if artifact['kind'] == 'native-stage1-report':
        _rows = pd.DataFrame([r for r in artifact['denominators'] if r['dataset'] == 'all'])
        _fig, _ax = plt.subplots(figsize=(8, 3.8))
        _x = np.arange(len(_rows))
        _ax.bar(_x, _rows['attempted'], color='#0072B2', label='Attempted')
        _ax.bar(_x, _rows['unattempted'], bottom=_rows['attempted'], color='#dce4e8', label='Unattempted')
        _ax.scatter(_x, _rows['failures'], color='#C97900', marker='x', s=80, label='Failed attempts (subset)')
        _ax.set_xticks(_x, _rows['condition'])
        _ax.set_ylabel('Episode slots')
        _ax.set_title('Keep the planned denominator when execution is missing')
        _ax.legend()
        _fig.tight_layout()
        _display = mo.vstack([_fig, mo.ui.table(artifact['denominators'], selection=None)])
    else:
        _display = mo.md('No attempt report is attached to this candidate selection.')
    _display
    return


@app.cell
def _(artifact, mo):
    _metrics = list(artifact.get('metrics', {}))
    metric_choice = mo.ui.dropdown(options=_metrics or ['No assessed metrics'],
                                  value=next(iter(_metrics), 'No assessed metrics'), label='Declared metric')
    metric_choice
    return (metric_choice,)


@app.cell
def _(artifact, metric_choice, mo, np, pd, plt):
    mo.stop(metric_choice.value not in artifact.get('metrics', {}),
            mo.md('Paired effects appear only after evidence-linked outcomes are supplied.'))
    metric = artifact['metrics'][metric_choice.value]
    _families = pd.DataFrame(metric['source_family_groups'])
    _known = _families['available_pair_effect'].notna()
    _fig, _ax = plt.subplots(figsize=(9, max(3, .25 * len(_families))))
    _y = np.arange(len(_families))
    _ax.barh(_y[_known], _families.loc[_known, 'available_pair_effect'], color='#00836B')
    for _index in _y[~_known]:
        _ax.annotate('unknown', (0, _index), xytext=(5, 0), textcoords='offset points', va='center', color='#536570')
    _ax.set_yticks(_y, _families['source_family'])
    _ax.axvline(0, color='#89969C', linewidth=.8)
    _ax.set_xlabel('Interactive − chat, available matched replicates only')
    _ax.set_title('Every selected source family remains visible')
    _fig.tight_layout()
    _full = metric['full_pilot_effect']
    mo.vstack([
        mo.md(f"**{metric['paired_replicates']} / 90 matched replicate pairs** · {metric['complete_situations']} / 30 fully observed situations.\n\n"
              f"Full-pilot effect: **{'unknown' if _full is None else f'{_full:.4g}'}**."),
        mo.ui.table([{'condition': c, **v} for c, v in metric['outcomes'].items()], selection=None),
        _fig, mo.ui.table(_families, selection=None),
    ])
    return (metric,)


@app.cell
def _(artifact, metric, mo, plt):
    _estimate = metric['available_pairs']
    _rows = []
    for _name in ('situation', 'family'):
        _rows.append({'weighting': _name, 'effect': _estimate[f'{_name}_weighted'],
                      'ci95': _estimate[f'ci95_{_name}_weighted']})
    _fig, _ax = plt.subplots(figsize=(8, 2.8))
    for _i, _row in enumerate(_rows):
        if _row['effect'] is not None:
            _ax.scatter([_row['effect']], [_i], color='#0072B2')
            if _row['ci95'] is not None:
                _ax.hlines(_i, *_row['ci95'], color='#0072B2', linewidth=2)
        else:
            _ax.annotate('unknown', (0, _i))
    _ax.set_yticks([0, 1], ['Equal situation weight', 'Equal source-family weight'])
    _ax.set_ylim(-.6, 1.6)
    _ax.axvline(0, color='#89969C', linewidth=.8)
    _ax.set_xlabel('Available-pair effect; percentile 95% interval')
    _fig.tight_layout()
    mo.vstack([_fig, mo.md(f"Bootstrap resamples **whole source-family blocks**, after averaging matched replicates within situations. "
                          f"Available evidence covers {_estimate['situations']} situations in {_estimate['families']} families. "
                          f"Interval status: {_estimate['reason'] or 'estimated'}.\n\n"
                          + '\n\n'.join(artifact['limitations']))])
    return


if __name__ == '__main__':
    app.run()
