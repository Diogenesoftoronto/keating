"""Inspect exact frozen dialogue revisions and an explicitly authored reward example."""
import hashlib
import html
import json


def revision_data(current, previous, current_manifest, previous_manifest):
    old, new = json.loads(previous.read_text()), json.loads(current.read_text())
    assert old['version'] == '4.0.0' and new['version'] == '4.1.0'
    for path, manifest in ((current, current_manifest), (previous, previous_manifest)):
        assert hashlib.sha256(path.read_bytes()).hexdigest() == json.loads(manifest.read_text())['files']['cases.json']
    before = {case['id']: case for case in old['cases']}
    assert set(before) == {case['id'] for case in new['cases']}
    cases = []
    for case in new['cases']:
        prior = before[case['id']]
        assert case['family'] == prior['family'] and len(case['steps']) == len(prior['steps'])
        turns = []
        for i, (a, b) in enumerate(zip(prior['steps'], case['steps'])):
            assert a['kind'] == b['kind']
            if b['kind'] == 'message':
                turns.append({'step_index': i, 'before': a['text'], 'after': b['text']})
        cases.append({'id': case['id'], 'title': case['title'], 'family': case['family'], 'turns': turns})
    assert len(cases) == 12 and sum(len(c['turns']) for c in cases) == 73
    assert all(t['before'] != t['after'] for c in cases for t in c['turns'])
    return {'versions': ['4.0.0', '4.1.0'], 'source': 'frozen authored benchmark dialogue',
            'manifest_sha256': {version: hashlib.sha256(path.read_bytes()).hexdigest() for version, path in
                                [('4.0.0', previous_manifest), ('4.1.0', current_manifest)]},
            'cases': cases, 'case_count': 12, 'message_count': 73, 'family_count': len({c['family'] for c in cases}),
            'v41_model_outcomes': None, 'contextual_training_run': None}


def revision_workbench(data):
    esc = html.escape
    options = ''.join(f'<option value="{i}">{esc(c["title"])}</option>' for i, c in enumerate(data['cases']))
    panels = []
    for i, case in enumerate(data['cases']):
        rows = ''.join(f'<tr><th scope="row">{t["step_index"] + 1}</th><td>{esc(t["before"])}</td><td>{esc(t["after"])}</td></tr>' for t in case['turns'])
        panels.append(f'<section class="revision-case" data-revision-case="{i}"><h4>{esc(case["title"])}</h4>'
                      f'<p class="small">Family: {esc(case["family"])} · {len(case["turns"])} learner turns</p>'
                      '<div class="table-scroll"><table><thead><tr><th>Step</th><th>v4.0 · earlier dialogue</th><th>v4.1 · natural learner evidence</th></tr></thead>'
                      f'<tbody>{rows}</tbody></table></div></section>')
    return '''<section class="revision-workbench" aria-label="Inspect all 73 frozen learner dialogue changes">
<h3>What we changed, word for word</h3><p>Choose any of the twelve cases. These are exact authored benchmark inputs, not model replies or new experimental results.</p>
<label class="revision-control" for="revision-case">Inspect a case<select id="revision-case">''' + options + '''</select></label>
<div id="revision-cases">''' + ''.join(panels) + '''</div>
<p class="small">The printed report shows the first case. <a href="dialogue-revisions.json">Download all 73 before-and-after turns with frozen source hashes.</a></p></section>

<section class="reward-workbench" aria-label="Explore a contextual teaching reward">
<h3>Keep the explanation. Change the evidence.</h3>
<p class="small">Authored illustration of the implemented scoring rule. These labels are supplied for explanation; they are not fitted probe predictions.</p>
<div class="reward-controls" role="group" aria-label="Learner situation">
<button type="button" data-reward-context="difficulty" aria-pressed="true">Repeated difficulty</button>
<button type="button" data-reward-context="progress" aria-pressed="false">Productive reasoning</button>
<button type="button" data-reward-context="withhold" aria-pressed="false">Help withheld</button></div>
<div class="reward-scene" aria-live="polite">
<div><p class="view-label">Evidence before teaching</p><p id="reward-prefix">I keep taking 6 away from 30. I tried that again and it still does not work.</p><p class="small" id="reward-need">Need: explanation warranted by the recurring misconception.</p></div>
<div><p class="view-label">Delivered tutor move</p><p id="reward-response"><mark>6x means six times x. Divide both sides by 6 to undo that multiplication.</mark> What does that leave?</p><p class="small" id="reward-fit">Fit: appropriate, substantive and mathematically correct.</p></div>
</div>
<div class="reward-path" aria-label="From judgment to training"><div><span>Response grade</span><strong id="reward-grade">2 / 2</strong></div><span aria-hidden="true">→</span><div><span>Once per action</span><strong id="reward-value">+1</strong></div><span aria-hidden="true">→</span><div><span>Feature loss</span><strong id="reward-effect">Encourage this move</strong></div></div>
<p class="small">At scale 1: reward = grade − 1. Highlighted spans explain the judgment; they do not multiply the reward. Unknown judgments abstain. <a href="index.html#term-context-fit">What does contextual fit mean?</a></p></section>'''
