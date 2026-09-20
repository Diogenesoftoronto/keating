"""Static, accessible research workbench over allowlisted saved evidence."""
import html
import json


def frontier_workbench(data):
    esc = html.escape
    episode, activity = data['episode'], data['activity']
    question = activity['document']['nodes'][0]
    options = ''.join(f'<label><input type="radio" name="source-choice" value="{esc(o["id"])}"><span><b>{esc(o["id"])}</b> {esc(o["label"])}</span></label>' for o in question['choices'])
    source_options = ' · '.join(f'{o["id"]}: {o["label"]}' for o in question['choices'])
    buttons = ''.join(f'<button type="button" data-response="{i}" aria-pressed="{"true" if i == 2 else "false"}">Turn {r["step_index"]+1}</button>' for i, r in enumerate(episode['responses']))
    payload = json.dumps(data, ensure_ascii=False).replace('<', '\\u003c')
    return f'''<section class="frontier-workbench" aria-label="Inspect source adaptation and benchmark responses">
<h3>From a described screen to an answerable activity</h3>
<div class="source-pair"><div><p class="view-label">Original task and choices</p><p>{esc(question['prompt'])}</p><p>{esc(source_options)}</p>
<p class="small">Exact task and choices recovered from the pre-decision source. <a href="{activity['source_url']}">{esc(activity['attribution'])}</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p></div>
<form id="source-preview"><p class="view-label">Native unanswered question</p><fieldset><legend>{esc(question['prompt'])}</legend>{options}</fieldset><button type="submit" disabled>Try this choice</button><p id="source-preview-result" role="status">Choose an option. This report preview stays local.</p></form></div>
<p class="small">Same wording, same options; a fresh answer is now a structured learner action. The real Pi canary submitted A and received an actual delivery receipt plus a tutor continuation. The historical answer is not replayed as a new event, and the learner view contains no answer key.</p>
<details><summary>Inspect the canonical OpenUI document and recorded checks</summary><pre>{esc(json.dumps({'document': activity['document'], 'checks': activity['runtime_proof'], 'source': activity['source']}, indent=2))}</pre></details>
<h3>A completed episode still has things to teach us</h3><p>Historical v4.0 · F+S checkpoint · six actual learner turns · independent model review: <strong>4/8</strong>. Start at Turn 3: the tutor gives the answer while the learner still wants a hint.</p>
<div class="response-controls" role="group" aria-label="Choose a recorded turn">{buttons}</div>
<div class="diagnostic-columns"><div><p class="view-label">Learner's current request</p><p id="frontier-learner"></p><p class="view-label">What the reviewer found</p><div id="frontier-review" aria-live="polite"></div><p class="small">Probe score: <strong>unknown</strong>. No v4 activations have been extracted.</p></div>
<div><p class="view-label">Exact new tutor response</p><pre id="frontier-response"></pre><p class="small">Highlighted text is the reviewer's exact evidence. Emitted OpenUI source is shown as text; valid browser rendering was not measured in this run.</p></div></div>
<details><summary>Inspect the selected response binding</summary><pre id="frontier-binding"></pre></details>
<p class="small"><a href="frontier-example.json">Download the allowlisted episode and activity</a> · <a href="benchmark-diagnostics.html">Open the full response diagnostic record</a> · <a href="probe-spans.html">Inspect an actual measured probe span</a></p>
<script type="application/json" id="frontier-data">{payload}</script></section>'''


def probe_page_body(result):
    # Use the rigorously validated arithmetic renderer, then theme the fragment
    # inside the same report shell. No inference or scoring occurs in the browser.
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'training'))
    from probe_spans import render
    full = render(result)
    body = full.split('<main>', 1)[1].split('</main>', 1)[0]
    body = body.replace('<p>' + html.escape(result['scope_note']) + '</p>',
        '<p>Follow the 49 measured token positions that produce this response score. '
        'Blue lowers the score and orange raises it; the fitted bias supplies the starting point. '
        'The numbers below add up exactly to the saved result.</p>')
    body = body.replace('<br>' + html.escape(result['record_id']), '')
    body += '<h2>Limits of this view</h2><p>' + html.escape(result['scope_note']) + '</p>'
    body += '<p>Read the <a href="index.html#term-logit">logit</a>, <a href="index.html#term-span">span contribution</a> and <a href="index.html#term-probe">probe</a> definitions.</p>'
    return '<div class="span-inspector">' + body.replace('href="example.json"', 'href="probe-spans.json"') + '</div>'


def diagnostic_page_body(result):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'training'))
    from benchmark_diagnostics import render_html
    full = render_html(result)
    return '<div class="diagnostic-record">' + full.split('<main>', 1)[1].split('</main>', 1)[0] + '</div>'
