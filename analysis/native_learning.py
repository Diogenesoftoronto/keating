# /// script
# requires-python = ">=3.12"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy>=2,<3", "matplotlib==3.10.*"]
# ///
"""Review actual native episodes and their missing evidence; never run providers."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import sys
    import json
    from pathlib import Path
    import marimo as mo
    import pandas as pd
    import numpy as np
    import matplotlib.pyplot as plt
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / 'scripts/training'))
    from native_report import ledger_plot
    episodes = {}
    for _path in sorted((root / '.keating/native-learning').rglob('*.json')):
        _data = json.loads(_path.read_text())
        if isinstance(_data, dict) and 'ledger' in _data and 'runtime' in _data:
            episodes[str(_path.relative_to(root))] = _data
    return episodes, json, ledger_plot, mo, np, pd, plt


@app.cell
def _(episodes, mo):
    mo.md(f'''# Native learner decisions and runtime evidence

    **{len(episodes)} local traces** found. The learner controller receives actual
    delivered text and semantic activity content, then proposes a message, action,
    session transition, or stop. The existing Pi runtime delivers the action and
    records its result. Gold answers, future continuations, and evaluator annotations
    stay outside learner and actor requests.

    Offline tapes and authored learner policies measure **integration behavior**.
    Real simulator fidelity, probe quality, learning, and policy gains need separate
    experiments. No calls or training run when this notebook opens.
    ''')
    return


@app.cell
def _(episodes, mo, pd):
    summary = pd.DataFrame([dict(file=path, id=e['id'], family=e['family'], outcome=e['outcome'],
                                measurement=e['measurement'], events=len(e['ledger']),
                                provider_calls=len(e['runtime']['requests']), assessment='unknown' if e['assessment'] is None else 'recorded',
                                training_eligible=e['training']['eligible']) for path,e in episodes.items()])
    mo.ui.table(summary, selection=None)
    return (summary,)


@app.cell
def _(mo, summary, plt):
    mo.stop(summary.empty, mo.md('Run the native integration checks or an explicit configured episode to collect a trace.'))
    _counts = summary.groupby(['measurement', 'outcome']).size()
    _fig, _ax = plt.subplots(figsize=(9, 3.5))
    _counts.plot.barh(ax=_ax, color='#0072B2')
    _ax.set_xlabel('Attempted episodes, not independent learners')
    _ax.set_title('Observed completion and failure denominator')
    _fig.tight_layout()
    _fig
    return


@app.cell
def _(episodes, mo):
    choice = mo.ui.dropdown(options=list(episodes) or ['No trace'], value=next(iter(episodes), 'No trace'), label='Trace')
    choice
    return (choice,)


@app.cell
def _(choice, episodes, ledger_plot, mo):
    mo.stop(choice.value not in episodes, mo.md('No trace selected.'))
    episode = episodes[choice.value]
    ledger_plot(episode)
    return (episode,)


@app.cell
def _(episode, mo, pd):
    mo.ui.table(pd.DataFrame([dict(sequence=e['sequence'], event=e['kind'], origin=e['origin'],
                                  visibility=e['visibility'], hash=e['hash']) for e in episode['ledger']]), selection=None)
    return


@app.cell
def _(episode, mo):
    mo.vstack([mo.md(f"### Delivered content at event {e['sequence']}"), mo.plain_text(str(e['payload']))]
              for e in episode['ledger'] if e['kind'] == 'delivered_observation')
    return


if __name__ == '__main__':
    app.run()
