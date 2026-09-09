#!/usr/bin/env python3
"""Export frozen authored cases and allowlisted episode evidence, never private run config."""
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import typer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/training'))
import benchmark as b
import benchmark_judge as judge

app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)
read = b.read_json
DIGEST = re.compile(r'^[0-9a-f]{64}$')
PRIVATE_TEXT = re.compile(r'tinker://|did:(?:plc|web):|/tmp/keating-[^\s"\\]*credential|/tmp/keating-cross-provider-|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._-]{16,}', re.I)
PRIVATE_KEYS = {'api_key', 'apikey', 'authorization', 'key_file', 'api_key_env', 'owner_did', 'sampler_path', 'training_state_path', 'access_token', 'refresh_token'}


def require(value, message):
    if not value:
        raise ValueError(message)


def number(value, integer=False):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0 and (not integer or type(value) is int)


def metric(value, integer=False):
    return value if number(value, integer) else None


def public_guard(value):
    """Fail closed on recognizable credentials/private identity; do not alter evidence quotes."""
    if isinstance(value, dict):
        require(not any(str(key).lower() in PRIVATE_KEYS for key in value), 'Private field in public benchmark artifact')
        for item in value.values():
            public_guard(item)
    elif isinstance(value, list):
        for item in value:
            public_guard(item)
    elif isinstance(value, str):
        require(not PRIVATE_TEXT.search(value), 'Private identifier or credential pattern in public benchmark artifact')


def safe_error(error):
    if not isinstance(error, dict):
        return None
    if isinstance(error.get('error'), dict):
        error = error['error']
    # Provider message/body/URL can contain credentials. Publish only bounded classifications.
    return {key: value for key, value in error.items() if key in ('kind', 'type', 'stage', 'status', 'status_code', 'provider_code', 'provider_type')
            and (type(value) is int or isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_. -]{1,80}', value))}


def call_receipt(call):
    usage = call.get('usage') or {}
    result = {'wall_seconds': metric(call.get('wall_seconds')),
              'usage': {key: metric(usage.get(key), True) for key in ('prompt_tokens', 'completion_tokens', 'cached_input_tokens', 'reasoning_tokens')},
              'cost_usd': metric(call.get('cost_usd')), 'error': safe_error(call.get('error')),
              'finish_reason': (call.get('response') or {}).get('finish_reason')}
    request_hash = call.get('request_sha256')
    if isinstance(request_hash, str) and DIGEST.fullmatch(request_hash):
        result['request_sha256'] = request_hash
    return result


def call_totals(calls):
    def total(values):
        return sum(values) if values and all(value is not None for value in values) else None
    costs = [call['cost_usd'] for call in calls]
    return {'input_tokens': total([call['usage']['prompt_tokens'] for call in calls]),
            'output_tokens': total([call['usage']['completion_tokens'] for call in calls]),
            'cached_input_tokens': total([call['usage']['cached_input_tokens'] for call in calls]),
            'reasoning_tokens': total([call['usage']['reasoning_tokens'] for call in calls]),
            'provider_seconds': total([call['wall_seconds'] for call in calls]),
            'cost_usd': total(costs), 'known_cost_usd': sum(value for value in costs if value is not None)}


def validate_review(review, case, transcript):
    require(review.get('status') == 'reviewed', 'Review is not complete')
    require(review.get('case_id') == case['id'], 'Review case differs')
    require(review.get('transcript_sha256') == b.digest(b.canonical(transcript)), 'Review transcript differs')
    require(review.get('case_sha256') == b.digest(b.canonical(judge.material(case, transcript)['case'])), 'Review case context differs')
    require(review.get('judge_prompt_sha256') == b.digest(judge.SYSTEM), 'Review prompt differs')
    require(review.get('judge_settings') == judge.SETTINGS, 'Review settings differ')
    require(review.get('judge_settings_sha256') == b.digest(b.canonical(judge.SETTINGS)), 'Review settings hash differs')
    return judge.validate_ratings(case, transcript, {'ratings': review.get('ratings')})


def calibration_gate(control, suite):
    if control.get('passed') is not True or control.get('status') != 'complete':
        return False
    fixture_path = suite / 'judge-calibration.json'
    require(control.get('calibration_sha256') == b.digest(fixture_path.read_bytes()), 'Calibration controls differ')
    fixtures = {pair['id']: pair for pair in read(fixture_path)['pairs']}
    pairs = control.get('pairs', [])
    require(len(pairs) == len(fixtures) and {pair['id'] for pair in pairs} == set(fixtures), 'Calibration coverage differs')
    for pair in pairs:
        source = fixtures[pair['id']]
        scores = {}
        for side in ('positive', 'negative'):
            review = pair['reviews'][side]
            require(review.get('judge_model') == control.get('judge_model'), 'Calibration judge differs')
            scores[side] = {item['dimension']: item['score'] for item in validate_review(review, source['case'], source[side])}
        require(all(scores['positive'][key] is not None and scores['negative'][key] is not None
                    and scores['positive'][key] > scores['negative'][key] for key in source['contrast_dimensions']), 'Calibration contrast failed')
    return True


def normalize_review(review, case, transcript, calibrated, control):
    if not review:
        return {}, None
    fields = ('status', 'judge_model', 'judge_prompt_version', 'judge_prompt_sha256', 'judge_settings',
              'judge_settings_sha256', 'case_sha256', 'transcript_sha256', 'bias')
    public = {key: copy.deepcopy(review[key]) for key in fields if key in review}
    public['cost_usd'] = metric(review.get('cost_usd'))
    public['ratings'] = []
    try:
        ratings = validate_review(review, case, transcript)
        require(not calibrated or review.get('judge_model') == control.get('judge_model'), 'Review and calibration models differ')
        public['ratings'] = [{key: copy.deepcopy(item[key]) for key in ('dimension', 'score', 'reason', 'support', 'uncertainty', 'evidence') if key in item} for item in ratings]
    except (ValueError, TypeError, KeyError, AttributeError):
        public.update(status='unscored', validation='Evidence or reviewer provenance did not validate')
        return public, None
    scores = [item['score'] for item in ratings]
    score = 50 * sum(scores) / len(scores) if calibrated and scores and all(type(value) is int and value in (0, 1, 2) for value in scores) else None
    return public, score


def normalize_row(row, case, context, review, calibrated, control):
    require(row.get('category') == case['category'], 'Episode category differs from frozen case')
    transcript = row.get('transcript') or []
    calls = [call_receipt(call) for call in row.get('calls', [])]
    review_case = {**case, 'system_prompt': context['system_prompt']}
    public_review, score = normalize_review(review, review_case, transcript, calibrated, control)
    complete = (row.get('stop') == 'final_response' and row.get('measurement_status') == 'collected'
                and bool(calls) and not any(call.get('error') for call in row.get('calls', []))
                and bool(transcript) and transcript[-1].get('role') == 'assistant'
                and bool(transcript[-1].get('content', '').strip()))
    mechanically_observed = (row.get('measurement_status') == 'collected'
                             and row.get('stop') not in ('provider_error', 'harness_error')
                             and not any(call.get('error') for call in row.get('calls', [])))
    checks = row.get('checks')
    public_checks = None
    if isinstance(checks, dict):
        public_checks = {'contract_passed': checks.get('contract_passed') if mechanically_observed and type(checks.get('contract_passed')) is bool else None,
                         'checks': [{key: item[key] for key in ('name', 'status', 'evidence') if key in item} for item in checks.get('checks', [])]}
    return {'case_id': case['id'], 'category': case['category'], 'stop': row.get('stop'),
            'measurement_status': row.get('measurement_status'),
            'transcript': [{key: copy.deepcopy(message[key]) for key in ('role', 'content', 'tool_calls', 'tool_call_id', 'name') if key in message} for message in transcript],
            'latency_seconds': metric(row.get('latency_seconds')), **call_totals(calls),
            'contract_passed': public_checks['contract_passed'] if public_checks else None,
            'checks': public_checks, 'quality': score if complete else None, 'review': public_review, 'calls': calls}


def build_export(run_dir, calibration, suite):
    """Pure filesystem normalization; no provider calls and no publication side effects."""
    run_dir, suite, calibration = Path(run_dir), Path(suite), Path(calibration)
    manifest = read(suite / 'manifest.json'); plan = read(run_dir / 'plan.json')
    suite_hash = b.digest((suite / 'manifest.json').read_bytes())
    require(plan.get('suite_sha256') == suite_hash, 'Suite mismatch')
    require(all(name in manifest.get('files', {}) for name in ('cases.json', 'rubric.json', 'context.json', 'judge-calibration.json')), 'Frozen sources incomplete')
    for name, expected in manifest['files'].items():
        require(Path(name).name == name, 'Frozen file path must be a local name')
        require(b.digest((suite / name).read_bytes()) == (expected.get('sha256') if isinstance(expected, dict) else expected), 'Frozen source changed')
    source = read(suite / 'cases.json'); all_cases = source['cases'] if isinstance(source, dict) else source
    by_id = {case['id']: case for case in all_cases}
    selected = plan.get('cases', [])
    require(selected and len(selected) == len(set(selected)) and all(key in by_id for key in selected), 'Run cases do not match frozen suite')
    cases = [by_id[key] for key in selected]
    context = read(suite / 'context.json')
    require(context.get('provenance', {}).get('private_context') is False, 'Private context is not publishable')
    require(context.get('system_prompt_sha256') == b.digest(context['system_prompt']), 'Prompt provenance differs')
    require(context.get('tool_schema_sha256') == b.digest(b.canonical(context['tools'])), 'Tool provenance differs')
    control = read(calibration); calibrated = calibration_gate(control, suite)
    plans = {re.sub(r'[^a-z0-9]+', '-', arm['label'].lower()).strip('-'): arm for arm in plan.get('arms', [])}
    require(plans and len(plans) == len(plan['arms']), 'Distinct planned models required')
    found = {}
    for path in sorted(run_dir.glob('*/results.json')):
        result = read(path); identity = result['id']
        require(identity in plans and identity not in found, 'Unknown or duplicate result model')
        require(result['arm'] == plans[identity], 'Result arm differs from run plan')
        found[identity] = (result, path)
    models = []
    review_costs = []
    for identity, arm in plans.items():
        result, path = found.get(identity, ({'status': 'not_started', 'rows': []}, None))
        rows, seen = [], set()
        for row in result['rows']:
            case_id = row['case_id']
            require(case_id in selected and case_id not in seen, 'Unknown or duplicate result case')
            seen.add(case_id)
            review_path = path.parent / 'reviews' / (case_id + '.json')
            review = read(review_path) if review_path.exists() else {}
            if review:
                review_costs.append(metric(review.get('cost_usd')))
            rows.append(normalize_row(row, by_id[case_id], context, review, calibrated, control))
        models.append({'id': identity, 'label': arm['label'], 'model': arm['model'], 'provider': arm['provider'], 'status': result['status'],
                       'settings': copy.deepcopy(arm.get('native_params', {'temperature': .1, 'top_p': 1, 'seed': 42, 'renderer': arm.get('renderer'), 'effort': .1 if arm.get('renderer') == 'tml_v0' else None})),
                       'rates': {'input_per_million': metric(arm.get('input_rate')), 'output_per_million': metric(arm.get('output_rate'))},
                       'rows': rows, 'error': safe_error(result.get('error')), 'coverage': {'expected': len(cases), 'recorded': len(rows), 'missing_case_ids': [key for key in selected if key not in seen]},
                       'source_sha256': b.digest(path.read_bytes()) if path else None})
    calibration_costs = []
    for pair in control.get('pairs', []):
        for review in pair.get('reviews', {}).values():
            usage = review.get('usage') or {}
            calibration_costs.append((usage['input_tokens'] * 4 + usage['output_tokens'] * 20) / 1e6 if all(number(usage.get(key), True) for key in ('input_tokens', 'output_tokens')) else None)
    data = {'id': 'teaching-v2', 'case_count': len(cases), 'suite_case_count': len(all_cases), 'cases': cases, 'context': context, 'manifest': manifest,
            'rubric': read(suite / 'rubric.json'), 'models': models,
            'quality_available': calibrated and any(row['quality'] is not None for model in models for row in model['rows']),
            'quality_label': 'AI rubric score (not human learning)',
            'preferred_pareto_score': 'contracts',
            'calibration': {'passed': calibrated, 'status': control.get('status'), 'note': 'Authored contrast pairs; not human validation or inter-rater reliability.'},
            'judge_summary': {'reviews': len(review_costs), 'known_cost_usd': sum(value for value in review_costs if value is not None), 'unknown_cost_reviews': sum(value is None for value in review_costs),
                              'calibration_cost_usd': sum(calibration_costs) if calibration_costs and all(value is not None for value in calibration_costs) else None,
                              'known_calibration_cost_usd': sum(value for value in calibration_costs if value is not None), 'calibration_rate_assumptions': {'input_per_million': 4, 'output_per_million': 20}, 'human_ratings': None},
            'source': {'definition': 'Frozen authored development benchmark; normalized candidate episodes and separately validated AI reviews', 'suite_sha256': suite_hash,
                       'plan_sha256': b.digest((run_dir / 'plan.json').read_bytes()), 'calibration_receipt_sha256': b.digest(calibration.read_bytes()), 'exporter_sha256': b.digest(Path(__file__).read_bytes())},
            'cost_note': 'Usage estimates, not invoices. Candidate task costs sum candidate call receipts only; partial known cost is separate from unknown full cost. Recorded errors remain in measured latency/cost. Tinker rates include the discount once. Unknown cache hits are not assumed. Judge and calibration costs are separate.',
            'method_note': f'{len(cases)} frozen authored situations; at most three assistant turns with isolated real tool execution. One attempt per model and case. Missing, failed, incomplete and truncated episodes have unknown semantic quality, never zero. Collected contract checks retain observed failures, including truncation and unfinished tool loops; provider or harness failures have unknown contract outcomes. AI ratings are separate from contracts and do not measure human learning. Long prefixes test context use, not harness self-evolution. Version 1 and 2 scores are not directly comparable.'}
    environment_path = run_dir / 'execution-environment.json'
    if environment_path.exists():
        environment = read(environment_path)
        data['execution_environment'] = {key: environment[key] for key in ('candidate_model_workers', 'calls_per_model', 'concurrent_judge_workers', 'streaming', 'timing_boundary', 'comparison_limit', 'training_updates') if key in environment}
        data['source']['execution_environment_sha256'] = b.digest(environment_path.read_bytes())
        data['method_note'] += ' ' + environment.get('comparison_limit', '')
    public_guard(data)
    return data


@app.command()
def main(run_dir: Path = typer.Option(...), calibration: Path = typer.Option(...)):
    data = build_export(run_dir, calibration, ROOT / 'scripts/training/benchmarks/teaching-v2')
    target = ROOT / 'web/public/reports/learning-to-teach/report-data.json'
    report = read(target); report['benchmark_v2'] = data
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'models': len(data['models']), 'cases': data['case_count'], 'episodes': sum(len(model['rows']) for model in data['models'])}))


if __name__ == '__main__':
    app()
