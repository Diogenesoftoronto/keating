"""Publish only authored benchmark dialogue and validated measurements, never raw requests."""
import hashlib
import json
import math
import sys
from pathlib import Path

import typer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/training'))
import benchmark_v3 as benchmark

app = typer.Typer(add_completion=False)


def read(path):
    return json.loads(Path(path).read_text())


def finite(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def episode_usage(result, pricing):
    sessions = {}
    for step in result.get('steps', []):
        sid = step.get('state', {}).get('sessionId')
        if sid:
            sessions[sid] = step.get('messages', [])
    messages = [m for history in sessions.values() for m in history if m.get('role') == 'assistant']
    usage = [m.get('usage') or {} for m in messages]
    valid = bool(usage) and all(m.get('stopReason') not in ('error', 'aborted') for m in messages)
    totals = {key: sum(u[key] for u in usage) if valid and all(finite(u.get(key)) for u in usage) else None
              for key in ('input', 'output', 'cacheRead', 'cacheWrite')}
    rate_keys = ('input_per_million', 'output_per_million', 'cached_input_per_million')
    cost = None
    # Pi input excludes cacheRead. Cache writes have no advertised tariff here.
    if all(finite(totals[k]) for k in totals) and totals['cacheWrite'] == 0 and all(finite(pricing.get(k)) for k in rate_keys):
        cost = (totals['input'] * pricing[rate_keys[0]] + totals['output'] * pricing[rate_keys[1]]
                + totals['cacheRead'] * pricing[rate_keys[2]]) / 1e6
    uncached = None
    if all(finite(totals[k]) for k in totals) and all(finite(pricing.get(k)) for k in rate_keys[:2]):
        uncached = ((totals['input'] + totals['cacheRead'] + totals['cacheWrite']) * pricing[rate_keys[0]]
                    + totals['output'] * pricing[rate_keys[1]]) / 1e6
    return {'input_tokens': totals['input'], 'output_tokens': totals['output'], 'cached_input_tokens': totals['cacheRead'],
            'cost_usd': cost, 'estimated_uncached_cost_usd': uncached,
            'cost_note': 'Provider-listed tariff applied to Pi reported uncached input, cache reads and output; estimate, not invoice.'}


def visible_message(message, index):
    content = message.get('content', [])
    if isinstance(content, str):
        content = [{'type': 'text', 'text': content}]
    blocks = []
    for block in content:
        if block.get('type') == 'text':
            blocks.append({'type': 'text', 'text': block.get('text', '')})
        elif block.get('type') == 'toolCall':
            blocks.append({k: block[k] for k in ('type', 'name', 'arguments') if k in block})
    return {'index': index, 'role': message.get('role'), 'content': blocks,
            'tool_name': message.get('toolName'), 'is_error': message.get('isError', False)}


def public_trace(result):
    steps = []
    for step in result.get('steps', []):
        files = [f for f in step.get('files', []) if f['path'].endswith('learner-memory.json')]
        steps.append({'index': step['index'], 'kind': step['kind'], 'status': step['status'],
                      'error_code': step.get('error_code'),
                      'messages': [visible_message(m, i) for i, m in enumerate(step.get('messages', []))
                                   if i >= step.get('message_start_index', 0) and step['kind'] in ('message', 'ui_action')],
                      'learner_memory': [read_memory(f['content']) for f in files],
                      'learner_state': [read_memory(f['content']) for f in step.get('files', [])
                                        if f['path'].endswith('/learner.json')]})
    prompts = []
    for request in result.get('requests', []):
        for message in request.get('data', {}).get('payload', {}).get('messages', []):
            if message.get('role') == 'system' and isinstance(message.get('content'), str):
                text = message['content']
                sha = hashlib.sha256(text.encode()).hexdigest()
                if not any(p['sha256'] == sha for p in prompts):
                    prompts.append({'sha256': sha, 'text': text})
    return {'steps': steps, 'system_prompts': prompts,
            'runtime_unchanged': result.get('source_provenance', {}).get('unchanged_at_end')}


def truncated_calls(result):
    return sum(m.get('stopReason') == 'length' for step in result.get('steps', [])
               if step['kind'] in ('message', 'ui_action')
               for m in step.get('messages', [])[step.get('message_start_index', 0):]
               if m.get('role') == 'assistant')


def read_memory(content):
    try:
        return json.loads(content)
    except ValueError:
        return {'status': 'invalid_saved_json'}


@app.command()
def main(cohort: list[Path] = typer.Option(...), output: Path = typer.Option(...)):
    suite = ROOT / 'scripts/training/benchmarks/teaching-v3-profiles'
    cases = benchmark.load_cases(suite / 'cases.json')
    case_map = {c['id']: c for c in cases}
    metadata = {}
    native_models = {}
    for root in cohort:
        if (root / 'provider-models.json').exists():
            metadata.update({m['id']: m for m in read(root / 'provider-models.json')['data']})
        if (root / 'actors.json').exists():
            for actor in read(root / 'actors.json').get('actors', []):
                if actor.get('native_settings'):
                    native_models[actor['model']] = actor['native_settings']
    models = {}
    interruptions = []
    superseded_attempts = []
    review_costs = []
    for root in cohort:
        if (root / 'interruption.json').exists():
            interruptions.extend(read(root / 'interruption.json')['attempts'])
        for path in sorted(root.rglob('plan.json')):
            plan = read(path)
            if plan.get('track') != 'fixed-cli-harness':
                continue
            if any(case.get('id') not in case_map or case != case_map[case['id']] for case in plan['cases']):
                raise ValueError('Cannot pool changed benchmark cases; subsets must match every complete case object exactly')
            mid = plan['model']
            meta = metadata.get(mid, {}).get('metadata', {})
            transport_controls = {k: plan.get('transport', {}).get(k) for k in ('thinking', 'modelMetadata')}
            model = models.setdefault(mid, {'id': mid, 'model': mid, 'label': meta.get('display_name', mid),
                                          'provider': plan['provider'], 'served_by': plan['provider'], 'rows': [],
                                          'rates': meta.get('pricing', {}), 'provider_reasoning_metadata': meta.get('reasoning', {}),
                                          'runtime_driver_sha256': plan.get('driver_sha256'),
                                          'transport_controls': transport_controls,
                                          'settings_note': 'Pi requests thinking off and at most 3000 output tokens per call. The captured custom endpoint payload does not send reasoning_effort; provider defaults may still enable reasoning.'})
            if model['runtime_driver_sha256'] != plan.get('driver_sha256') or model['transport_controls'] != transport_controls:
                raise ValueError('Cannot pool changed runtime drivers or transport controls within one model')
            hashes = model.setdefault('input_case_file_hashes', [])
            if plan['cases_sha256'] not in hashes:
                hashes.append(plan['cases_sha256'])
            native = native_models.get(mid)
            if native:
                model.update(model=native['base_model'], served_by='Thinking Machines Tinker', native_settings=native,
                             label={'inkling-small-base': 'Inkling Small', 'nemotron-lightning': 'Nemotron 3.5 Lightning', 'qwen3-8-27b': 'Qwen 3.8 27B'}.get(mid, mid),
                             rates={'input_per_million': native['input_rate'], 'output_per_million': native['output_rate'],
                                    'source': 'Earlier 2026-09-07 tariff snapshot; already discounted. Cache unmeasured.'},
                             settings_note=f"Native renderer {native['renderer']}; Inkling effort {native.get('effort')}. Buffered SSE; temperature defaults to 1, top_p to 1, no fixed seed. Output cap 3000. These controls differ from the endpoint cohort.")
            summary = read(path.parent / 'summary.json') if (path.parent / 'summary.json').exists() else {}
            elapsed = {r['case_id']: r.get('elapsed_seconds') for r in summary.get('rows', [])}
            native_usage_path = path.parent / 'native-usage.json'
            native_usage = {r['case_id']: r for r in read(native_usage_path)['cases']} if native_usage_path.exists() else {}
            for case in plan['cases']:
                cid = case['id']
                result_path = path.parent / (cid + '.result.json')
                if not result_path.exists():
                    continue
                previous = next((r for r in model['rows'] if r['case_id'] == cid), None)
                if previous:
                    if previous['status'] != 'failed' or previous.get('error_code') != 'harness_provider_failure':
                        raise ValueError('Only provider-failed attempts may be superseded; never select among completed scores')
                    superseded_attempts.append({'model': mid, **{k: previous.get(k) for k in
                                                ('case_id', 'status', 'error_code', 'source_sha256', 'cost_usd', 'output_tokens')}})
                    model['rows'].remove(previous)
                result = read(result_path)
                row = {'case_id': cid, 'category': case_map[cid]['category'], 'status': result.get('status'),
                       'error_code': result.get('error_code'), 'quality': None, 'quality_status': 'unreviewed',
                       'contract_passed': None, 'latency_seconds': elapsed.get(cid),
                       'provider_calls': len(result.get('requests', [])), **episode_usage(result, model['rates']),
                       'trace': public_trace(result), 'source_sha256': hashlib.sha256(result_path.read_bytes()).hexdigest()}
                row['truncated_calls'] = truncated_calls(result)
                row['delivery_status'] = 'output_limited' if row['truncated_calls'] else result.get('status')
                if native:
                    row['estimated_uncached_cost_usd'] = ((row['input_tokens'] * native['input_rate'] + row['output_tokens'] * native['output_rate']) / 1e6
                                                         if finite(row['input_tokens']) and finite(row['output_tokens']) else None)
                    row.update(cost_usd=None, cached_input_tokens=None,
                               cost_note='Cache hits are unmeasured. Uncached tariff estimate is separate, not included in cache-adjusted cost comparisons.')
                    if cid in native_usage:
                        receipt = native_usage[cid]
                        if receipt['result_sha256'] != benchmark.b.digest(benchmark.b.canonical(result)):
                            raise ValueError('Native usage receipt does not bind this exact episode')
                        row['native_usage'] = {k: v for k, v in receipt.items() if k != 'calls'}
                        if receipt['coverage']['unknown_receipts'] == 0:
                            for key in ('input_tokens', 'output_tokens', 'estimated_uncached_cost_usd'):
                                row[key] = receipt[key]
                # Old interrupted batch lacks a summary. Wall time can be recovered only from an explicit receipt.
                ui_path = path.parent / (cid + '.tui-openui.json')
                if ui_path.exists():
                    ui = read(ui_path)
                    row['ui_documents'] = [{'step': s['index'], **d} for s in ui.get('steps', [])
                                           for a in s.get('assistant_outputs', []) for d in a.get('documents', [])]
                review_path = path.parent / 'api-reviews' / (cid + '.json')
                if review_path.exists():
                    review = read(review_path)
                    score = benchmark.validate_review(case, result, review)
                    row.update(quality=None if row['truncated_calls'] else score,
                               quality_status='output_limited' if row['truncated_calls'] else 'reviewed', review=review)
                    row.update(quality_api=row['quality'], quality_source='api', api_review=review)
                supplemental_path = path.parent / 'agent-reviews' / (cid + '.json')
                if supplemental_path.exists():
                    supplemental = read(supplemental_path)
                    score = benchmark.validate_review(case, result, supplemental)
                    row.update(quality_supplemental=None if row['truncated_calls'] else score, supplemental_review=supplemental)
                    if row.get('quality') is None and not row['truncated_calls']:
                        row.update(quality=score, quality_status='reviewed', quality_source='supplemental', review=supplemental)
                usage_path = path.parent / 'api-reviews' / (cid + '.usage.json')
                if usage_path.exists():
                    review_costs.append(read(usage_path).get('estimated_cost_usd'))
                model['rows'].append(row)
    for model in models.values():
        model['rows'].sort(key=lambda row: list(case_map).index(row['case_id']))
        present = {row['case_id'] for row in model['rows']}
        for cid, case in case_map.items():
            if cid not in present:
                model['rows'].append({'case_id': cid, 'category': case['category'], 'status': 'pending', 'quality': None,
                                      'contract_passed': None, 'cost_usd': None, 'output_tokens': None, 'latency_seconds': None})
    data = {'version': '3.2.0', 'exported_at': benchmark.b.now(), 'case_count': len(cases), 'cases': cases, 'models': list(models.values()),
            'quality_available': any(r.get('quality') is not None for m in models.values() for r in m['rows']),
            'quality_label': 'Independent AI rubric score', 'preferred_pareto_score': 'quality',
            'interrupted_attempts': interruptions, 'review_known_cost_usd': sum(c for c in review_costs if finite(c)),
            'superseded_provider_attempts': superseded_attempts,
            'review_unknown_cost_calls': sum(c is None for c in review_costs),
            'method_note': 'One recorded episode per model and case through the frozen real Keating CLI. Only provider-failed or host-interrupted attempts may be rerun; complete answers are never selected by score. Public development suite; no measured human learning. Kimi reviews other families; DeepSeek reviews Kimi. Missing API reviews may have separately attributed Codex agent reviews. None are human-calibrated or cross-calibrated, and differing reviewer proportions can affect rankings. Output-limited episodes are excluded from semantic aggregates. Interrupted attempts and missing measurements remain separate.'}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'models': len(models), 'collected': sum(r['status'] != 'pending' for m in models.values() for r in m['rows']),
                      'reviewed': sum(r.get('quality_status') == 'reviewed' for m in models.values() for r in m['rows'])}))


if __name__ == '__main__':
    app()
