"""Static, allowlisted evidence views with optional local-browser diagnostics."""
import html
import json
import math


def esc(value):
    return html.escape(str(value), quote=True)


def data_script(name, value):
    return f'<script type="application/json" id="{name}">' + json.dumps(value, ensure_ascii=False).replace('<', '\\u003c') + '</script>'


def readable(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return str(value)


def details(title, value):
    return f'<details><summary>{esc(title)}</summary><pre class="verbatim">{esc(readable(value))}</pre></details>'


def validate_inspector_data(datasets, probes):
    for value in (datasets, probes):
        assert value['schema_version'] == 1
        assert value['examples'] and len({r['id'] for r in value['examples']}) == len(value['examples'])
    for row in datasets['examples']:
        assert row['source']['excerpt'] and row['native']['text'] and row['changes']
        assert row['source']['url'].startswith('https://')
        assert row['source']['license']
    threshold = probes['measurement']['threshold']
    assert type(threshold) in (float, int) and 0 <= threshold <= 1
    for row in probes['examples']:
        assert row['prompt'] and row['response']
        assert row['label'] in (0, 1) and row['split'] == 'test'
        for key in ('sae', 'raw', 'text'):
            score = row['scores'][key]
            assert type(score) in (float, int) and math.isfinite(score) and 0 <= score <= 1


def render_dataset_inspector(data):
    rows = data['examples']
    options, panels = [], []
    for index, row in enumerate(rows):
        name = {'tutormoments': 'TutorMoments', 'mathdial': 'MathDial', 'mrbench': 'MRBench / BEA'}.get(row['dataset'], row['dataset'])
        options.append(f'<option value="{index}">{esc(name)} · {esc(row["title"])}</option>')
        source, native = row['source'], row['native']
        changes = ''.join(f'<li>{esc(change)}</li>' for change in row['changes'])
        withheld = ''.join(f'<li>{esc(field)}</li>' for field in row['review'].get('private_fields_withheld', []))
        review = f'<details><summary>Inspect assessment and visibility</summary><p>Admission: {esc(row["review"].get("admission", ""))}. Review status: {esc(row["review"].get("context_review", ""))}.</p><h5>Kept outside the tutor request</h5><ul>{withheld}</ul></details>'
        provenance = {'source_record': source['record_id'], 'source_revision': source['revision'],
                      'source_sha256': source['sha256'], 'native_id': native['id'],
                      'evidence': row['evidence']}
        panels.append(f'''<section class="diagnostic-panel" data-dataset-panel="{index}" data-featured="{str(index < 2).lower()}">
        <h4 class="record-heading">{esc(row['title'])}</h4>
        <p class="record-meta">{esc(name)} · {esc(source['record_id'])}</p>
        <div class="pair"><div class="evidence-pane"><h4>Original dataset</h4>
        <p class="source-unit">{esc(source['unit'])}</p><div class="verbatim">{esc(source['excerpt'])}</div>
        <p class="source-unit">{esc(source.get('attribution', name))}<br><a href="{esc(source['url'])}">Pinned source file</a> · <a href="{esc(source.get('license_url', source['url']))}">{esc(source['license'])}</a></p></div>
        <div class="evidence-pane native"><h4>Native starting state</h4><p class="source-unit">Saved tutor input · {esc(row['review'].get('admission', ''))} · {esc(native.get('license', source['license']))}</p>
        <div class="verbatim">{esc(native['text'])}</div></div></div>
        <p class="review-note"><strong>What to notice:</strong> {esc(row['review'].get('finding', ''))}</p>
        <h4>What changed</h4><ul class="change-list">{changes}</ul>
        {review}
        {details('Inspect source identity and hashes', provenance)}</section>''')
    return '''<section class="inspector" id="dataset-workbench" aria-label="Original and native dataset examples">
    <div class="inspector-tools js-only"><label for="dataset-choice">Choose a source / native pair<select id="dataset-choice">''' + ''.join(options) + '''</select></label><a href="dataset-examples.json" download>Download paired records ↓</a></div>''' + ''.join(panels) + '''<p class="review-note">Source excerpts and adapted openings are paired by recorded identity. Expand the assessment view to see what stays outside the tutor request.</p></section>'''


def render_probe_inspector(data):
    rows, measurement = data['examples'], data['measurement']
    threshold = measurement['threshold']
    featured = set(data.get('featured_ids', [r['id'] for r in rows[:3]]))
    options, panels = [], []
    for index, row in enumerate(rows):
        label = 'Premature answer' if row['label'] else 'Not premature'
        prediction = int(row['scores']['sae'] >= threshold)
        diagnosis = 'Matches label' if prediction == row['label'] else ('Missed premature answer' if row['label'] else 'False alarm')
        options.append(f'<option value="{index}">{esc(row.get("title", row["id"]))}</option>')
        bars = ''
        for key, title in [('sae', 'SAE readout'), ('raw', 'Raw activations'), ('text', 'Text baseline')]:
            score = row['scores'][key]
            marker = f'<i class="threshold-marker" style="--threshold:{threshold*100}%" aria-hidden="true"></i>' if key == 'sae' else ''
            bars += f'<div class="probability-row"><span>{title}</span><div class="probability-track"><i class="probability-fill" style="width:{score*100}%"></i>{marker}</div><strong>{score:.3f}</strong></div>'
        contributions = ''
        for feature in data.get('features', []):
            observed = next(item for item in feature['observations'] if item['example_id'] == row['id'])
            contributions += f'<tr><th scope="row">{feature["feature_id"]}</th><td>{observed["scaled_activation"]:.4f}</td><td>{feature["weight"]:+.4f}</td><td>{observed["logit_contribution"]:+.4f}</td></tr>'
        contributions = f'''<details><summary>How these features contributed to this score</summary><p>The five largest weights in the fitted probe are shown below. Each measured activation is divided by its training-set scale, then multiplied by its weight. These contributions add to the readout's <a href="#term-logit">logit</a> before conversion to a probability.</p><div class="table-scroll"><table><thead><tr><th>Feature ID</th><th>Scaled activation</th><th>Weight</th><th>Contribution</th></tr></thead><tbody>{contributions}</tbody></table></div><p>Shown features: {row['sae_readout']['selected_feature_logit_sum']:+.4f}. Remaining 14 weights: {row['sae_readout']['other_feature_logit_sum']:+.4f}. The fitted intercept and calibration complete the calculation. The download includes the exact values and recipe.</p></details>'''
        panels.append(f'''<section class="diagnostic-panel" data-probe-panel="{index}" data-featured="{str(row['id'] in featured).lower()}">
        <h4 class="record-heading">{esc(row.get('title', row['id']))}</h4><p class="record-meta">Authored contrast · held-out family {esc(row['family'])}</p>
        <div class="probe-text"><strong>Learner request</strong><p>{esc(row['prompt'])}</p></div>
        <div class="probe-text"><strong>Tutor response</strong><p>{esc(row['response'])}</p></div>
        <div class="score-strip"><p>Authored target<b>{label}</b></p><p>SAE score<b>{row['scores']['sae']:.3f}</b></p><p>Decision at <span data-decision-threshold>{threshold:.2f}</span><b data-probe-verdict class="{'mismatch' if prediction != row['label'] else ''}">{diagnosis}</b></p></div>
        <p class="source-unit">Scores estimate the probability of a premature answer. The vertical line marks the SAE decision threshold.</p>{bars}
        <p class="review-note"><strong>Recorded diagnosis at {threshold:.2f}:</strong> {esc(row.get('diagnosis', ''))}</p>
        {contributions}
        {details('Inspect record and measured values', row)}</section>''')
    feature_rows = ''.join(f'<tr><th scope="row">{esc(f["feature_id"])}</th><td>{f["weight"]:+.6f}</td></tr>' for f in data.get('features', []))
    features = f'''<details><summary>Inspect the fitted feature weights</summary><p>These are coefficients in the small classifier. A positive coefficient raises its score when that scaled coordinate increases. Feature IDs identify dictionary coordinates.</p><div class="table-scroll"><table><thead><tr><th>SAE coordinate</th><th>Probe coefficient</th></tr></thead><tbody>{feature_rows}</tbody></table></div>{esc(measurement.get('feature_note', ''))}</details>'''
    return f'''<section class="inspector" id="probe-workbench" aria-label="Inspect measured probe decisions">
    <div class="inspector-tools js-only"><label for="probe-choice">Choose a held-out example<select id="probe-choice">{''.join(options)}</select></label><a href="probe-examples.json" download>Download measured records ↓</a></div>
    {''.join(panels)}<div class="threshold-workbench js-only"><div style="width:100%"><div class="threshold-heading"><label for="probe-threshold">Try a decision threshold: <output id="threshold-value" for="probe-threshold">{threshold:.2f}</output></label><button id="reset-threshold" type="button">Reset recorded threshold</button></div>
    <input id="probe-threshold" type="range" min="0" max="1" step="0.01" value="{threshold}" aria-describedby="threshold-help">
    <p class="threshold-explanation" id="threshold-help">Changing this threshold reclassifies the same measured scores. It runs no model and changes no recorded result. Original threshold: {threshold:.2f}.</p>
    <div class="confusion" id="probe-confusion" aria-live="polite"></div></div></div>
    {features}{details('Inspect the measurement recipe', measurement)}
    <p class="print-context">The web report lets you inspect every held-out record and move the decision threshold across the fixed scores. This print view includes selected worked examples.</p>
    </section>''' + data_script('probe-inspection-data', data)
