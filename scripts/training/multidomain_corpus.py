"""Offline contracts for source-grounded, profiled teaching data across domains.

Generation is in agy_multidomain.py. Exports are candidates, never runtime receipts.
"""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import native_data_expansion as contextual

VERSION = 'keating-multidomain/v1'
MODEL = contextual.MODEL
EXECUTION_PROFILES = {
    'agy': {phase: {'engine': 'agy', 'model': MODEL} for phase in ('draft', 'review')},
    'crush-minimax': {phase: {'engine': 'crush', 'model': 'minimax/MiniMax-M3'} for phase in ('draft', 'review')},
    'crush-deepseek': {phase: {'engine': 'crush', 'model': 'hyper/deepseek-v4.1-flash'} for phase in ('draft', 'review')},
}
ROOT = Path(__file__).resolve().parents[2]
DOMAINS = ('history', 'biology', 'ml', 'geology', 'philosophy', 'chemistry', 'physics',
           'computer-science', 'statistics', 'economics', 'psychology', 'literature',
           'writing', 'civics', 'environmental-science', 'music')
FIT = contextual.FIT
NEED = contextual.NEED
MOVES = {'explanation', 'hint', 'question', 'feedback', 'answer', 'claim', 'other'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    with Path(path).open('x') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fields(value, names):
    require(isinstance(value, dict) and set(value) == set(names.split()), 'Unexpected fields: ' + names)


def text(value):
    require(isinstance(value, str) and bool(value.strip()), 'Nonempty text required')


def texts(value):
    require(isinstance(value, list) and bool(value), 'Nonempty text list required')
    for item in value:
        text(item)


def execution_profile(manifest):
    value = manifest.get('execution', EXECUTION_PROFILES['agy'])
    require(value in EXECUTION_PROFILES.values(), 'Unapproved execution profile')
    return deepcopy(value)


def prepare_multidomain(catalog, output, profile='agy', shard_index=0, shard_count=1, families_per_batch=5, priority_domain=None):
    """Freeze source-group splits, task family IDs and profile IDs before drafting."""
    cards = read(catalog)['sources']
    counts = Counter(c['domain'] for c in cards)
    require(bool(counts) and set(counts) <= set(DOMAINS) and all(n == 20 for n in counts.values()),
            'Plan requires twenty grounded source groups per selected domain')
    domains = [d for d in DOMAINS if d in counts]
    require(families_per_batch in (1, 5), 'One or five families per generation job')
    require(priority_domain is None or priority_domain in domains, 'Unknown priority domain')
    if priority_domain:
        domains.remove(priority_domain); domains.insert(0, priority_domain)
    require(len({c['id'] for c in cards}) == len(cards), 'Duplicate source group')
    require(len({c['url'] for c in cards}) == len(cards), 'Source reused across groups')
    require(type(shard_count) is int and 1 <= shard_count <= 2 and type(shard_index) is int
            and 0 <= shard_index < shard_count, 'Invalid worker partition')
    output = Path(output).resolve()
    require(output.is_relative_to(ROOT / '.keating/outputs'), 'Use ignored research output directory')
    output.mkdir(parents=True, exist_ok=False)
    require(profile in EXECUTION_PROFILES, 'Unknown execution profile')
    manifest = {'version': VERSION, 'execution': deepcopy(EXECUTION_PROFILES[profile]), 'catalog_sha256': digest(read(catalog)),
                'batches': {}, 'families': {}, 'partition': {'index': shard_index, 'count': shard_count},
                'source_terms': {}, 'protected_pins': {}, 'domains': domains,
                'families_per_batch': families_per_batch, 'pilot_batches': {},
                'checkpoint_batches': 5 if families_per_batch == 1 else 1}
    schedule = []
    for path in sorted((ROOT / 'scripts/training/benchmarks').glob('teaching-v*/**/cases.json')):
        manifest['protected_pins'][str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    for domain in domains:
        ordered = sorted((c for c in cards if c['domain'] == domain), key=lambda c: digest(['split-v1', c['id']]))
        for index, card in enumerate(ordered):
            if index % shard_count != shard_index:
                continue
            require(card['text_sha256'] == hashlib.sha256(card['text'].encode()).hexdigest(), 'Source text changed')
            require(len(card['text']) >= 1000, 'Insufficient grounding')
            split = 'train' if index < 16 else 'calibration' if index < 18 else 'test'
            batch = f'{domain}-{index:02}'
            families = [{'id': f'md-{batch}-f{i:02}', 'profile_ids': [f'md-{batch}-f{i:02}-p{p}' for p in (1, 2)]}
                        for i in range(1, 6)]
            group_batches = []
            for offset in range(0, 5, families_per_batch):
                selected = families[offset:offset + families_per_batch]
                job = batch if families_per_batch == 5 else f'{batch}-f{offset + 1:02}'
                packet = {'version': VERSION, 'batch_id': job, 'domain': domain,
                          'source': card, 'families': selected, 'examples_per_profile': 10}
                if families_per_batch == 1:
                    packet['task_focus'] = ('identify and distinguish concepts', 'explain a mechanism or argument',
                        'apply the concept to a new case', 'diagnose and revise a flawed attempt',
                        'compare alternatives and justify a choice')[offset]
                for family in selected:
                    manifest['families'][family['id']] = {'split': split, 'source_group': card['id'],
                        'domain': domain, 'profile_ids': family['profile_ids'], 'batch_id': job}
                manifest['batches'][job] = digest(packet)
                write(output / f'{job}.input.json', packet)
                schedule.append((index, offset, domains.index(domain), job))
                group_batches.append(job)
            manifest['pilot_batches'].setdefault(domain, group_batches)
            manifest['source_terms'][card['id']] = {k: card[k] for k in ('url', 'license', 'attribution', 'usage_lane')}
    manifest['batch_order'] = [row[-1] for row in sorted(schedule)]
    groups = len(manifest['source_terms'])
    manifest['target'] = {'contrasts': groups * 100, 'task_families': groups * 5,
                          'source_groups': groups, 'profiles': groups * 10}
    manifest['manifest_sha256'] = digest(manifest)
    write(output / 'manifest.json', manifest)
    return manifest['target']


def load_packet(directory, batch):
    directory = Path(directory)
    manifest = read(directory / 'manifest.json')
    check = deepcopy(manifest); expected = check.pop('manifest_sha256')
    require(digest(check) == expected, 'Manifest changed')
    require(batch in manifest['batches'], 'Unknown batch')
    packet = read(directory / f'{batch}.input.json')
    require(digest(packet) == manifest['batches'][batch], 'Source packet changed')
    return manifest, packet


def question_document(task, identity):
    fields(task, 'title material questions')
    text(task['title']); text(task['material'])
    require(isinstance(task['questions'], list) and 1 <= len(task['questions']) <= 4, 'One to four questions')
    nodes = []
    for question in task['questions']:
        expected = 'id kind prompt choices' if question.get('kind') == 'choice' else 'id kind prompt'
        fields(question, expected)
        require(re.fullmatch(r'[a-z][a-z0-9-]{0,39}', question['id']), 'Question ID')
        require(question['kind'] in {'choice', 'text'}, 'Supported native question type')
        text(question['prompt'])
        node = {'type': 'question', **deepcopy(question)}
        if question['kind'] == 'choice':
            require(isinstance(question['choices'], list) and 2 <= len(question['choices']) <= 6, 'Choice count')
            for choice in question['choices']:
                fields(choice, 'id label'); text(choice['id']); text(choice['label'])
            require(len({c['id'] for c in question['choices']}) == len(question['choices']), 'Duplicate option')
            node['allowText'] = False
        nodes.append(node)
    require(len({n['id'] for n in nodes}) == len(nodes), 'Duplicate question')
    return {'schemaVersion': 1, 'id': identity, 'revision': 0, 'lifecycle': 'ready',
            'supportedSurfaces': ['terminal', 'web'], 'title': task['title'], 'description': task['material'],
            'createdAt': '2026-09-15T00:00:00.000Z', 'updatedAt': '2026-09-15T00:00:00.000Z', 'nodes': nodes}


def validate_contrast(example):
    fields(example, 'slot prefix response fit need substantive correct grade spans rationale')
    require(type(example['slot']) is int and 1 <= example['slot'] <= 10, 'Invalid slot')
    require(example['fit'] in FIT and example['need'] in NEED, 'Classification')
    require(all(x is None or type(x) is bool for x in (example['correct'], example['substantive'])), 'Boolean or unknown')
    grade = (None if example['fit'] == 'unknown' or example['need'] == 'unknown'
             or example['correct'] is None or example['substantive'] is None else
             0 if example['fit'] != 'appropriate' or not example['correct'] else 2 if example['substantive'] else 1)
    require(example['grade'] == grade and (grade is None or type(example['grade']) is int), 'Inconsistent grade')
    require(isinstance(example['prefix'], list) and example['prefix'] and len(example['prefix']) <= 12, 'Bounded prefix')
    for turn in example['prefix']:
        fields(turn, 'role content'); text(turn['content'])
        require(turn['role'] in {'user', 'assistant'}, 'Only authored conversation context')
    require(example['prefix'][-1]['role'] == 'user', 'End with learner')
    text(example['response']); text(example['rationale'])
    require(isinstance(example['spans'], list) and bool(example['spans']), 'Localization required')
    for span in example['spans']:
        fields(span, 'text move fit correct reason')
        text(span['text']); text(span['reason'])
        require(example['response'].count(span['text']) == 1, 'Exact unique span')
        require(span['move'] in MOVES and span['fit'] in FIT, 'Span category')
        require(span['correct'] is None or type(span['correct']) is bool, 'Span correctness')


def validate_multidomain_draft(draft, packet):
    fields(draft, 'version batch_id families')
    require(draft['version'] == VERSION and draft['batch_id'] == packet['batch_id'], 'Draft identity')
    planned = {f['id']: f for f in packet['families']}
    require(isinstance(draft['families'], list) and len(draft['families']) == len(planned)
            and {f['id'] for f in draft['families']} == set(planned), 'Every planned family exactly once')
    for family in draft['families']:
        fields(family, 'id status reason task grounding strategy assessment profiles')
        text(family['reason'])
        require(family['status'] in {'ready', 'deferred'}, 'Family status')
        if family['status'] == 'deferred':
            require(family['profiles'] == [] and family['task'] is None and family['assessment'] is None
                    and family['grounding'] == [] and family['strategy'] is None, 'Deferred family has data')
            continue
        question_document(family['task'], family['id'])
        texts(family['strategy'])
        fields(family['assessment'], 'criteria acceptable_answers pitfalls')
        for value in family['assessment'].values():
            texts(value)
        require(isinstance(family['grounding'], list) and bool(family['grounding']), 'Source evidence required')
        for citation in family['grounding']:
            fields(citation, 'claim quote'); text(citation['claim']); text(citation['quote'])
            require(citation['quote'] in packet['source']['text'], 'Invented source quotation')
        require(len(family['profiles']) == 2 and {p['id'] for p in family['profiles']} == set(planned[family['id']]['profile_ids']), 'Two planned profiles')
        for profile in family['profiles']:
            fields(profile, 'id goal prior_evidence assumptions opening examples')
            text(profile['goal']); text(profile['opening']); texts(profile['assumptions'])
            require(isinstance(profile['prior_evidence'], list) and bool(profile['prior_evidence']), 'Evidence required')
            for evidence in profile['prior_evidence']:
                fields(evidence, 'text visibility'); text(evidence['text'])
                require(evidence['visibility'] in {'actor', 'learner'}, 'Evidence visibility')
            examples = profile['examples']
            require(len(examples) == 10 and {e['slot'] for e in examples} == set(range(1, 11)), 'Ten distinct contrasts per profile')
            for example in examples:
                validate_contrast(example)
            # No meaning is attached to slot numbers: avoid batch/slot label shortcuts.
            require(any(e['grade'] == 1 for e in examples), 'Include appropriate restraint')
            require(any(e['need'] == 'explanation' and e['grade'] == 2 for e in examples), 'Include warranted explanation')
            require(any(e['fit'] == 'overhelp' for e in examples) and any(e['fit'] == 'underhelp' for e in examples), 'Both intervention errors')
            require(any(len(e['spans']) >= 2 for e in examples), 'Include multiple pedagogical moves')
    return draft


def validate_multidomain_review(review, draft, packet, expected_model=MODEL):
    fields(review, 'version model batch_id draft_sha256 source_sha256 families')
    require(review['version'] == VERSION and review['model'] == expected_model and review['batch_id'] == packet['batch_id'], 'Review identity')
    require(review['draft_sha256'] == digest(draft) and review['source_sha256'] == packet['source']['text_sha256'], 'Review binding')
    require(len(review['families']) == len(draft['families']) and {f['id'] for f in review['families']} == {f['id'] for f in draft['families']}, 'Review membership')
    by_id = {f['id']: f for f in draft['families']}
    for decision in review['families']:
        fields(decision, 'id approved reason checks examples')
        require(type(decision['approved']) is bool, 'Review decision'); text(decision['reason'])
        fields(decision['checks'], 'grounded domain_correct pedagogy natural_learner profiles public_private openui localization')
        require(all(type(v) is bool for v in decision['checks'].values()), 'Review checks')
        family = by_id[decision['id']]
        require(not decision['approved'] or (family['status'] == 'ready' and all(decision['checks'].values())), 'Approved despite failure')
        identities = {f"{p['id']}-c{e['slot']:02}" for p in family['profiles'] for e in p['examples']}
        require(len(decision['examples']) == len(identities) and {e['id'] for e in decision['examples']} == identities, 'Per-example review required')
        for example in decision['examples']:
            fields(example, 'id approved reason'); text(example['reason'])
            require(type(example['approved']) is bool, 'Example decision')
    return review


def native_scenario(family, profile, packet, member):
    """Construct explicit public/learner/private views from allowlisted fields."""
    visible = [e['text'] for e in profile['prior_evidence'] if e['visibility'] == 'actor']
    opening = '\n'.join([*visible, profile['opening']])
    return {'schema_version': 1, 'id': profile['id'], 'family': family['id'],
        'source': {'dataset': VERSION, 'domain': packet['domain'], 'group': member['source_group'],
                   'origin': 'synthetic_source_grounded', 'url': packet['source']['url'],
                   'license': packet['source']['license'], 'usage_lane': packet['source']['usage_lane']},
        'actor': {'opening_message': opening}, 'initial_document': question_document(family['task'], family['id']),
        'learner': {'profile_evidence': deepcopy(profile['prior_evidence']),
                    'assumptions': [{'origin': 'authored_simulator_assumption', 'text': a} for a in profile['assumptions']] +
                                   [{'origin': 'authored_goal', 'text': profile['goal']}]},
        'evaluation_only': {'split': member['split'], 'assessment': deepcopy(family['assessment']),
                            'strategy': family['strategy'], 'grounding': family['grounding'],
                            'execution_status': 'not_executed'}}


def validate_native_documents(documents):
    """Call the production validator without modifying production or executing episodes."""
    result = subprocess.run(['rtk', 'proxy', 'bun', str(ROOT / 'scripts/training/validate_multidomain_documents.ts')],
        input=json.dumps(documents), text=True, capture_output=True, timeout=60, cwd=ROOT)
    require(result.returncode == 0, 'Production OpenUI validation failed: ' + result.stderr[-2000:])
    return json.loads(result.stdout)


def accepted_receipt(directory, batch, phase, payload_hash):
    manifest, packet = load_packet(directory, batch)
    expected = execution_profile(manifest)[phase]
    for path in sorted(Path(directory).glob(f'{batch}.{phase}.*.receipt.json'), reverse=True):
        receipt = read(path)
        if (receipt.get('validated') and receipt.get('exit_code') == 0 and receipt.get('output_digest') == payload_hash
                and receipt.get('input_digest') == digest(packet) and receipt.get('model') == expected['model']
                and receipt.get('engine', 'agy') == expected['engine']):
            return receipt
    raise ValueError('Missing successful validated generation receipt: ' + batch + '.' + phase)


def compile_multidomain(directory, output):
    """Only successful, reviewed jobs enter exports. Snapshot directories are immutable."""
    directory, output = Path(directory), Path(output)
    manifest = read(directory / 'manifest.json')
    execution = execution_profile(manifest)
    provenance = {'draft': execution['draft'], 'review': execution['review'],
                  'run_manifest_sha256': manifest['manifest_sha256']}
    for path, expected in manifest['protected_pins'].items():
        require(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, 'Protected benchmark changed; re-audit')
    contrasts, profiles, scenarios, observers, sft, rejected = [], [], [], [], [], []
    completed, seen_tasks = [], {}
    for batch in manifest['batches']:
        if not (directory / f'{batch}.review.json').exists():
            continue
        _, packet = load_packet(directory, batch)
        draft = validate_multidomain_draft(read(directory / f'{batch}.draft.json'), packet)
        review = validate_multidomain_review(read(directory / f'{batch}.review.json'), draft, packet, execution['review']['model'])
        accepted_receipt(directory, batch, 'draft', digest(draft))
        accepted_receipt(directory, batch, 'review', digest(review))
        decisions = {f['id']: f for f in review['families']}
        for family in draft['families']:
            decision = decisions[family['id']]
            if not decision['approved']:
                rejected.append({'id': family['id'], 'reason': decision['reason']}); continue
            member = manifest['families'][family['id']]
            # IDs and titles must not conceal duplicated actual exercises.
            fingerprint = digest([family['task']['material'], [
                [q['kind'], q['prompt'], [c['label'] for c in q.get('choices', [])]] for q in family['task']['questions']]])
            require(fingerprint not in seen_tasks, 'Duplicate task across families: ' + family['id'])
            seen_tasks[fingerprint] = family['id']
            accepted = {e['id'] for e in decision['examples'] if e['approved']}
            for profile in family['profiles']:
                scenario = native_scenario(family, profile, packet, member)
                scenario['source']['generation'] = deepcopy(provenance)
                scenarios.append(scenario)
                profiles.append({k: deepcopy(v) for k, v in profile.items() if k != 'examples'} |
                                {'family': family['id'], 'split': member['split'], 'domain': packet['domain'],
                                 'origin': 'authored_synthetic', 'generation': deepcopy(provenance)})
                # Text targets see the same public activity and disclosed profile evidence.
                doc = scenario['initial_document']
                material = '\n'.join([doc['title'], doc['description'], *[
                    n['prompt'] + '\n' + '\n'.join('('+c['id']+') '+c['label'] for c in n.get('choices', [])) for n in doc['nodes']]])
                source = {'scenario_id': profile['id'], 'opening_message': material + '\n' + scenario['actor']['opening_message'],
                          'source': scenario['source'] | {'attribution': packet['source']['attribution']}}
                for example in profile['examples']:
                    identity = f"{profile['id']}-c{example['slot']:02}"
                    if identity not in accepted:
                        rejected.append({'id': identity, 'reason': next(e['reason'] for e in decision['examples'] if e['id'] == identity)}); continue
                    row = {'id': identity, 'family': family['id'], 'split': member['split'], 'domain': packet['domain'],
                           'profile_id': profile['id'], 'source_group': member['source_group'], 'example': example,
                           'source': source['source'], 'review': {'hash': digest(review), 'model': execution['review']['model']}}
                    contrasts.append(row)
                    projected = contextual.projections(example, source, {'family': family['id'], 'split': member['split'], 'aliases': [member['source_group']]})
                    for record in projected:
                        record['parent_example_id'] = identity
                        record['source'] = 'source-grounded synthetic contrast; no runtime execution'
                        record['source_metadata'] = source['source']
                        for label in record['label_provenance'].values():
                            label['model'] = execution['review']['model']
                            label['draft_model'] = execution['draft']['model']
                            label['review_sha256'] = digest(review)
                        for annotation, span in zip(record['annotation_spans'], example['spans']):
                            annotation.update({k: span[k] for k in ('fit', 'correct', 'reason')})
                    observers.extend(projected)
                    candidate = contextual.sft_candidate(row, source)
                    if candidate:
                        sft.append(candidate | {'domain': packet['domain'], 'source_group': member['source_group']})
        completed.append(batch)
    require(bool(completed), 'No reviewed batches')
    validation = validate_native_documents([s['initial_document'] for s in scenarios])
    output.mkdir(parents=True, exist_ok=False)
    payloads = {'contrasts.json': contrasts, 'profiles.json': profiles, 'native-scenarios.json': scenarios,
                'observer-records.json': {'records': observers}, 'sft-candidates.json': {'examples': sft},
                'benchmark-scenarios.json': [s for s in scenarios if s['evaluation_only']['split'] == 'test'],
                'rejections.json': rejected}
    for name, value in payloads.items():
        write(output / name, value)
    report = {'version': VERSION, 'planned': manifest['target'], 'reviewed_batches': len(completed),
              'pending_batches': len(manifest['batches']) - len(completed), 'accepted_contrasts': len(contrasts),
              'profiles': len(profiles), 'native_scenarios': len(scenarios), 'sft_candidates': len(sft),
              'by_domain': dict(Counter(r['domain'] for r in contrasts)), 'by_split': dict(Counter(r['split'] for r in contrasts)),
              'by_fit': dict(Counter(r['example']['fit'] for r in contrasts)),
              'by_need': dict(Counter(r['example']['need'] for r in contrasts)),
              'by_usage_lane': dict(Counter(r['source']['usage_lane'] for r in contrasts)),
              'openui_validation': validation, 'execution': execution,
              'review_design': 'different-model review' if execution['draft']['model'] != execution['review']['model'] else 'same-model separate-session review',
              'status': 'model-reviewed synthetic candidates; no runtime or training execution',
              'files': {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in payloads}}
    write(output / 'report.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'compile'])
    parser.add_argument('input', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--execution-profile', choices=tuple(EXECUTION_PROFILES), default='agy')
    parser.add_argument('--shard-index', type=int, default=0)
    parser.add_argument('--shard-count', type=int, default=1)
    parser.add_argument('--families-per-batch', type=int, choices=(1, 5), default=5)
    parser.add_argument('--priority-domain', choices=DOMAINS)
    args = parser.parse_args()
    print(json.dumps(prepare_multidomain(args.input, args.output, args.execution_profile, args.shard_index, args.shard_count, args.families_per_batch, args.priority_domain) if args.command == 'prepare'
                     else compile_multidomain(args.input, args.output), indent=2))
