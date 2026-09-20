# /// script
# requires-python = ">=3.12"
# dependencies = ["matplotlib==3.10.*", "numpy>=2,<3", "pandas==2.*"]
# ///
"""Render actual native event ledgers, with missing outcome/training evidence explicit."""
import argparse
from collections import Counter
from datetime import datetime
import html
import json
import os
from pathlib import Path


def ledger_plot(episode):
    import matplotlib.pyplot as plt
    plt.rcParams['svg.hashsalt'] = 'keating-native-event-ledger-v2'
    events = episode['ledger']
    origin = datetime.fromisoformat(events[0]['timestamp'])
    times = [(datetime.fromisoformat(e['timestamp']) - origin).total_seconds() for e in events]
    colors = {'runtime': '#0072B2', 'learner': '#00836B', 'controller': '#C97900'}
    fig, ax = plt.subplots(figsize=(10, max(3.5, len(events) * .3)))
    ax.hlines(range(len(events)), 0, times, color='#dce4e8')
    ax.scatter(times, range(len(events)), c=[colors[e['origin']] for e in events], zorder=3)
    ax.set_yticks(range(len(events)), [f"{e['sequence']:02d} {e['kind']}" for e in events])
    ax.invert_yaxis()
    ax.set_xlabel('Elapsed seconds when the controller appended the ledger event')
    ax.set_title(f"{episode['branch_id']} · {episode['outcome']}")
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout()
    return fig


def render_report(episode, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    figure = ledger_plot(episode)
    figure.savefig(output / 'events.svg')
    figure.savefig(output / 'events.png', dpi=150)
    transcript = []
    for event in episode['ledger']:
        start = len(transcript)
        if event['kind'] == 'learner_initial_message':
            transcript.append(('Initial learner', event['payload']['text']))
        elif event['kind'] == 'delivered_observation':
            observation = event['payload']
            text = observation['visibleText'] + '\n' + '\n'.join(d['heading']+'\n'+'\n'.join(d['body']) for d in observation['documents'])
            text += '\n\nAvailable controls\n' + json.dumps(observation['availableActions'], ensure_ascii=False, indent=2)
            transcript.append(('Delivered content', text))
        elif event['kind'] == 'learner_intent':
            transcript.append(('Learner decision', json.dumps(event['payload']['intent'], ensure_ascii=False, indent=2)))
        elif event['kind'] == 'action_receipt':
            transcript.append(('Runtime delivery receipt', json.dumps(event['payload'], ensure_ascii=False, indent=2)))
        elif event['kind'] in ('tool_call', 'tool_result'):
            transcript.append(('Actual ' + event['kind'].replace('_', ' '), json.dumps(event['payload'], ensure_ascii=False, indent=2)))
        elif event['kind'] in ('invalid_learner_intent', 'learner_provider_failure', 'episode_end'):
            transcript.append((event['kind'].replace('_', ' ').capitalize(), json.dumps(event['payload'], ensure_ascii=False, indent=2)))
        if len(transcript) > start:
            title, text = transcript[-1]
            transcript[-1] = (event['sequence'], event['event_id'], event['payload_hash'], title, text)
    end = next(e['payload'] for e in reversed(episode['ledger']) if e['kind'] == 'episode_end')
    counts = Counter(e['kind'] for e in episode['ledger'])
    surface = episode['runtime'].get('configuration', {}).get('surface', 'legacy surface (not an explicit paired condition)')
    sections = ''.join(f'<article id="event-{sequence}"><h2><a href="#event-{sequence}">{sequence:02d} · {html.escape(title)}</a></h2><details><summary>Evidence identity</summary><p>Event: <code>{html.escape(event_id)}</code></p><p>Payload SHA-256: <code>{html.escape(payload_hash)}</code></p></details><pre>{html.escape(text)}</pre></article>' for sequence,event_id,payload_hash,title,text in transcript)
    body = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Native learning trace</title><style>body{{max-width:1050px;margin:40px auto;padding:0 20px;font:17px/1.6 system-ui;color:#254e63;background:#fcfcf9}}article{{padding:16px;background:#eef5f3;margin:20px 0}}h2{{font-size:19px}}pre,code{{white-space:pre-wrap;overflow-wrap:anywhere}}img{{width:100%}}table{{border-collapse:collapse;display:block;overflow:auto}}td,th{{padding:10px;border:1px solid #cedcd9;text-align:left}}a{{color:#00836B;text-underline-offset:3px}}summary{{cursor:pointer}}article{{scroll-margin-top:20px}}</style>
    <h1>Actual native event trace</h1><p>{html.escape(episode['id'])}</p>
    <p>Measurement: <strong>{html.escape(episode['measurement'])}</strong>. Learner policy: {html.escape(episode['learner_policy']['model'])}.
    Follow the delivered content, the learner's decision and the runtime's response in event order.</p>
    <p>Branch: <strong>{html.escape(episode['branch_id'])}</strong>. Surface: {html.escape(surface)}.
    Actual learner decisions: {counts['learner_intent']}; delivered observations: {counts['delivered_observation']}; tool calls: {counts['tool_call']}; submission receipts: {counts['action_receipt']}.</p>
    <p>Runtime error: <code>{html.escape(str(end.get('runtime_error') or 'none'))}</code>.</p>
    <table><tr><th>Outcome</th><th>Runtime requests</th><th>Assessment</th><th>Training eligibility</th></tr>
    <tr><td>{html.escape(episode['outcome'])}</td><td>{len(episode['runtime']['requests'])}</td><td>{'Not recorded' if episode.get('assessment') is None else html.escape(json.dumps(episode['assessment'], ensure_ascii=False))}</td><td>{html.escape(str(episode['training']['eligible']))}</td></tr></table>
    <img src="events.svg" alt="Timeline of actual controller, runtime, and learner events">
    <p>Blue: runtime evidence; green: learner; orange: controller. The chart uses ledger append times.</p>{sections}
    <section id="limitations"><h2>Limitations and reading the evidence</h2>
    <p>A submission receipt establishes delivery. Learning and correctness need a separate assessment; the table reports only an assessment stored in this episode. Authored policies and tapes exercise runtime plumbing. Model-generated episodes supply behavior for review.</p>
    <p>The outcome <code>budget_exhausted</code> includes a configured turn or call horizon. Read the episode end and funding ledger to distinguish a resource limit from a dollar cap. Several collected receipts can be appended together, so aligned dots do not mean simultaneous execution.</p>
    <p>This timeline does not measure observer activations or attest actor behavior probabilities. Training eligibility remains the episode's recorded decision. Semantic terminal observations establish the content and controls supplied to the learner; they do not verify browser rendering.</p></section></html>'''
    (output / 'index.html').write_text(body)
    for file in output.iterdir():
        if file.is_file():
            os.chmod(file, 0o600)
    return output / 'index.html'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('episode', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(render_report(json.loads(args.episode.read_text()), args.output))


if __name__ == '__main__':
    main()
