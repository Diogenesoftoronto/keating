"""Offline additive calibrated-logit attribution of saved signed-TopK mean features."""
import argparse
import hashlib
import html
import json
import math
from pathlib import Path

from observer_core import canonical, digest
from observer_report import number, read_file, read_json, require, validate_manifest, validate_rows
from native_training import native_hash

ROOT = Path(__file__).resolve().parents[2]
MEASURED = ROOT / '.keating/native-learning/premature-answer-native-measurement-v1'
HANDOFF = ROOT / '.keating/native-learning/model-stage-zero/native-hint-brief-capture-v1/reward-handoff-v1'
NOTE = ('One measured response only. Token values are additive calibrated-logit contributions, '
        'not token probabilities or causal localization. Hidden states include preceding context. '
        'Cross-family predictive performance, localization accuracy and learning effects are independent questions; '
        'this inspection establishes none of them.')


def inspect(artifact, report, card, projection, approved_card_hash, record_id=None):
    """Validate saved evidence, then decompose the exported scorer without refitting."""
    require(card.get('card_hash') == approved_card_hash == native_hash({k: v for k, v in card.items() if k != 'card_hash'}), 'Card hash mismatch')
    baseline, manifest = report['baselines']['sae'], artifact['manifest']
    model, feature_card, pin = baseline['model'], baseline['feature_card'], card['probe']
    require(pin.get('mode') == 'sae', 'SAE probe required')
    for key, value in [('report', report), ('model', model), ('feature_card', feature_card), ('observer_manifest', report['observer_manifest'])]:
        require(pin[key + '_sha256'] == digest(value), 'Probe/card hash mismatch: ' + key)
    require(feature_card['observer_manifest_sha256'] == pin['observer_manifest_sha256'], 'Feature card manifest mismatch')
    require(report['target'] == feature_card['target'] and report['boundary'] == feature_card['boundary'], 'Feature card target/boundary mismatch')
    validate_manifest(manifest)
    validate_manifest(report['observer_manifest'])
    actual, fitted = dict(manifest), dict(report['observer_manifest'])
    exporter = 'layer_selection_implementation_sha256'
    if actual.get(exporter) != fitted.get(exporter):
        require(actual.get(exporter) == card.get('measurement_layer_selection_sha256'), 'Exporter revision not approved')
        actual.pop(exporter, None)
        fitted.pop(exporter, None)
    require(actual == fitted, 'Observer basis mismatch')
    require(artifact['manifest_sha256'] == digest(manifest) and artifact['input_sha256'] == digest(projection), 'Manifest/projection hash mismatch')
    try:
        validate_rows(artifact, projection)  # Exact source view, record hash, offsets, indices and every pooled coordinate.
    except (KeyError, TypeError, IndexError) as exc:
        raise ValueError('Missing or malformed token/source evidence') from exc
    rows = [r for r in artifact['rows'] if record_id is None or r['record_id'] == record_id]
    require(len(rows) == 1, 'Select exactly one measured record')
    row = rows[0]
    require(row['boundary'] == feature_card['boundary'], 'Probe boundary mismatch')
    require(all(feature_card[k] == manifest[k] for k in ('layer', 'module', 'pooling')), 'Feature card basis mismatch')
    beta, scale = model['coefficients'], model['preprocessing']['scale']
    require(model['classes'] == [0, 1] and model['preprocessing'].get('mean') is None, 'Only uncentered binary SAE probes supported')
    require(len(beta) == len(scale) == row['sae_width'] and all(number(x) for x in beta)
            and all(number(x) and x > 0 for x in scale), 'Invalid coefficients/scales')
    intercept, calibration, calibration_bias = (model[k] for k in ('intercept', 'calibration_coefficient', 'calibration_intercept'))
    require(all(number(x) for x in (intercept, calibration, calibration_bias)), 'Nonfinite calibrated model')
    n, tokens = len(row['sparse_tokens']), []
    for token in row['sparse_tokens']:
        terms = [{'coordinate': j, 'value': value, 'coefficient': beta[j], 'scale': scale[j],
                  'contribution': value * beta[j] / scale[j] * calibration / n}
                 for j, value in zip(token['indices'], token['values']) if beta[j] != 0]
        start, end = token['character_offsets']
        tokens.append({'token_index': token['token_index'], 'token_id': row['input_token_ids'][token['token_index']],
                       'start': start, 'end': end, 'text': row['text'][start:end], 'terms': terms,
                       'contribution': math.fsum(t['contribution'] for t in terms)})
    bias = intercept * calibration + calibration_bias
    total = math.fsum(t['contribution'] for t in tokens)
    pooled_logit = (math.fsum(value * beta[int(j)] / scale[int(j)] for j, value in row['sae'].items()) + intercept) * calibration + calibration_bias
    require(math.isfinite(pooled_logit) and math.isclose(bias + total, pooled_logit, rel_tol=1e-10, abs_tol=1e-12), 'Logit conservation failed')
    probability = 1 / (1 + math.exp(-pooled_logit)) if pooled_logit >= 0 else math.exp(pooled_logit) / (1 + math.exp(pooled_logit))
    coordinates = [{'coordinate': j, 'coefficient': b, 'scale': scale[j], 'pooled_value': row['sae'].get(str(j), 0),
                    'contribution': row['sae'].get(str(j), 0) * b / scale[j] * calibration} for j, b in enumerate(beta) if b != 0]
    return {'schema_version': 1, 'kind': 'additive-calibrated-logit-spans/v1', 'record_id': row['record_id'],
            'family_id': row['family_id'], 'boundary': row['boundary'], 'target': report['target'], 'scope_note': NOTE,
            'text': row['text'], 'view': row['view'], 'selected_tokens': n, 'tokens': tokens, 'coordinates': coordinates,
            'classifier_intercept': intercept, 'calibration_coefficient': calibration, 'calibration_intercept': calibration_bias,
            'bias': bias, 'contribution_sum': total, 'pooled_logit': pooled_logit, 'pooled_probability': probability,
            'conservation_error': bias + total - pooled_logit,
            'pins': {'artifact_sha256': digest(artifact), 'projection_sha256': digest(projection), 'card_hash': approved_card_hash,
                     'report_sha256': digest(report), 'model_sha256': digest(model), 'feature_card_sha256': digest(feature_card),
                     'measurement_manifest_sha256': digest(manifest), 'fitted_manifest_sha256': digest(report['observer_manifest'])}}


def render(result):
    esc, tokens = html.escape, result['tokens']
    cuts = sorted({0, len(result['text']), *(p for t in tokens for p in (t['start'], t['end']))})
    peak = max((abs(t['contribution']) for t in tokens), default=0) or 1
    pieces = []
    for start, end in zip(cuts, cuts[1:]):
        covering = [t for t in tokens if t['start'] <= start and end <= t['end']]
        value = math.fsum(t['contribution'] for t in covering)
        label = '; '.join(f"token {t['token_index']}: {t['contribution']:+.8f} logit" for t in covering)
        color = '0,114,178' if value < 0 else '190,82,26'
        opacity = min(.32, .06 + .26 * abs(value) / peak) if value else 0
        chunk = esc(result['text'][start:end])
        pieces.append(f'<mark title="{esc(label)}" style="background:rgba({color},{opacity:.3f})">{chunk}</mark>' if covering else chunk)
    coordinate_rows = ''.join(f"<tr><td>{c['coordinate']}</td><td>{c['coefficient']:+.8f}</td><td>{c['scale']:.8f}</td><td>{c['pooled_value']:.8f}</td><td>{c['contribution']:+.8f}</td></tr>" for c in sorted(result['coordinates'], key=lambda c: -abs(c['contribution'])))
    token_rows = ''.join(f"<tr><td>{t['token_index']}</td><td>{t['start']}:{t['end']}</td><td><code>{esc(t['text'])}</code></td><td>{t['contribution']:+.8f}</td></tr>" for t in tokens)
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Probe span inspection</title>
<style>body{{margin:0;background:#f9faf8;color:#142b22;font:16px/1.6 system-ui,sans-serif}}main{{max-width:980px;margin:auto;padding:36px 24px 64px}}h1{{font-size:2rem;line-height:1.15;margin:8px 0 18px}}h2{{font-size:1.2rem;margin-top:34px}}p{{max-width:75ch}}.meta{{font-size:.83rem;overflow-wrap:anywhere}}.equation{{padding:18px 0;border-block:2px solid #306b4a;display:flex;flex-wrap:wrap;gap:24px}}.equation b{{display:block;font-size:1.55rem}}.source{{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:24px;font:1.1rem/1.9 system-ui; border-left:3px solid #306b4a}}mark{{color:inherit;padding:0;border-radius:2px}}.legend{{font-size:.88rem}}.blue{{color:#005b91}}.orange{{color:#994010}}.scroll{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:.85rem;font-variant-numeric:tabular-nums}}th,td{{text-align:left;padding:8px 12px;border-bottom:1px solid #d5dfd9}}th{{background:#eaf0eb}}td code{{white-space:pre-wrap}}summary{{cursor:pointer;padding:12px 0;font-weight:600}}summary:focus-visible{{outline:2px solid #306b4a}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem}}@media(max-width:600px){{main{{padding:24px 16px}}.source{{padding:16px}}h1{{font-size:1.65rem}}}}</style>
<main><p class="meta">Keating · saved SAE probe · {result['selected_tokens']} selected tokens</p><h1>Where the probe score accumulates</h1>
<p>{esc(result['scope_note'])}</p><p class="meta">Target: {esc(result['target'])} · Family: {esc(result['family_id'])}<br>{esc(result['record_id'])}</p>
<div class="equation"><span>Calibrated bias<b>{result['bias']:+.8f}</b></span><span>+ Token contributions<b>{result['contribution_sum']:+.8f}</b></span><span>= Pooled logit<b>{result['pooled_logit']:+.8f}</b></span><span>Pooled probability<b>{result['pooled_probability']:.6f}</b></span></div>
<h2>Exact observed text</h2><p class="legend"><span class="blue">Blue: lowers the logit</span> · <span class="orange">Orange: raises the logit</span> · Uncolored context was not pooled. Hover for token values; the table below provides the same numbers.</p>
<div class="source">{''.join(pieces)}</div><p class="meta">Character offsets index Unicode code points in the full source view. Overlapping token spans share color; numeric attribution remains per token. Color strength is relative within this response.</p>
<h2>Conservation</h2><p>Bias = classifier intercept × calibration coefficient + calibration intercept.<br>Token contribution = Σ(value × coefficient ÷ scale) × calibration coefficient ÷ {result['selected_tokens']}.</p>
<p class="meta">Classifier intercept {result['classifier_intercept']:+.12f} · Calibration coefficient {result['calibration_coefficient']:+.12f} · Calibration intercept {result['calibration_intercept']:+.12f}<br>Reconstruction error: {result['conservation_error']:.3g}</p>
<h2>Nonzero probe coefficients</h2><div class="scroll"><table><thead><tr><th>SAE coordinate</th><th>Coefficient</th><th>Scale</th><th>Pooled value</th><th>Logit contribution</th></tr></thead><tbody>{coordinate_rows}</tbody></table></div>
<details><summary>Inspect every token contribution</summary><div class="scroll"><table><thead><tr><th>Token index</th><th>Offsets</th><th>Exact text</th><th>Logit contribution</th></tr></thead><tbody>{token_rows}</tbody></table></div></details>
<details><summary>Inspect source bindings</summary><pre>{esc(json.dumps(result['pins'], indent=2))}</pre></details><p><a href="example.json">Open the complete numeric evidence</a></p></main></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--features', type=Path, default=MEASURED / 'features.local.json')
    parser.add_argument('--report', type=Path, default=ROOT / '.keating/native-learning/premature-answer-execution-v1/probe-report.json')
    parser.add_argument('--card', type=Path, default=HANDOFF / 'reward-card.json')
    parser.add_argument('--measurement-plan', type=Path, default=HANDOFF / 'measurement-plan.json')
    parser.add_argument('--audit', type=Path, default=MEASURED / 'reward-audit.json')
    parser.add_argument('--record-id')
    parser.add_argument('--output', type=Path, default=ROOT / '.keating/native-learning/probe-span-inspection-v1')
    args = parser.parse_args()
    try:
        sources = {k: read_json(read_file(getattr(args, k))) for k in ('features', 'report', 'card', 'measurement_plan', 'audit')}
        plan, audit = sources['measurement_plan'], sources['audit']
        require(plan['plan_hash'] == native_hash({k: v for k, v in plan.items() if k != 'plan_hash'}) == audit['measurement_plan_hash'], 'Measurement plan hash mismatch')
        require(audit['audit_hash'] == native_hash({k: v for k, v in audit.items() if k != 'audit_hash'}), 'Audit hash mismatch')
        result = inspect(sources['features'], sources['report'], sources['card'], plan['projection'], audit['card_hash'], args.record_id)
        matches = [a for a in audit['actions'] if a['record_id'] == result['record_id'] and a['probability'] is not None]
        require(len(matches) == 1 and math.isclose(matches[0]['probability'], result['pooled_probability'], rel_tol=1e-10, abs_tol=1e-12), 'Saved prediction mismatch')
        result['saved_probability'] = matches[0]['probability']
        result['pins'].update(source_files={k: {'path': str(getattr(args, k)), 'sha256': hashlib.sha256(read_file(getattr(args, k))).hexdigest()} for k in sources})
        args.output.mkdir(parents=True, exist_ok=False)
        (args.output / 'example.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
        (args.output / 'index.html').write_text(render(result))
        print(canonical({k: result[k] for k in ('selected_tokens', 'bias', 'contribution_sum', 'pooled_logit', 'pooled_probability', 'conservation_error')}))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, f'probe_spans: {exc}\n')


if __name__ == '__main__':
    main()
