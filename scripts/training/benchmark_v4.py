#!/usr/bin/env python3
"""Frozen public teaching challenge. Validation and planning use only the stdlib."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from fractions import Fraction
from pathlib import Path

SUITE = Path(__file__).resolve().parent / 'benchmarks/teaching-v4'
BENCHMARK_ID = 'keating-teaching-v4'
VERSION = '4.1.0'
HISTORICAL_SUITE = SUITE / 'versions/4.0.0'
SUPPORTED_VERSIONS = frozenset(('4.0.0', VERSION))
PLAN_VERSION = 'matched-checkpoints-1.0.0'
STATUS = 'frozen-public-development-challenge'
ROLES = ('initial', 'F', 'S', 'F+S')
HASH = re.compile(r'[0-9a-f]{64}')
ID = re.compile(r'[a-z][a-z0-9-]*')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def parse_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'Duplicate JSON key: {key}')
            result[key] = value
        return result

    def invalid(value):
        raise ValueError(f'Non-finite JSON value: {value}')

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def read_json(path):
    return parse_json(Path(path).read_bytes())


def fields(value, required, optional=()):
    require(isinstance(value, dict), 'Expected object')
    require(set(required) <= value.keys(), f'Missing fields: {sorted(set(required) - value.keys())}')
    require(value.keys() <= set(required) | set(optional), f'Unexpected fields: {sorted(value.keys() - set(required) - set(optional))}')


def text(value):
    return isinstance(value, str) and bool(value.strip())


def strings(value):
    return isinstance(value, list) and bool(value) and all(text(x) for x in value)


def indices(value, steps):
    return (isinstance(value, list) and bool(value)
            and all(type(i) is int and 0 <= i < len(steps) and steps[i]['kind'] == 'message' for i in value)
            and value == sorted(set(value)))


def fraction(value):
    require(isinstance(value, str) and re.fullmatch(r'-?\d+(?:/[1-9]\d*)?', value), 'Invalid rational')
    return Fraction(value)


def validate_math(check):
    fields(check, ('id', 'operation', 'operands', 'expected', 'available_from_step'))
    require(text(check['id']) and isinstance(check['operands'], list), 'Invalid reference calculation')
    args = [fraction(x) for x in check['operands']]
    op = check['operation']
    require(op in ('sum', 'product', 'difference', 'quotient', 'weighted_mean'), 'Unknown arithmetic operation')
    require(bool(args), 'Empty arithmetic operands')
    if op == 'sum':
        actual = sum(args)
    elif op == 'product':
        actual = Fraction(1)
        for arg in args:
            actual *= arg
    elif op in ('difference', 'quotient'):
        require(len(args) == 2 and (op != 'quotient' or args[1] != 0), 'Invalid binary arithmetic')
        actual = args[0] - args[1] if op == 'difference' else args[0] / args[1]
    else:
        require(len(args) >= 4 and len(args) % 2 == 0, 'Weighted mean needs value/weight pairs')
        weights = args[1::2]
        require(all(w >= 0 for w in weights) and sum(weights) > 0, 'Invalid weights')
        actual = sum(v * w for v, w in zip(args[::2], weights)) / sum(weights)
    require(actual == fraction(check['expected']), f'Incorrect reference math: {check["id"]}')


def validate_case(case):
    fields(case, ('id', 'family', 'category', 'title', 'steps', 'rubric', 'reference', 'training_policy'),
           ('pair_id', 'contrast_condition', 'seed_files', 'learner_profile', 'profile_lifecycle', 'transfer'))
    for name in ('id', 'family', 'category'):
        require(isinstance(case[name], str) and ID.fullmatch(case[name]), f'Invalid {name}')
    require(text(case['title']) and case['training_policy'] == 'exclude-entire-family', 'Invalid title/training policy')
    require(('pair_id' in case) == ('contrast_condition' in case), 'Incomplete context pair')
    for name in ('pair_id', 'contrast_condition'):
        if name in case:
            require(isinstance(case[name], str) and ID.fullmatch(case[name]), 'Invalid context pair ID')
    steps = case['steps']
    require(isinstance(steps, list) and 4 <= len(steps) <= 40, 'Invalid steps')
    for i, step in enumerate(steps):
        require(isinstance(step, dict) and step.get('kind') in ('message', 'reopen', 'new_session'), 'Unsupported fixed-core step')
        fields(step, ('kind', 'text') if step['kind'] == 'message' else ('kind',))
        if step['kind'] == 'message':
            require(text(step['text']) and len(step['text']) <= 65536 and not re.match(r'\s*[!/]', step['text']), 'Invalid learner message')
        else:
            require(0 < i < len(steps) - 1 and steps[i-1]['kind'] == steps[i+1]['kind'] == 'message', 'Invalid session event ordering')
    require(4 <= sum(s['kind'] == 'message' for s in steps) <= 12, 'Expected 4-12 learner messages')
    seeds = case.get('seed_files', {})
    require(isinstance(seeds, dict), 'Invalid seed files')
    for path, content in seeds.items():
        require(re.fullmatch(r'fixtures/[a-z0-9][a-z0-9/-]*\.(txt|md|csv|sql)', path)
                and '..' not in path and '//' not in path and text(content) and len(content) <= 262144,
                'Unsafe or invalid seed source')
    if 'learner_profile' in case:
        require(text(case['learner_profile']) and len(case['learner_profile']) <= 1500, 'Invalid learner profile')
    if 'profile_lifecycle' in case:
        require(case['profile_lifecycle'] is True, 'Invalid lifecycle flag')
    ref = case['reference']
    fields(ref, ('facts', 'math_checks', 'temporal_rule', 'assessment_limit', 'acceptable_variation'))
    require(isinstance(ref['facts'], list) and ref['facts'], 'Missing semantic facts')
    for fact in ref['facts']:
        fields(fact, ('available_from_step', 'text'))
        require(indices([fact['available_from_step']], steps) and text(fact['text']), 'Invalid fact availability')
    require(all(text(ref[x]) for x in ('temporal_rule', 'assessment_limit', 'acceptable_variation')), 'Missing reference boundaries')
    require(isinstance(ref['math_checks'], list), 'Invalid math checks')
    math_ids = set()
    for check in ref['math_checks']:
        validate_math(check)
        require(check['id'] not in math_ids and indices([check['available_from_step']], steps), 'Invalid math ID/availability')
        math_ids.add(check['id'])
    rules = case['rubric']
    require(isinstance(rules, list) and len(rules) >= 4, 'Insufficient independent rubrics')
    dimensions = set()
    for rule in rules:
        fields(rule, ('dimension', 'criteria', 'evidence_steps', 'evidence_type'))
        require(isinstance(rule['dimension'], str) and ID.fullmatch(rule['dimension']) and rule['dimension'] not in dimensions, 'Invalid rubric dimension')
        dimensions.add(rule['dimension'])
        fields(rule['criteria'], ('0', '1', '2'))
        anchors = list(rule['criteria'].values())
        require(all(text(x) for x in anchors) and len(set(anchors)) == 3, 'Invalid 0/1/2 anchors')
        require(indices(rule['evidence_steps'], steps), 'Invalid evidence steps')
        require(rule['evidence_type'] in ('conversation', 'persisted_state'), 'Invalid evidence type')
    if 'transfer' in case:
        t = case['transfer']
        fields(t, ('instruction_step', 'interference_steps', 'session_step', 'near_step', 'far_step', 'delay'))
        require(t['delay'] == 'scripted-session-gap-no-wall-clock-retention', 'Unsupported delay claim')
        require(indices([t['instruction_step'], *t['interference_steps'], t['near_step'], t['far_step']], steps), 'Invalid transfer temporal ordering')
        require(type(t['session_step']) is int and 0 <= t['session_step'] < len(steps)
                and steps[t['session_step']]['kind'] == 'new_session', 'Transfer needs a real fresh-session step')
        require(t['interference_steps'] and t['instruction_step'] < min(t['interference_steps'])
                <= max(t['interference_steps']) < t['session_step'] < t['near_step'] < t['far_step'], 'Invalid transfer temporal ordering')
    return case


def load_suite(directory=SUITE):
    directory = Path(directory)
    try:
        raw_manifest = (directory / 'manifest.json').read_bytes()
        manifest = parse_json(raw_manifest)
        fields(manifest, ('schema_version', 'benchmark_id', 'version', 'status', 'track', 'files', 'authorship', 'training_policy', 'comparison_plan_version'))
        require(type(manifest['schema_version']) is int and manifest['schema_version'] == 1, 'Invalid manifest schema')
        require(manifest['benchmark_id'] == BENCHMARK_ID and isinstance(manifest['version'], str) and manifest['version'] in SUPPORTED_VERSIONS
                and manifest['status'] == STATUS and manifest['track'] == 'fixed-cli-harness', 'Manifest identity/status mismatch')
        require(manifest['authorship'] == 'original-agent-authored-no-imported-traces'
                and manifest['training_policy'] == 'exclude-entire-family'
                and manifest['comparison_plan_version'] == PLAN_VERSION, 'Manifest policy mismatch')
        fields(manifest['files'], ('cases.json', 'README.md'))
        contents = {}
        for name, expected in manifest['files'].items():
            require(isinstance(expected, str) and HASH.fullmatch(expected), f'Invalid source hash: {name}')
            path = directory / name
            require(not path.is_symlink(), f'Symlinked source: {name}')
            contents[name] = path.read_bytes()
            require(digest(contents[name]) == expected, f'Source hash mismatch: {name}')
        doc = parse_json(contents['cases.json'])
        fields(doc, ('benchmark_id', 'version', 'status', 'cases'))
        require(all(doc[key] == manifest[key] for key in ('benchmark_id', 'version', 'status')), 'Cases/manifest identity mismatch')
        require(isinstance(doc['cases'], list) and len(doc['cases']) == 12, 'V4 freeze requires twelve cases')
        ids, pairs, families = set(), defaultdict(list), defaultdict(list)
        for case in doc['cases']:
            validate_case(case)
            require(case['id'] not in ids, 'Duplicate case ID')
            ids.add(case['id'])
            families[case['family']].append(case)
            if 'pair_id' in case:
                pairs[case['pair_id']].append(case)
        require(len(pairs) >= 2, 'Missing matched contexts')
        for pair in pairs.values():
            require(len(pair) == 2 and pair[0]['family'] == pair[1]['family'], 'Paired contexts must share one family')
            require(pair[0]['contrast_condition'] != pair[1]['contrast_condition']
                    and pair[0]['steps'][-1] == pair[1]['steps'][-1]
                    and (pair[0]['steps'] != pair[1]['steps'] or pair[0].get('learner_profile') != pair[1].get('learner_profile')),
                    'Context contrast missing or unmatched final request')
        for members in families.values():
            require(len(members) == 1 or (len(members) == 2 and members[0].get('pair_id')
                    and members[0]['pair_id'] == members[1].get('pair_id')), 'Unpaired duplicate family')
        return {'directory': directory, 'manifest': manifest, 'manifest_sha256': digest(raw_manifest), 'cases': doc['cases']}
    except (OSError, UnicodeError) as exc:
        raise ValueError(f'Missing or unreadable frozen suite source: {exc.filename if isinstance(exc, OSError) else directory}') from exc


def load_cases(path=SUITE / 'cases.json'):
    require(Path(path).name == 'cases.json', 'Load the frozen cases.json entry point')
    return load_suite(Path(path).parent)['cases']


def legacy():
    import benchmark_v3
    return benchmark_v3


def request_for(case, transport, *, max_output_tokens=1024, max_provider_calls=12,
                max_tool_calls=16, turn_timeout_ms=120000, temperature=None, seed=None):
    validate_case(case)
    require(temperature is None and seed is None,
            'Native v3 request schema does not support temperature/seed; configure and attest the sampler bridge externally, or stop')
    limits = {'max_output_tokens': (max_output_tokens, 16000), 'max_provider_calls': (max_provider_calls, 100),
              'max_tool_calls': (max_tool_calls, 128), 'turn_timeout_ms': (turn_timeout_ms, 600000)}
    require(all(type(value) is int and 1 <= value <= cap for value, cap in limits.values()), 'Invalid native run limits')
    require(isinstance(transport, dict) and transport.get('kind') in ('tape', 'provider'), 'Unsupported sampler transport; stop')
    if transport['kind'] == 'tape':
        fields(transport, ('kind', 'responses'))
        require(isinstance(transport['responses'], list) and len(transport['responses']) <= 100, 'Invalid tape')
    else:
        fields(transport, ('kind', 'provider', 'model'), ('thinking', 'endpoint', 'apiKeyEnv', 'modelMetadata'))
        require(text(transport['provider']) and text(transport['model']), 'Unsupported sampler identity; stop')
    request = legacy().request_for(case, transport)
    request['limits'] = {key: value for key, (value, _) in limits.items()}
    return request


def summarize(case, result, elapsed):
    row = legacy().summarize(case, result, elapsed)
    row.update(benchmark_id=BENCHMARK_ID, version=VERSION, family=case['family'],
               assessment={'independent_knowledge': None, 'retention': None, 'human_learning_effect': None})
    return row


def make_plan(suite, checkpoints=None, repeats=3):
    require(type(repeats) is int and 1 <= repeats <= 20, 'Invalid repeat count')
    if checkpoints is not None:
        fields(checkpoints, ROLES)
        base_ids = set()
        for role, item in checkpoints.items():
            fields(item, ('checkpoint_id', 'weights_sha256', 'base_checkpoint_id', 'training_manifest_sha256'))
            require(text(item['checkpoint_id']) and text(item['base_checkpoint_id']), 'Missing checkpoint identity')
            require(isinstance(item['weights_sha256'], str) and HASH.fullmatch(item['weights_sha256']), 'Missing immutable weights hash')
            require(item['training_manifest_sha256'] is None if role == 'initial' else
                    isinstance(item['training_manifest_sha256'], str) and HASH.fullmatch(item['training_manifest_sha256']), 'Invalid training provenance')
            base_ids.add(item['base_checkpoint_id'])
        require(base_ids == {checkpoints['initial']['checkpoint_id']}, 'Checkpoints must share the initial base')
    families = sorted({case['family'] for case in suite['cases']})
    schedule = []
    for repeat in range(repeats):
        for position, case in enumerate(suite['cases']):
            offset = (repeat + position) % len(ROLES)
            schedule.append({'repeat': repeat, 'case_id': case['id'], 'family': case['family'],
                             'role_order': list(ROLES[offset:] + ROLES[:offset])})
    return {'schema_version': 1, 'comparison_plan_version': PLAN_VERSION,
            'benchmark_id': BENCHMARK_ID, 'version': suite['manifest']['version'], 'status': 'planned-not-executed',
            'manifest_sha256': suite['manifest_sha256'], 'source_hashes': suite['manifest']['files'],
            'adapter_sha256': digest(Path(__file__).read_bytes()),
            'roles': {r: {'feature_reward': r in ('F', 'F+S'), 'hindsight_self_distillation': r in ('S', 'F+S'),
                          'checkpoint': checkpoints[r] if checkpoints else None} for r in ROLES},
            'checkpoint_status': 'identities-supplied-training-match-unverified' if checkpoints else 'unbound-no-weights-supplied',
            'repeats': repeats, 'schedule': schedule, 'excluded_training_families': families,
            'matched_controls': ['same base and tokenizer', 'same training data eligibility and family exclusions',
                                 'same update budget and seed blocks; predeclare F/S objective definitions',
                                 'same runtime source and built hashes, system prompt, tools, limits and surface',
                                 'same inference settings; record unsupported seed/temperature controls as unavailable',
                                 'fresh workspace per case and role; no carryover between paired conditions'],
            'required_run_bindings': ['checkpoint and training-manifest hashes', 'runtime source inventory and unchanged-at-end attestation',
                                      'actual model/endpoint mapping to checkpoint', 'request, result and independent review hashes'],
            'analysis': {'unit': 'family; average paired contexts within family before macro averaging',
                         'contrasts': ['F-initial', 'S-initial', 'F+S-initial', '(F+S)-F-S+initial'],
                         'missing': 'null scores remain unknown; report joint complete coverage and full denominators; no imputation',
                         'uncertainty': 'paired family-level intervals; report per-case and per-dimension disagreements; small public sample',
                         'review': 'blind checkpoint identity; separate calibrated reviewers; adjudicate disagreements without changing cases'},
            'adaptive_activity': {'status': 'external-condition-not-implemented-here', 'pool_with_fixed_core': False,
                                  'requires': ['versioned observation-driven controller', 'source-document/task identity',
                                               'actual available action and submission receipts', 'separate family-matched report']},
            'claims': {'untouched_holdout': False, 'human_learning': None, 'wall_clock_retention': None}}


def validate_review(case, result, review):
    """Strengthen v3 evidence binding: every scoped turn, no clipping, real state evidence."""
    validate_case(case)
    require(isinstance(result, dict) and isinstance(review, dict), 'Result and review must be objects')
    fields(review, ('result_sha256', 'case_sha256', 'reviewer_kind', 'reviewer_id', 'ratings'), ('reviewer_calibration',))
    require(text(review['reviewer_id']), 'Reviewer provenance required')
    require(result.get('id') == case['id'], 'Result case identity mismatch')
    require(result.get('status') == 'completed' and result.get('measurement') == 'model_episode', 'Only completed model episodes can receive scores')
    require(review['case_sha256'] == digest(canonical(case)) and review['result_sha256'] == digest(canonical(result)), 'Review hash binding mismatch')
    steps = result.get('steps')
    require(isinstance(steps, list) and len(steps) == len(case['steps']), 'Missing result steps')
    for i, step in enumerate(steps):
        require(isinstance(step, dict) and type(step.get('index')) is int and step['index'] == i
                and step.get('kind') == case['steps'][i]['kind'], 'Result temporal ordering mismatch')
    rules = {r['dimension']: r for r in case['rubric']}
    ratings = review['ratings']
    require(isinstance(ratings, list) and all(isinstance(r, dict) for r in ratings), 'Malformed ratings')
    require(len(ratings) == len(rules) and all(isinstance(r.get('dimension'), str) for r in ratings)
            and {r['dimension'] for r in ratings} == set(rules), 'Incomplete rubric coverage')
    for rating in ratings:
        fields(rating, ('dimension', 'score', 'reason'), ('uncertainty', 'evidence', 'additional_evidence', 'state_evidence'))
        score = rating['score']
        require(score is None or type(score) is int and score in (0, 1, 2), 'Invalid rubric score')
        require(text(rating['reason']), 'Reason required')
        if score is None:
            require(text(rating.get('uncertainty')), 'Abstention requires uncertainty')
            continue
        rule = rules[rating['dimension']]
        more = rating.get('additional_evidence', [])
        require(isinstance(more, list), 'Malformed additional evidence')
        evidence = [rating.get('evidence'), *more]
        require(all(isinstance(e, dict) and type(e.get('step_index')) is int for e in evidence), 'Malformed evidence')
        require(sorted(e['step_index'] for e in evidence) == rule['evidence_steps'], 'Evidence must cover every scoped step exactly once')
        for e in evidence:
            index = e['step_index']
            step = steps[index]
            messages, start = step.get('messages'), step.get('message_start_index')
            require(step.get('status') == 'completed' and isinstance(messages, list) and type(start) is int
                    and 0 <= start < len(messages) and all(isinstance(m, dict) for m in messages), 'Unobserved evidence step')
            fresh = messages[start:]
            require(not any(m.get('role') == 'assistant' and m.get('stopReason') in ('length', 'error', 'aborted') for m in fresh),
                    'Clipped or failed evidence requires abstention')
            require(any(m.get('role') == 'assistant' and visible_text(m) for m in fresh), 'Missing visible tutor response requires abstention')
            if e.get('kind') == 'quote':
                mi = e.get('message_index')
                require(type(mi) is int and start <= mi < len(messages), 'Evidence must cite a new message')
                require(text(e.get('quote')) and any(e['quote'] in s for s in visible_text(messages[mi])), 'Quote absent from visible text')
            else:
                require(e.get('kind') == 'missing_behavior' and text(e.get('observation')), 'Missing behavior needs a specific observation')
            # Reuse the existing role/quote/provenance checks, once per required turn.
            narrowed = {**case, 'rubric': [rule]}
            one = {**review, 'case_sha256': digest(canonical(narrowed)), 'ratings': [{**rating, 'evidence': e}]}
            legacy().validate_review(narrowed, result, one)
        if rule['evidence_type'] == 'persisted_state':
            state = rating.get('state_evidence')
            require(isinstance(state, list) and all(isinstance(e, dict) and type(e.get('step_index')) is int for e in state), 'Persistence needs actual state evidence')
            require(sorted(e['step_index'] for e in state) == rule['evidence_steps'], 'State evidence must cover every scoped step')
            for e in state:
                fields(e, ('step_index', 'path', 'sha256', 'observation'))
                require(text(e['observation']) and isinstance(e['path'], str)
                        and re.fullmatch(r'\.keating/(?:state|profiles)/[A-Za-z0-9_./-]+\.json', e['path'])
                        and '..' not in e['path'] and '/sessions/' not in e['path'], 'Invalid active state evidence')
                files = steps[e['step_index']].get('files', [])
                matches = [f for f in files if isinstance(f, dict) and f.get('path') == e['path']]
                require(len(matches) == 1 and isinstance(matches[0].get('content'), str), 'Missing actual state file')
                require(e['sha256'] == matches[0].get('sha256') == digest(matches[0]['content']), 'State evidence hash mismatch')
    # Also validates provenance on all-abstention reviews.
    return legacy().validate_review(case, result, review)


def visible_text(message):
    content = message.get('content', [])
    if isinstance(content, str):
        return [content] if content.strip() else []
    if not isinstance(content, list):
        return []
    return [b['text'] for b in content if isinstance(b, dict) and b.get('type') == 'text' and text(b.get('text'))]


def run(output, *, suite=SUITE, provider='', model='', tape_directory=None, case_id='', runtime_root=None,
        endpoint='', api_key_env='', context_window=0, model_max_tokens=0, grader_config=None):
    """Explicit execution seam. Never called by validate/plan; inherits v3 provider restrictions."""
    frozen = load_suite(suite)
    require(not case_id or case_id in {c['id'] for c in frozen['cases']}, 'Unknown case ID')
    # The unchanged runner handles immutable outputs, native receipts and runtime source inventory.
    legacy().run(Path(output), provider=provider, model=model, suite=Path(suite), case_id=case_id,
                 tape_directory=Path(tape_directory) if tape_directory else None,
                 endpoint=endpoint, api_key_env=api_key_env, context_window=context_window,
                 model_max_tokens=model_max_tokens, runtime_root=Path(runtime_root) if runtime_root else None)
    # New companion receipt, never a rewrite of v3 output. A single run is not a matched experiment.
    legacy().b.write_json(Path(output) / 'v4-binding.json', {
        'benchmark_id': BENCHMARK_ID, 'version': frozen['manifest']['version'], 'manifest_sha256': frozen['manifest_sha256'],
        'source_hashes': frozen['manifest']['files'], 'adapter_sha256': digest(Path(__file__).read_bytes()),
        'comparison_status': 'single-run-checkpoint-and-training-match-unverified',
        'measurement': 'offline_integration' if tape_directory else 'model_episode'})
    if grader_config is not None:
        from benchmark_response_grading import grade_run
        grade_run(output, read_json(grader_config), suite)


def review_run(run_directory, reviews, suite=SUITE):
    frozen = load_suite(suite)
    directory, reviews = Path(run_directory), Path(reviews)
    binding = read_json(directory / 'v4-binding.json')
    require(binding.get('manifest_sha256') == frozen['manifest_sha256']
            and binding.get('source_hashes') == frozen['manifest']['files'], 'Run suite binding mismatch')
    plan = read_json(directory / 'plan.json')
    require(plan.get('cases_sha256') == frozen['manifest']['files']['cases.json'], 'Run source hash mismatch')
    available = {case['id']: case for case in frozen['cases']}
    cases = plan.get('cases')
    require(isinstance(cases, list) and cases and all(isinstance(c, dict) and isinstance(c.get('id'), str) for c in cases), 'Missing run cases')
    require(len({c['id'] for c in cases}) == len(cases), 'Duplicate run cases')
    rows = []
    for case in cases:
        require(case == available.get(case['id']), 'Run case differs from frozen source')
        grade_path = directory / 'response-grades' / (case['id'] + '.json')
        automatic = {'response_quality': None, 'response_grading_status': 'missing', 'response_coverage': None}
        if grade_path.exists():
            from benchmark_response_grading import read_grade
            grade = read_grade(grade_path, case, read_json(directory / (case['id'] + '.result.json')))
            require(grade.get('benchmark_version') == frozen['manifest']['version'], 'Automatic grade suite version mismatch')
            automatic = {'response_quality': grade['response_quality'],
                         'response_grading_status': grade.get('status', 'classified'),
                         'response_coverage': grade.get('coverage'), 'automatic_grade_sha256': grade.get('grading_sha256')}
        path = reviews / (case['id'] + '.json')
        if not path.exists():
            rows.append({'case_id': case['id'], 'quality': None, 'status': 'missing_review', **automatic})
            continue
        score = validate_review(case, read_json(directory / (case['id'] + '.result.json')), read_json(path))
        rows.append({'case_id': case['id'], 'quality': score, 'status': 'reviewed' if score is not None else 'unknown', **automatic})
    return {'benchmark_id': BENCHMARK_ID, 'version': frozen['manifest']['version'], 'rows': rows,
            'note': 'quality is independent rubric review; response_quality is automatic contextual response grading. Report both with coverage; no opaque combined weight or human learning claim.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('validate', 'plan', 'request', 'run', 'review', 'grade'):
        child = sub.add_parser(name)
        child.add_argument('--suite', type=Path, default=SUITE)
        if name == 'plan':
            child.add_argument('--checkpoints', type=Path)
            child.add_argument('--repeats', type=int, default=3)
        elif name == 'request':
            child.add_argument('--case-id', required=True)
            child.add_argument('--transport', type=Path, required=True, help='Native provider/tape transport JSON; credential environment names only')
            child.add_argument('--max-output-tokens', type=int, default=1024)
            child.add_argument('--max-provider-calls', type=int, default=12)
            child.add_argument('--max-tool-calls', type=int, default=16)
            child.add_argument('--turn-timeout-ms', type=int, default=120000)
            child.add_argument('--temperature', '--temp', type=float)
            child.add_argument('--seed', type=int)
        elif name == 'run':
            child.add_argument('output', type=Path)
            child.add_argument('--grader-config', type=Path, help='Automatically classify and grade saved responses after execution')
            for option in ('provider', 'model', 'case-id', 'endpoint', 'api-key-env'):
                child.add_argument('--' + option, default='')
            for option in ('tape-directory', 'runtime-root'):
                child.add_argument('--' + option, type=Path)
            for option in ('context-window', 'model-max-tokens'):
                child.add_argument('--' + option, type=int, default=0)
        elif name == 'review':
            child.add_argument('run_directory', type=Path)
            child.add_argument('reviews', type=Path)
        elif name == 'grade':
            child.add_argument('run_directory', type=Path)
            child.add_argument('--grader-config', type=Path, required=True)
    args = vars(parser.parse_args(argv))
    command = args.pop('command')
    try:
        if command == 'validate':
            suite = load_suite(args['suite'])
            result = {'benchmark_id': BENCHMARK_ID, 'version': suite['manifest']['version'], 'status': STATUS,
                      'manifest_sha256': suite['manifest_sha256'], 'cases': len(suite['cases']),
                      'families': len({c['family'] for c in suite['cases']}),
                      'learner_messages': sum(s['kind'] == 'message' for c in suite['cases'] for s in c['steps']),
                      'rubric_dimensions': sum(len(c['rubric']) for c in suite['cases'])}
        elif command == 'plan':
            result = make_plan(load_suite(args['suite']), read_json(args['checkpoints']) if args['checkpoints'] else None, args['repeats'])
        elif command == 'request':
            frozen = load_suite(args.pop('suite'))
            case_id = args.pop('case_id')
            cases = [c for c in frozen['cases'] if c['id'] == case_id]
            require(len(cases) == 1, 'Unknown case ID')
            result = request_for(cases[0], read_json(args.pop('transport')), **args)
        elif command == 'review':
            result = review_run(**args)
        elif command == 'grade':
            from benchmark_response_grading import grade_run
            result = grade_run(args['run_directory'], read_json(args['grader_config']), args['suite'])
        else:
            run(**args)
            return
        print(canonical(result))
    except (ValueError, OSError, ImportError) as exc:
        parser.exit(2, f'benchmark_v4: {exc}\n')


if __name__ == '__main__':
    main()
