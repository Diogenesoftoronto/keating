"""Stage 1: immutable paired plans, independent review gates, and missingness-aware reports.

No inference, episode execution, source downloads, or generated assessments.
The CLI replays native_scenarios admission against every pinned cached source.
"""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import json
import math
import os
from pathlib import Path
import random
import re
import statistics

import native_scenarios as native

CONDITIONS = ('chat', 'interactive')
SITUATIONS = 30
REPLICATES = 3
STATUSES = ('started', 'complete', 'learner_stop', 'tutor_failure', 'provider_failure',
            'invalid_learner_action', 'delivery_failure', 'budget_exhausted', 'assessment_unavailable')
FAILURES = set(STATUSES) - {'started', 'complete', 'learner_stop', 'assessment_unavailable'}
HASH = re.compile(r'[0-9a-f]{64}')
digest = native.digest


def require(condition, message):
    if not condition:
        raise ValueError(message)


def keys(value, expected):
    require(isinstance(value, dict) and set(value) == set(expected), 'Unexpected or missing fields')


def text(value):
    require(isinstance(value, str) and bool(value.strip()), 'Expected nonempty text')


def hash_value(value):
    require(isinstance(value, str) and HASH.fullmatch(value), 'Expected SHA-256')


def sealed(value, field):
    value = deepcopy(value)
    value[field] = digest(value)
    return value


def check_seal(value, field):
    require(isinstance(value, dict) and value.get(field) == digest({k: v for k, v in value.items() if k != field}),
            f'{field} mismatch')


def validate_configuration(config):
    keys(config, ('authors', 'seed', 'actor', 'learner', 'runtime', 'rubric', 'limits', 'conditions'))
    require(isinstance(config['authors'], list) and bool(config['authors']), 'Declare adaptation/configuration authors')
    for author in config['authors']:
        text(author)
    require(type(config['seed']) is int and 0 <= config['seed'] < 2**32, 'Invalid paired seed')
    for role in ('actor', 'learner'):
        pin = config[role]
        keys(pin, ('model', 'revision', 'prompt_sha256', 'sampler'))
        text(pin['model'])
        text(pin['revision'])
        hash_value(pin['prompt_sha256'])
        keys(pin['sampler'], ('temperature', 'top_p', 'max_tokens'))
        for name, low, high in (('temperature', 0, 2), ('top_p', 0, 1)):
            value = pin['sampler'][name]
            require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high,
                    'Invalid sampler')
        require(pin['sampler']['top_p'] > 0, 'Invalid top_p')
        require(type(pin['sampler']['max_tokens']) is int and pin['sampler']['max_tokens'] > 0,
                'Invalid token limit')
    keys(config['runtime'], ('revision',))
    text(config['runtime']['revision'])
    keys(config['rubric'], ('revision', 'sha256', 'metrics'))
    text(config['rubric']['revision'])
    hash_value(config['rubric']['sha256'])
    require(isinstance(config['rubric']['metrics'], list) and bool(config['rubric']['metrics']), 'Declare metrics')
    metric_ids = set()
    for metric in config['rubric']['metrics']:
        keys(metric, ('id', 'definition', 'unit', 'minimum', 'maximum'))
        for field in ('id', 'definition', 'unit'):
            text(metric[field])
        require(re.fullmatch(r'[a-z][a-z0-9_]*', metric['id']) and metric['id'] not in metric_ids,
                'Invalid/duplicate metric identity')
        metric_ids.add(metric['id'])
        require(all(type(metric[k]) in (int, float) and math.isfinite(metric[k]) for k in ('minimum', 'maximum'))
                and metric['minimum'] < metric['maximum'], 'Invalid metric range')
    caps = {'max_decisions': 6, 'max_sessions': 2, 'max_provider_calls': 12,
            'max_tool_calls': 16, 'max_repairs': 1, 'turn_timeout_ms': 120000, 'learner_timeout_ms': 120000}
    keys(config['limits'], caps)
    for name, maximum in caps.items():
        require(type(config['limits'][name]) is int and 1 <= config['limits'][name] <= maximum,
                'Invalid Stage 1 limit')
    keys(config['conditions'], CONDITIONS)
    for condition in CONDITIONS:
        contract = config['conditions'][condition]
        keys(contract, ('surface', 'tool_schema_sha256', 'learner_actions'))
        require(contract['surface'] == condition, 'Surface/condition mismatch')
        hash_value(contract['tool_schema_sha256'])
        actions = [] if condition == 'chat' else ['submit-answer', 'choose-option', 'update-notes']
        require(contract['learner_actions'] == actions, 'Unexpected condition actions')
    # Also rejects NaN in any otherwise opaque text/JSON field.
    digest(config)
    return config


def family_clusters(families):
    """Union the FULL census, including unselected records that connect aliases."""
    parents = {}

    def root(item):
        parents.setdefault(item, item)
        while parents[item] != item:
            parents[item] = parents[parents[item]]
            item = parents[item]
        return item

    for family in families:
        names = [family['family'], *family['aliases']]
        for name in names:
            text(name)
        for name in names[1:]:
            a, b = root(names[0]), root(name)
            parents[max(a, b)] = min(a, b)
        root(names[0])
    return {name: root(name) for name in parents}


def select_situations(bundle, selected_ids=None):
    """Select evidence only, before any runnable policy configuration is available."""
    require(bundle.get('schema_version') == 1 and bundle.get('purpose') == 'development',
            'Only an admitted development bundle can enter Stage 1')
    clusters = family_clusters(bundle['families'])
    audit = {f['family']: f for f in bundle['families']}
    candidates = {}
    for scenario in bundle['scenarios']:
        native.validate_native_scenario(scenario)
        require(scenario['id'] not in candidates, 'Duplicate scenario ID')
        family = audit.get(scenario['family'])
        decision = scenario['evaluation_only'].get('admission')
        require(family is not None and isinstance(decision, dict) and decision.get('purpose') == 'development'
                and decision == family['decision'], 'Missing development family admission')
        # Already-exposed TutorMoments benchmark families are admitted upstream;
        # a TEST/validation sibling may never be authorized by that exception.
        require(not any(m['original_split'] in ('test', 'validation') for m in family['members']),
                'Test/validation family is forbidden in the development pilot')
        candidates[scenario['id']] = scenario
    if selected_ids is None:
        groups = defaultdict(list)
        for scenario in sorted(candidates.values(), key=lambda s: s['id']):
            groups[scenario['source']['dataset']].append(scenario['id'])
        ordered = []
        while any(groups.values()):
            for name in sorted(groups):
                if groups[name]:
                    ordered.append(groups[name].pop(0))
    else:
        require(isinstance(selected_ids, list) and len(selected_ids) == SITUATIONS
                and len(set(selected_ids)) == SITUATIONS, 'Select exactly 30 distinct scenario IDs')
        require(set(selected_ids) <= set(candidates), 'Unadmitted scenario selection')
        ordered = sorted(selected_ids)
    # Prefer distinct origin families while round-robin ordering preserves
    # source coverage. Only reuse a family if fewer than 30 are available.
    if selected_ids is None:
        preferred, deferred, seen_clusters = [], [], set()
        for identity in ordered:
            cluster = clusters[candidates[identity]['family']]
            (deferred if cluster in seen_clusters else preferred).append(identity)
            seen_clusters.add(cluster)
        ordered = preferred + deferred
    chosen, seen_records, seen_evidence = [], set(), set()
    for identity in ordered:
        scenario = candidates[identity]
        source = scenario['source']
        record = (source['dataset'], source['revision'], source['record_id'])
        evidence = digest(native.normalized(scenario['actor']['opening_message']))
        # Repackaged identical situations are not new situations, even with new IDs.
        if record in seen_records or evidence in seen_evidence:
            require(selected_ids is None, 'Repeated source record or aliased initial situation')
            continue
        seen_records.add(record)
        seen_evidence.add(evidence)
        chosen.append({'id': identity, 'family': scenario['family'],
                       'cluster': clusters[scenario['family']], 'scenario_sha256': digest(scenario),
                       'initial_evidence_sha256': digest(native.public_views(scenario)),
                       'scenario': deepcopy(scenario)})
        if len(chosen) == SITUATIONS:
            break
    require(len(chosen) == SITUATIONS, 'Fewer than 30 distinct admitted development situations')
    chosen.sort(key=lambda s: s['id'])
    return chosen


def candidate_selection(bundle):
    chosen = select_situations(bundle)
    groups = defaultdict(list)
    for situation in chosen:
        groups[situation['cluster']].append(situation['id'])
    coverage = []
    for dataset in native.DATASETS:
        subset = [s for s in chosen if s['scenario']['source']['dataset'] == dataset]
        coverage.append({'dataset': dataset, 'selected_situations': len(subset),
                         'selected_source_families': len({s['cluster'] for s in subset}),
                         'admitted_pool': bundle['summary']['by_source'].get(dataset, {}).get('eligible', 0),
                         'rejected_reasons': bundle['summary']['by_source'].get(dataset, {}).get('rejected', {})})
    return sealed({'schema_version': 1, 'kind': 'native-stage1-candidates',
                   'source_bundle_sha256': digest(bundle), 'registry_sha256': bundle['registry_sha256'],
                   'selected_ids': [s['id'] for s in chosen],
                   'source_family_groups': [{'source_family': family, 'situation_ids': ids} for family, ids in sorted(groups.items())],
                   'coverage': coverage,
                   'reason': 'Deterministic source round-robin; prefer distinct origin families; exclude duplicate initial situations. Development admission replayed against all pinned cached sources.',
                   'status': 'candidates_only',
                   'required_before_dispatch': ['Exact runnable actor/learner/runtime/rubric/limits configuration',
                                                'Independent source-context and both format reviews']}, 'selection_sha256')


def build_pilot(bundle, configuration, selected_ids=None):
    """Pure planner; production callers first replay admission with load_admitted_bundle."""
    validate_configuration(configuration)
    chosen = select_situations(bundle, selected_ids)
    source_manifest = {'bundle_sha256': digest(bundle), 'registry_sha256': bundle['registry_sha256'],
                       'family_census_sha256': digest(bundle['families']),
                       'situations': [{k: s[k] for k in ('id', 'family', 'cluster', 'scenario_sha256', 'initial_evidence_sha256')}
                                      for s in chosen]}
    hashes = {name: digest(configuration[name]) for name in ('actor', 'learner', 'runtime', 'rubric', 'limits', 'conditions')}
    hashes.update(source=digest(source_manifest), configuration=digest(configuration))
    slots = []
    for situation in chosen:
        for replicate in range(REPLICATES):
            seed = int(digest([configuration['seed'], situation['id'], replicate])[:8], 16)
            for condition in CONDITIONS:
                slot = {'situation_id': situation['id'], 'cluster': situation['cluster'],
                        'condition': condition, 'replicate': replicate, 'paired_seed': seed,
                        'scenario_sha256': situation['scenario_sha256'],
                        'initial_evidence_sha256': situation['initial_evidence_sha256'],
                        'manifest_hashes': hashes}
                slots.append({'id': 'pilot-' + digest(slot)[:32], **deepcopy(slot)})
    return sealed({'schema_version': 1, 'kind': 'native-stage1-plan',
                   'design': {'situations': SITUATIONS, 'replicates': REPLICATES, 'conditions': list(CONDITIONS)},
                   'configuration': deepcopy(configuration), 'source_manifest': source_manifest,
                   'manifest_hashes': hashes, 'situations': chosen, 'slots': slots}, 'plan_sha256')


def load_admitted_bundle(path, cache=native.sources.CACHE, registry_path=native.REGISTRY):
    supplied = json.loads(Path(path).read_text())
    require(isinstance(supplied, dict) and supplied.get('purpose') == 'development', 'Expected development bundle')
    registry = native.load_registry(registry_path)
    originals = native.load_source_records(cache)
    exposures = native.read_exposure_ledger()['families']
    replay = native.build_native_scenarios(originals, registry, supplied.get('source'), 'development', exposures)
    require(supplied == replay, 'Cached source grounding/admission replay mismatch')
    return replay


def validate_pilot(plan, bundle):
    check_seal(plan, 'plan_sha256')
    expected = build_pilot(bundle, plan['configuration'], [s['id'] for s in plan['situations']])
    require(plan == expected, 'Plan changed: source, shared evidence, configuration, family or pairing mismatch')
    return plan


def review_template(plan):
    def pending(kind):
        flags = ('context_complete', 'initial_evidence_preserved') if kind == 'source' else ('format_suitable', 'initial_evidence_preserved')
        return {'approved': False, 'independent': False, 'reviewer': None, 'evidence': None,
                **dict.fromkeys(flags, False)}
    return {'schema_version': 1, 'plan_sha256': plan['plan_sha256'], 'situations': [
        {'id': s['id'], 'source_context': pending('source'),
         'formats': {condition: pending('format') for condition in CONDITIONS}} for s in plan['situations']]}


def evidence_reference(value):
    keys(value, ('uri', 'sha256'))
    text(value['uri'])
    hash_value(value['sha256'])


def prepare_dispatch(plan, reviews):
    """Return a gated dispatch specification. Never call a runner or provider."""
    check_seal(plan, 'plan_sha256')
    keys(reviews, ('schema_version', 'plan_sha256', 'situations'))
    require(reviews['schema_version'] == 1 and reviews['plan_sha256'] == plan['plan_sha256'], 'Review/plan mismatch')
    require(isinstance(reviews['situations'], list) and len(reviews['situations']) == SITUATIONS, 'Review all 30 situations')
    by_id = {r['id']: r for r in reviews['situations']}
    require(set(by_id) == {s['id'] for s in plan['situations']}, 'Missing or duplicate situation review')
    authors = set(plan['configuration']['authors'])
    authors.update(plan['configuration'][role]['model'] for role in ('actor', 'learner'))
    for situation in plan['situations']:
        review = by_id[situation['id']]
        keys(review, ('id', 'source_context', 'formats'))
        keys(review['formats'], CONDITIONS)
        for kind, check in [('source', review['source_context']), *[(c, review['formats'][c]) for c in CONDITIONS]]:
            flags = ('context_complete', 'initial_evidence_preserved') if kind == 'source' else ('format_suitable', 'initial_evidence_preserved')
            keys(check, ('approved', 'independent', 'reviewer', 'evidence', *flags))
            require(all(check[k] is True for k in ('approved', 'independent', *flags)), 'Independent source-context and format review required')
            text(check['reviewer'])
            require(check['reviewer'] not in authors, 'Reviewer must be independent of adaptation/policy authors')
            evidence_reference(check['evidence'])
    return sealed({'schema_version': 1, 'kind': 'native-stage1-dispatch', 'executes': False,
                   'plan_sha256': plan['plan_sha256'], 'reviews': deepcopy(reviews),
                   'manifest_hashes': deepcopy(plan['manifest_hashes']), 'slots': deepcopy(plan['slots'])}, 'dispatch_sha256')


def paired_bootstrap(rows, samples=2000, seed=42):
    """Rows are SITUATION means. Resample whole alias-family blocks, never replicas."""
    require(type(samples) is int and 100 <= samples <= 20000, 'Bootstrap samples must be 100-20000')
    groups = defaultdict(list)
    for row in rows:
        groups[row['cluster']].append(row['delta'])
    blocks = [groups[key] for key in sorted(groups)]
    if not blocks:
        return {'situations': 0, 'families': 0, 'situation_weighted': None, 'family_weighted': None,
                'ci95_situation_weighted': None, 'ci95_family_weighted': None, 'reason': 'no_paired_outcomes'}
    result = {'situations': len(rows), 'families': len(blocks),
              'situation_weighted': statistics.mean(r['delta'] for r in rows),
              'family_weighted': statistics.mean(statistics.mean(b) for b in blocks),
              'ci95_situation_weighted': None, 'ci95_family_weighted': None,
              'reason': 'fewer_than_two_independent_families' if len(blocks) < 2 else None}
    if len(blocks) < 2:
        return result
    rng = random.Random(seed)
    situation_draws, family_draws = [], []
    for _ in range(samples):
        selected = [blocks[rng.randrange(len(blocks))] for _ in blocks]
        situation_draws.append(statistics.mean(value for block in selected for value in block))
        family_draws.append(statistics.mean(statistics.mean(block) for block in selected))
    for name, draws in (('situation', situation_draws), ('family', family_draws)):
        draws.sort()
        result[f'ci95_{name}_weighted'] = [draws[int((samples - 1) * .025)], draws[int((samples - 1) * .975)]]
    return result


def report_pilot(plan, attempts, outcomes, dispatch=None, samples=2000, seed=42):
    check_seal(plan, 'plan_sha256')
    require(isinstance(attempts, list) and isinstance(outcomes, list), 'Attempt/outcome arrays required')
    if attempts:
        require(dispatch is not None, 'Attempts require a reviewed dispatch specification')
    if dispatch is not None:
        require(dispatch == prepare_dispatch(plan, dispatch['reviews']), 'Dispatch integrity mismatch')
    slots = {s['id']: s for s in plan['slots']}
    situations = {s['id']: s for s in plan['situations']}
    actual = {}
    for attempt in attempts:
        keys(attempt, ('slot_id', 'plan_sha256', 'dispatch_sha256', 'manifest_hashes',
                       'scenario_sha256', 'initial_evidence_sha256', 'status', 'receipt'))
        identity = attempt['slot_id']
        require(identity in slots and identity not in actual, 'Unknown or duplicate attempted slot')
        slot = slots[identity]
        require(attempt['plan_sha256'] == plan['plan_sha256'] and attempt['dispatch_sha256'] == dispatch['dispatch_sha256'],
                'Attempt experiment binding mismatch')
        for field in ('manifest_hashes', 'scenario_sha256', 'initial_evidence_sha256'):
            require(attempt[field] == slot[field], 'Attempt changed a frozen manifest or shared initial evidence')
        require(attempt['status'] in STATUSES, 'Unknown attempt status')
        if attempt['status'] != 'started' or attempt['receipt'] is not None:
            evidence_reference(attempt['receipt'])
        actual[identity] = attempt
    metrics = {m['id']: m for m in plan['configuration']['rubric']['metrics']}
    assessed = {}
    for outcome in outcomes:
        keys(outcome, ('slot_id', 'metric', 'value', 'assessor', 'independent', 'evidence', 'rubric_sha256'))
        key = (outcome['slot_id'], outcome['metric'])
        require(key not in assessed and key[0] in actual and key[1] in metrics, 'Unknown/duplicate assessment or unattempted outcome')
        require(outcome['rubric_sha256'] == plan['manifest_hashes']['rubric'], 'Assessment rubric changed')
        value = outcome['value']
        if value is not None:
            metric = metrics[key[1]]
            require(actual[key[0]]['status'] != 'started', 'Unfinished attempt has no assessed outcome')
            require(type(value) in (int, float) and math.isfinite(value)
                    and metric['minimum'] <= value <= metric['maximum'], 'Invalid assessed value')
            text(outcome['assessor'])
            require(outcome['independent'] is True and outcome['assessor'] not in
                    {plan['configuration'][r]['model'] for r in ('actor', 'learner')}, 'Independent assessment required')
            evidence_reference(outcome['evidence'])
        assessed[key] = value
    denominator = []
    for condition in CONDITIONS:
        for dataset in ['all', *sorted({s['scenario']['source']['dataset'] for s in situations.values()})]:
            selected = [s for s in slots.values() if s['condition'] == condition and
                        (dataset == 'all' or situations[s['situation_id']]['scenario']['source']['dataset'] == dataset)]
            statuses = Counter(actual[s['id']]['status'] for s in selected if s['id'] in actual)
            denominator.append({'condition': condition, 'dataset': dataset, 'planned': len(selected),
                                'attempted': sum(statuses.values()), 'unattempted': len(selected) - sum(statuses.values()),
                                'failures': sum(statuses[s] for s in FAILURES), 'unresolved': statuses['started'],
                                'statuses': dict(statuses)})
    results = {}
    for metric_id in metrics:
        cells = {(s['situation_id'], s['replicate'], s['condition']): assessed.get((s['id'], metric_id)) for s in slots.values()}
        rows = []
        for situation in situations.values():
            pairs = [(cells[(situation['id'], r, 'chat')], cells[(situation['id'], r, 'interactive')]) for r in range(REPLICATES)]
            complete = [(a, b) for a, b in pairs if a is not None and b is not None]
            rows.append({'situation_id': situation['id'], 'cluster': situation['cluster'],
                         'dataset': situation['scenario']['source']['dataset'], 'paired_replicates': len(complete),
                         'chat': statistics.mean(a for a, _ in complete) if complete else None,
                         'interactive': statistics.mean(b for _, b in complete) if complete else None,
                         'delta': statistics.mean(b - a for a, b in complete) if complete else None})
        available = [r for r in rows if r['delta'] is not None]
        family_rows = []
        for family in sorted({s['cluster'] for s in situations.values()}):
            family_situations = [r for r in rows if r['cluster'] == family]
            observed = [r for r in family_situations if r['delta'] is not None]
            family_slots = [s for s in slots.values() if s['cluster'] == family]
            family_rows.append({'source_family': family,
                                'situation_ids': [r['situation_id'] for r in family_situations],
                                'planned_slots': len(family_slots),
                                'attempted_slots': sum(s['id'] in actual for s in family_slots),
                                'known_outcomes': sum(assessed.get((s['id'], metric_id)) is not None for s in family_slots),
                                'unknown_outcomes': sum(assessed.get((s['id'], metric_id)) is None for s in family_slots),
                                'paired_replicates': sum(r['paired_replicates'] for r in family_situations),
                                'available_pair_effect': statistics.mean(r['delta'] for r in observed) if observed else None,
                                'full_family_effect': statistics.mean(r['delta'] for r in family_situations)
                                if all(r['paired_replicates'] == REPLICATES for r in family_situations) else None})
        arm_counts = {c: {'planned': sum(s['condition'] == c for s in slots.values()),
                          'known': sum(assessed.get((s['id'], metric_id)) is not None for s in slots.values() if s['condition'] == c),
                          'unknown': sum(assessed.get((s['id'], metric_id)) is None for s in slots.values() if s['condition'] == c)} for c in CONDITIONS}
        results[metric_id] = {'outcomes': arm_counts, 'paired_replicates': sum(r['paired_replicates'] for r in rows),
                              'complete_situations': sum(r['paired_replicates'] == REPLICATES for r in rows),
                              'full_pilot_effect': statistics.mean(r['delta'] for r in rows)
                              if all(r['paired_replicates'] == REPLICATES for r in rows) else None,
                              'available_pairs': paired_bootstrap(available, samples, seed),
                              'situations': rows, 'source_family_groups': family_rows}
    return sealed({'schema_version': 1, 'kind': 'native-stage1-report', 'plan_sha256': plan['plan_sha256'],
                   'planned': len(slots), 'attempted': len(actual), 'unattempted': len(slots) - len(actual),
                   'source_situations': len(situations), 'source_families': len({s['cluster'] for s in situations.values()}),
                   'denominators': denominator, 'metrics': results, 'bootstrap': {'samples': samples, 'seed': seed,
                   'unit': 'whole source-family blocks of paired situation means', 'interval': 'percentile 95%'},
                   'input_hashes': {'attempts': digest(attempts), 'outcomes': digest(outcomes),
                                    'dispatch': dispatch['dispatch_sha256'] if dispatch else None},
                   'limitations': ['Available-pair effects are conditional on observed pairs; missing outcomes remain unknown.',
                                   'Replicates and aliased source records are not independent people.',
                                   'Recorded execution and synthetic assessments do not establish human learning.']}, 'report_sha256')


def write_outputs(directory, values):
    # Reuse admission output constraints; resolve symlinks AND bind to workspace.
    root = native.ROOT.resolve()
    require(not (native.ROOT / '.keating').is_symlink(), 'Symlinked output root')
    directory = native.output_directory(directory)
    require(directory.is_relative_to(root / '.keating'), 'Output escapes workspace')
    directory.mkdir(parents=True, exist_ok=False)
    for name, value in values.items():
        with (directory / name).open('x', encoding='utf-8') as handle:
            os.chmod(handle.name, 0o600)
            handle.write(native.canonical(value) + '\n')
    return directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('candidates', 'plan', 'validate', 'ready', 'report'))
    parser.add_argument('--scenarios', type=Path, required=True, help='Full admitted development scenarios.json bundle')
    parser.add_argument('--configuration', type=Path)
    parser.add_argument('--selection', type=Path, help='Optional JSON array of exactly 30 admitted IDs')
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--reviews', type=Path)
    parser.add_argument('--dispatch', type=Path)
    parser.add_argument('--attempts', type=Path)
    parser.add_argument('--outcomes', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--cache', type=Path, default=native.sources.CACHE)
    parser.add_argument('--registry', type=Path, default=native.REGISTRY)
    parser.add_argument('--bootstrap', type=int, default=2000)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    read = lambda p: json.loads(p.read_text())
    if args.command != 'validate' and args.output is None:
        parser.error('--output is required')
    if args.command == 'plan' and args.configuration is None:
        parser.error('plan requires --configuration')
    if args.command not in ('candidates', 'plan') and args.plan is None:
        parser.error('--plan is required')
    if args.command == 'ready' and args.reviews is None:
        parser.error('ready requires --reviews')
    bundle = load_admitted_bundle(args.scenarios, args.cache, args.registry)
    if args.command == 'candidates':
        selection = candidate_selection(bundle)
        write_outputs(args.output, {'candidates.json': selection, 'selected-ids.json': selection['selected_ids']})
        print(json.dumps({'command': 'candidates', 'selected': len(selection['selected_ids']),
                          'source_families': len(selection['source_family_groups']), 'executes': False}))
        return
    if args.command == 'plan':
        plan = build_pilot(bundle, read(args.configuration), read(args.selection) if args.selection else None)
        write_outputs(args.output, {'plan.json': plan, 'reviews.json': review_template(plan)})
    else:
        plan = validate_pilot(read(args.plan), bundle)
        if args.command == 'ready':
            value = prepare_dispatch(plan, read(args.reviews))
            write_outputs(args.output, {'dispatch.json': value})
        elif args.command == 'report':
            value = report_pilot(plan, read(args.attempts) if args.attempts else [],
                                 read(args.outcomes) if args.outcomes else [],
                                 read(args.dispatch) if args.dispatch else None, args.bootstrap, args.seed)
            write_outputs(args.output, {'report.json': value})
    print(json.dumps({'command': args.command, 'plan_sha256': plan['plan_sha256'],
                      'planned_slots': len(plan['slots']), 'executes': False}))


if __name__ == '__main__':
    main()
