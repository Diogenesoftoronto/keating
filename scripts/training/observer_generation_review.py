"""Offline blinded review of the eight-task controlled SAE generation pilot.

prepare requires a COMPLETE archive by default. Explicit --allow-partial admits
only verified durable complete five-condition trials from a partial archive.
Only blind-packet.json goes to reviewers; private/ contains the condition key,
decoded token evidence, frozen protocol and audit. summarize needs two complete
independent review files. No provider, credential, model inference or downloads.

Run this file with --help for the two path-based CLI commands. Module import and
summarize use only the standard library; prepare additionally uses the worker's
local tokenizer dependencies. Output directories must not already exist.
"""
import argparse
from collections import Counter
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import random
import re
import stat

CRITERIA = ('correctness', 'request_match', 'no_unwarranted_claims')
CONDITIONS = ('baseline', 'selected_positive', 'selected_negative', 'random', 'unrelated')
CATEGORIES = ('hint', 'worked', 'retention')
VERDICTS = {'pass', 'fail', 'unknown'}
DECODE_OPTIONS = {'skip_special_tokens': False, 'clean_up_tokenization_spaces': False}
BUNDLE_FILES = ('blind-packet.json', 'private/mapping.json', 'private/decoded-results.json', 'private/protocol.json')
MAX_JSON = 16 * 1024 * 1024


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _exact(value, keys, name):
    _require(isinstance(value, dict) and set(value) == set(keys), 'Exact ' + name + ' keys required')


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _pairs(items):
    result = {}
    for key, value in items:
        _require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def _parse(body):
    def invalid_constant(_):
        raise ValueError('Non-finite JSON constant')
    return json.loads(body, object_pairs_hook=_pairs, parse_constant=invalid_constant)


def _read(path, limit=MAX_JSON):
    path = Path(path)
    _require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode), 'Expected regular input file')
    with path.open('rb') as stream:
        body = stream.read(limit + 1)
    _require(len(body) <= limit, 'Input exceeds byte limit')
    return body


def _fresh(path):
    _require(not os.path.lexists(path), 'Refusing to overwrite output directory')


def _write_bundle(output_dir, values, audit):
    """Publish the audit last; an interrupted directory is never a valid bundle."""
    root = Path(output_dir)
    _fresh(root)
    bodies = {name: _canonical(value) + b'\n' for name, value in values.items()}
    audit = {**audit, 'files_sha256': {name: _hash(body) for name, body in bodies.items()}}
    audit['audit_sha256'] = _hash(_canonical(audit))
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    for name, body in [*bodies.items(), ('private/audit.json', _canonical(audit) + b'\n')]:
        path = root / name
        path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        with open(path, 'xb', opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
            stream.write(body)
    return audit


@contextmanager
def _offline(cache_dir):
    settings = {'HF_HUB_CACHE': str(Path(cache_dir).resolve()), 'HF_HUB_OFFLINE': '1',
                'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1',
                'HF_HUB_DISABLE_TELEMETRY': '1'}
    previous = {key: os.environ.get(key) for key in settings}
    os.environ.update(settings)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _cases(protocol, job):
    _require(protocol.get('schema_version') == 1 and protocol.get('outputs_inspected') is False
             and protocol.get('job_sha256') == job['job_sha256'], 'Locked protocol/job mismatch')
    _require(protocol.get('conditions') == list(CONDITIONS), 'Frozen condition set mismatch')
    cases = protocol.get('cases')
    _require(isinstance(cases, list) and len(cases) == 8, 'Exactly eight frozen cases required')
    _require({c['id'] for c in cases} == {f'fh{i:02}' for i in range(1, 9)}, 'Frozen case IDs mismatch')
    _require(Counter(c['category'] for c in cases) == {'hint': 4, 'worked': 2, 'retention': 2},
             'Expected four hint, two worked and two retention tasks')
    _require(len({c['family_id'] for c in cases}) == 8, 'Eight distinct task families required')
    for case in cases:
        _require(isinstance(case['opening_message'], str) and case['opening_message'], 'Missing learner prompt')
        rules = case['criteria']
        _require(isinstance(rules, list) and len(rules) == 3 and {r['id'] for r in rules} == set(CRITERIA),
                 'Exactly three frozen criteria required')
        for rule in rules:
            _require(isinstance(rule['description'], str) and rule['description'].strip(), 'Missing criterion description')
    return {c['id']: c for c in cases}


def _bindings(job, join, protocol, generation):
    cases = _cases(protocol, job)
    ids = job['generation_spec']['generation_record_ids']
    _require(len(ids) == 8 and len(set(ids)) == 8, 'Exactly eight unique generation records required')
    records = {r['record_id']: r for r in job['experiment']['records']}
    bound = {}
    for rid in ids:
        local = join['records'].get(rid, {})
        local_id = local.get('record_id', '')
        _require(isinstance(local_id, str) and re.fullmatch(r'gen-fh0[1-8]', local_id), 'Unmapped generation record')
        case = cases[local_id[4:]]
        _require(local.get('family_id') == 'fresh-' + case['family_id'] and local.get('split') == 'test',
                 'Source family/split mismatch')
        view = generation.prompt_view(records[rid])
        expected = '[learner_message]\n' + case['opening_message'] + '\n[actor_message]\n'
        _require(view['text'] == expected, 'Exact learner prompt differs from frozen case')
        bound[rid] = (case, local_id, view['text'])
    _require(len({case['id'] for case, _, _ in bound.values()}) == 8, 'Duplicate case mapping')
    return bound


def _first_divergence(baseline, generated):
    for index, (left, right) in enumerate(zip(baseline, generated)):
        if left != right:
            return index
    return None if len(baseline) == len(generated) else min(len(baseline), len(generated))


def _decode_rows(job, bound, imported, tokenizer):
    """Check every prompt before decoding any output, preserving all target IDs."""
    rows = imported['result']['rows']
    _require(len(rows) == imported['validated_completed_trials']
             and [r['record_id'] for r in rows] == job['generation_spec']['generation_record_ids'][:len(rows)],
             'Missing, duplicate or reordered generation rows')
    pending = []
    for row in rows:
        case, local_id, prompt = bound[row['record_id']]
        enc = tokenizer(prompt, return_offsets_mapping=True, add_special_tokens=False, truncation=False)
        ids = enc['input_ids']
        _require(enc['attention_mask'] == [1] * len(ids), 'Unexpected prompt attention mask')
        conditions = row['controls']['conditions']
        _require(set(conditions) == set(CONDITIONS), 'Missing or extra condition')
        baseline = conditions['baseline']['rows'][0]['generated_ids']
        for name in CONDITIONS:
            item = conditions[name]
            _require(len(item['rows']) == 1, 'Expected one sequence per condition')
            out = item['rows'][0]
            _require(item['input_ids'] == [ids] and item['attention_mask'] == [[1] * len(ids)]
                     and out['prompt_ids'] == ids and out['used_prompt_ids'] == ids
                     and out['dropped_prompt_ids'] == [] and out['sequence_ids'] == ids + out['generated_ids'],
                     'Exact pinned tokenizer prompt/sequence mismatch')
            pending.append((row['record_id'], case, local_id, prompt, out, name, baseline))
    decoded = []
    for rid, case, local_id, prompt, out, name, baseline in pending:
        generated = out['generated_ids']
        raw = tokenizer.decode(generated, **DECODE_OPTIONS)
        _require(isinstance(raw, str), 'Tokenizer must return raw text')
        decoded.append({'generation_record_id': rid, 'local_record_id': local_id, 'case_id': case['id'],
            'category': case['category'], 'family_id': case['family_id'], 'condition': name,
            'learner_prompt': case['opening_message'], 'serialized_prompt': prompt,
            'prompt_ids': out['used_prompt_ids'], 'generated_ids': generated, 'raw_output': raw,
            'stop_reason': out['stop_reason'], 'generated_token_count': len(generated),
            'identical_to_baseline': generated == baseline,
            'first_divergent_position': _first_divergence(baseline, generated)})
    return decoded


def _coverage(protocol, completed_case_ids, execution_complete):
    """Missing execution is separate from a reviewer's unknown judgment."""
    planned = [c['id'] for c in protocol['cases']]
    _require(completed_case_ids and len(set(completed_case_ids)) == len(completed_case_ids)
             and set(completed_case_ids) <= set(planned), 'Invalid completed case coverage')
    n = len(completed_case_ids)
    _require(type(execution_complete) is bool and (not execution_complete or n == 8), 'Execution completion mismatch')
    return {'execution_complete': execution_complete,
        'planned_case_ids': planned, 'completed_case_ids': completed_case_ids,
        'missing_case_ids': [cid for cid in planned if cid not in completed_case_ids],
        'planned_family_count': 8, 'planned_response_count': 40,
        'completed_family_count': n, 'observed_response_count': 5 * n,
        'missing_family_count': 8 - n, 'missing_response_count': 5 * (8 - n),
        'attempted_family_count': 8 if execution_complete else None,
        'attempted_response_count': 40 if execution_complete else None,
        'attempted_family_lower_bound': n, 'attempted_response_lower_bound': 5 * n,
        'attempted_count_note': 'Partial durable groups do not identify all in-flight attempts; null means unreported, not zero.',
        'by_category': {category: {
            'planned_family_count': sum(c['category'] == category for c in protocol['cases']),
            'observed_family_count': sum(c['category'] == category and c['id'] in completed_case_ids for c in protocol['cases'])}
            for category in CATEGORIES}}


def prepare(job_path, join_path, protocol_path, archive_path, output_dir, *, cache_dir, shuffle_seed=1729, allow_partial=False):
    """Verify, decode and write a fresh review bundle. Return audit metadata only."""
    _fresh(output_dir)
    _require(type(shuffle_seed) is int and 0 <= shuffle_seed < 2**32, 'Bounded integer shuffle seed required')
    _require(type(allow_partial) is bool, 'allow_partial must be boolean')
    # The worker import is light; tokenizer packages load only after archive validation.
    import observer_generation_job as generation
    inputs = {name: _read(path) for name, path in [('job', job_path), ('join', join_path), ('protocol', protocol_path)]}
    job, join, protocol = (_parse(inputs[name]) for name in ('job', 'join', 'protocol'))
    body = _read(archive_path, generation.MAX_ARCHIVE)
    imported = generation.import_outputs(job, join, body)
    count = imported.get('validated_completed_trials')
    admissible = (imported['complete'] is True and count == 8) or (
        allow_partial and imported['complete'] is False and type(count) is int and 1 <= count <= 8)
    _require(admissible and type(count) is int and not imported.get('diagnostic_only', False)
             and imported.get('result') is not None and imported.get('local_join') is not None,
             'Only COMPLETE eight-trial archives by default; --allow-partial needs a valid non-diagnostic completed prefix')
    _require(imported['archive_sha256'] == _hash(body), 'Archive identity mismatch')
    bound = _bindings(job, join, protocol, generation)
    result_ids = [r['record_id'] for r in imported['result']['rows']]
    _require(len(result_ids) == count and result_ids == job['generation_spec']['generation_record_ids'][:count],
             'Missing, duplicate or reordered generation rows')
    completed_ids = [bound[rid][0]['id'] for rid in result_ids]
    coverage = _coverage(protocol, completed_ids, imported['complete'])
    with _offline(cache_dir):
        tokenizer = generation.cached_tokenizer(job, None, cache_dir)
        rows = _decode_rows(job, bound, imported, tokenizer)
    # Independent PRNG streams prevent row position from encoding task/condition identity.
    random.Random(shuffle_seed).shuffle(rows)
    # Bind IDs to these exact inputs, so another run's review cannot silently join.
    opaque = random.Random('observer-review-ids/v1:' + str(shuffle_seed) + ':'
                           + imported['archive_sha256'] + ':' + _hash(inputs['protocol']))
    cases = _cases(protocol, job)
    packet, mapping = [], []
    for row in rows:
        row['id'] = 'r-' + f'{opaque.getrandbits(128):032x}'
        packet.append({'id': row['id'], 'learner_prompt': row['learner_prompt'],
            'criteria': {r['id']: r['description'] for r in cases[row['case_id']]['criteria']},
            'raw_output': row['raw_output']})
        mapping.append({key: row[key] for key in ('id', 'generation_record_id', 'local_record_id',
                                                 'case_id', 'category', 'family_id', 'condition')})
    _require(len(rows) == 5 * count and len({r['id'] for r in rows}) == 5 * count, 'Blind ID collision or incomplete group')
    identity = {'schema_version': 1, 'job_sha256': job['job_sha256']}
    values = {'blind-packet.json': {'rows': packet}, 'private/mapping.json': {**identity, 'coverage': coverage, 'rows': mapping},
        'private/decoded-results.json': {**identity, 'result_sha256': imported['result']['result_sha256'], 'coverage': coverage, 'rows': rows},
        'private/protocol.json': protocol}
    return _write_bundle(output_dir, values, {**identity, 'kind': 'observer_generation_review_prepare',
        'complete': imported['complete'], 'bundle_complete': True, 'allow_partial': allow_partial,
        'coverage': coverage, 'row_count': 5 * count, 'case_count': count, 'shuffle_seed': shuffle_seed,
        'shuffle_algorithm': 'python_random_shuffle; independent 128-bit ID stream/v1',
        'inputs_sha256': {**{key: _hash(value) for key, value in inputs.items()}, 'archive': _hash(body)},
        'join_sha256': join['join_sha256'], 'result_sha256': imported['result']['result_sha256'],
        'local_joined_sha256': imported['local_join']['local_joined_sha256'],
        'decode_options': DECODE_OPTIONS, 'first_divergence_indexing': 'zero-based generated IDs; strict prefix uses shorter length; null means identical',
        'tokenizer_assets': [a for a in job['inventory']['assets'] if 'tokenizer' in a['roles']],
        'implementation_sha256': _hash(_read(__file__))})


def _load_bundle(directory):
    root = Path(directory)
    audit = _parse(_read(root / 'private/audit.json'))
    saved = audit.pop('audit_sha256', None)
    _require(saved == _hash(_canonical(audit)), 'Bundle audit hash mismatch')
    audit['audit_sha256'] = saved
    _require(audit.get('kind') == 'observer_generation_review_prepare'
             and (audit.get('bundle_complete') is True or ('bundle_complete' not in audit and audit.get('complete') is True))
             and set(audit['files_sha256']) == set(BUNDLE_FILES), 'Complete prepare bundle required')
    values = {}
    for name in BUNDLE_FILES:
        body = _read(root / name)
        _require(_hash(body) == audit['files_sha256'][name], 'Bundle file hash mismatch: ' + name)
        values[name] = _parse(body)
    rows = values['private/decoded-results.json']['rows']
    ids = [r['id'] for r in rows]
    protocol = values['private/protocol.json']
    cases = _cases(protocol, audit)
    completed = list(dict.fromkeys(r['case_id'] for r in rows))
    if 'coverage' in audit:
        completed = audit['coverage']['completed_case_ids']
    coverage = _coverage(protocol, completed, audit['complete'])
    _require(audit['complete'] is True or audit.get('allow_partial') is True, 'Partial bundle requires explicit admission')
    _require(len(ids) == coverage['observed_response_count'] and len(set(ids)) == len(ids)
             and Counter((r['case_id'], r['condition']) for r in rows) == Counter(
                 (cid, condition) for cid in completed for condition in CONDITIONS), 'Expected complete five-condition groups only')
    _require(all(r['category'] == cases[r['case_id']]['category'] and r['family_id'] == cases[r['case_id']]['family_id'] for r in rows),
             'Bundle case/category mismatch')
    if 'coverage' in audit:
        _require(audit['coverage'] == coverage and all(values[name]['coverage'] == coverage
                 for name in ('private/mapping.json', 'private/decoded-results.json')), 'Bundle coverage mismatch')
    audit['coverage'] = coverage  # Legacy COMPLETE bundles had no coverage field.
    _require([r['id'] for r in values['blind-packet.json']['rows']] == ids
             and [r['id'] for r in values['private/mapping.json']['rows']] == ids, 'Bundle ID mismatch')
    return audit, rows


def _review(value, ids):
    _exact(value, ('reviewer', 'rows'), 'review')
    name = value['reviewer']
    _require(isinstance(name, str) and name == name.strip() and 0 < len(name) <= 256
             and name != 'consensus', 'Distinct nonempty reviewer identity required')
    _require(isinstance(value['rows'], list) and len(value['rows']) == len(ids), 'Review must cover exact blind IDs')
    result = {}
    for row in value['rows']:
        _exact(row, ('id', 'criteria'), 'review row')
        _require(isinstance(row['id'], str) and row['id'] in ids and row['id'] not in result,
                 'Unknown or duplicate review ID')
        _exact(row['criteria'], CRITERIA, 'review criteria')
        for rating in row['criteria'].values():
            _exact(rating, ('verdict', 'reason'), 'criterion rating')
            _require(isinstance(rating['verdict'], str) and rating['verdict'] in VERDICTS, 'Invalid verdict')
            _require(isinstance(rating['reason'], str) and 0 < len(rating['reason'].strip()) <= 10000,
                     'Nonempty bounded review reason required')
        result[row['id']] = deepcopy(row['criteria'])
    _require(set(result) == ids, 'Review must cover exact blind IDs')
    return name, result


def _judgment(reviews):
    same = reviews[0]['verdict'] == reviews[1]['verdict']
    return {'reviews': reviews, 'consensus': {
        'verdict': reviews[0]['verdict'] if same else 'unknown',
        'reason': 'Both reviewers: ' + reviews[0]['verdict'] + '.' if same else 'Reviewers disagree.'},
        'disagreement': not same}


def _all_three(criteria):
    verdicts = [criteria[key]['verdict'] for key in CRITERIA]
    return 'fail' if 'fail' in verdicts else 'unknown' if 'unknown' in verdicts else 'pass'


def summarize(bundle_dir, review_a, review_b, output_dir):
    """Join two complete reviews; preserve each reason and report explicit unknowns."""
    _fresh(output_dir)
    audit, decoded = _load_bundle(bundle_dir)
    coverage = {k: v for k, v in audit['coverage'].items() if not k.endswith('_case_ids')}
    bodies = [_read(review_a), _read(review_b)]
    reviews = [_review(_parse(body), {r['id'] for r in decoded}) for body in bodies]
    names = [name for name, _ in reviews]
    _require(len(set(names)) == 2, 'Two distinct reviewer identities required')
    rows = []
    for source in decoded:
        row = {key: source[key] for key in ('id', 'case_id', 'category', 'family_id', 'condition')}
        row['criteria'] = {key: _judgment([{'reviewer': name, **by_id[source['id']][key]}
                                         for name, by_id in reviews]) for key in CRITERIA}
        all_reviews = [{'reviewer': name, 'verdict': _all_three(by_id[source['id']]),
                        'reason': '; '.join(key + ': ' + by_id[source['id']][key]['verdict'] for key in CRITERIA)}
                       for name, by_id in reviews]
        row['all_three'] = _judgment(all_reviews)
        rows.append(row)
    totals = []
    for reviewer in [*names, 'consensus']:
        for condition in CONDITIONS:
            for category in ('all', *CATEGORIES):
                selected = [r for r in rows if r['condition'] == condition and (category == 'all' or r['category'] == category)]
                for metric in (*CRITERIA, 'all_three'):
                    counts = Counter()
                    for row in selected:
                        item = row['all_three'] if metric == 'all_three' else row['criteria'][metric]
                        rating = item['consensus'] if reviewer == 'consensus' else next(r for r in item['reviews'] if r['reviewer'] == reviewer)
                        counts[rating['verdict']] += 1
                    totals.append({'reviewer': reviewer, 'condition': condition, 'category': category, 'metric': metric,
                        'numerator': counts['pass'], 'denominator': len(selected), 'fail': counts['fail'],
                        'unknown': counts['unknown'], 'known_denominator': counts['pass'] + counts['fail'],
                        'planned_denominator': 8 if category == 'all' else coverage['by_category'][category]['planned_family_count'],
                        'missing': (8 if category == 'all' else coverage['by_category'][category]['planned_family_count']) - len(selected)})
    summary = {'schema_version': 1, 'job_sha256': audit['job_sha256'], 'reviewers': names, 'rows': rows, 'totals': totals,
        'coverage': coverage,
        'primary': {'category': 'hint', 'metric': 'request_match', 'task_count': 4,
                    'planned_denominator': 4, 'observed_denominator': coverage['by_category']['hint']['observed_family_count'],
                    'counts': [t for t in totals if t['category'] == 'hint' and t['metric'] == 'request_match']},
        'counting': 'denominator is observed responses including review unknowns; missing execution has no verdict. Planned: eight paired families and forty responses.',
        'all_three_rule': 'Each reviewer: fail if any criterion fails, otherwise unknown if any unknown, otherwise pass. Consensus only on matching reviewer verdicts.'}
    output_audit = _write_bundle(output_dir, {'summary.json': summary,
        'private/review-a.json': _parse(bodies[0]), 'private/review-b.json': _parse(bodies[1])},
        {'schema_version': 1, 'kind': 'observer_generation_review_summary', 'complete': audit['complete'],
         'bundle_complete': True, 'coverage': audit['coverage'],
         'job_sha256': audit['job_sha256'], 'prepare_audit_sha256': audit['audit_sha256'],
         'review_files_sha256': dict(zip(names, map(_hash, bodies))),
         'implementation_sha256': _hash(_read(__file__))})
    return {'summary': summary, 'audit': output_audit}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('prepare', help='Verify complete outputs and create a fresh blind/private bundle')
    for name in ('job', 'join', 'protocol', 'archive', 'output'):
        p.add_argument(name, type=Path)
    p.add_argument('--cache-dir', type=Path, required=True)
    p.add_argument('--shuffle-seed', type=int, default=1729)
    p.add_argument('--allow-partial', action='store_true', help='Admit verified durable complete five-condition groups only')
    p = commands.add_parser('summarize', help='Aggregate two complete independent review files')
    for name in ('bundle', 'review_a', 'review_b', 'output'):
        p.add_argument(name, type=Path)
    args = parser.parse_args(argv)
    if args.command == 'prepare':
        audit = prepare(args.job, args.join, args.protocol, args.archive, args.output,
                        cache_dir=args.cache_dir, shuffle_seed=args.shuffle_seed, allow_partial=args.allow_partial)
    else:
        audit = summarize(args.bundle, args.review_a, args.review_b, args.output)['audit']
    # Do not print generated text or the private condition mapping into logs.
    print(json.dumps({'output_dir': str(args.output), 'audit_sha256': audit['audit_sha256']}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
