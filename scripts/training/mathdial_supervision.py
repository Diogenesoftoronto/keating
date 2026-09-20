"""Offline MathDial teacher-move supervision from verified full source conversations.

No inference, tokenizer, downloads, actor training or source-registry mutations.
The labels describe source teacher moves, not needs, correctness or learning.
"""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re

import benchmark_sources as sources
import native_scenarios as native
import observer_core as observer

VERSION = 'mathdial-source-moves-v1'
REVISION = 'acc3878459e0bd8c04ab840056572f0b8b1abe1f'
CLASSES = ('generic', 'focus', 'probing', 'telling')
TAG = re.compile(r'\((generic|focus|probing|telling)\)', re.I)
FIRST_TAG = re.compile(r'\s*\(([^)]+)\)')


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def load_snapshot(cache=sources.CACHE, registry=None, catalog=None):
    """Verify every overlap asset before selecting MathDial TRAIN material.

The injectable catalog is for independently pinned snapshots and authored tests;
the CLI always uses the repository catalog. Missing assets never mean no overlap.
"""
    registry = native.load_registry() if registry is None else registry
    native.validate_registry(registry)
    catalog = sources.source_catalog() if catalog is None else catalog
    selected = {s['id']: s for s in catalog if s['id'] in native.DATASETS}
    require(set(selected) == set(native.DATASETS), 'All five source snapshots required')
    require(registry['sources']['mathdial']['revision'] == REVISION, 'Unrecognized MathDial revision')
    assets = []
    for dataset in native.DATASETS:
        source, policy = selected[dataset], registry['sources'][dataset]
        require(source['revision'] == policy['revision'], 'Catalog/registry revision mismatch')
        files = {a['path']: a for a in source['files']}
        require(set(native.SPLITS[dataset]) <= files.keys(), 'Missing overlap assets')
        for path in native.SPLITS[dataset]:
            asset = files[path]
            require(asset['sha256'] == policy['assets'][path], 'Catalog/registry asset mismatch')
            body = sources.checked_bytes(source, asset, cache)
            assets.append({'dataset': dataset, 'path': path, 'revision': source['revision'],
                           'sha256': sha256(body), 'bytes': len(body)})
    records = native.load_source_records(cache, catalog)
    counts = Counter((r.dataset, r.asset) for r in records)
    for asset in assets:
        asset['records'] = counts[asset['dataset'], asset['path']]
    return records, assets


def family_groups(records, registry, person_aliases=None):
    """Reuse full native family census, never its opening-only scenario output."""
    closure = native.build_native_scenarios(records, registry, source='mathdial')
    audit = closure['families']
    parents = {}

    def root(key):
        parents.setdefault(key, key)
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key

    def merge(a, b):
        a, b = root(a), root(b)
        parents[max(a, b)] = min(a, b)

    for row in audit:
        for alias in (row['family'], *row['aliases']):
            merge(row['family'], alias)
    aliases = person_aliases or {'schema_version': 1,
        'base_native_registry_sha256': native.digest(registry), 'groups': []}
    require(set(aliases) == {'schema_version', 'base_native_registry_sha256', 'groups'}
            and type(aliases['schema_version']) is int and aliases['schema_version'] == 1,
            'Invalid person alias envelope')
    require(aliases['base_native_registry_sha256'] == native.digest(registry), 'Stale person aliases')
    require(isinstance(aliases['groups'], list), 'Person alias groups required')
    seen = set()
    for entry in aliases['groups']:
        require(set(entry) == {'person_id', 'role', 'family_ids', 'evidence'}, 'Invalid person alias entry')
        require(isinstance(entry['person_id'], str) and entry['person_id'].strip()
                and entry['role'] in ('teacher', 'learner'), 'Explicit person identity and role required')
        key = (entry['role'], entry['person_id'])
        require(key not in seen, 'Duplicate person alias identity')
        seen.add(key)
        ids = entry['family_ids']
        require(isinstance(ids, list) and ids and all(isinstance(f, str) and f in parents for f in ids)
                and len(ids) == len(set(ids)), 'Unknown or duplicate alias family')
        evidence = entry['evidence']
        require(isinstance(evidence, dict) and set(evidence) == {'source', 'sha256'}
                and isinstance(evidence['source'], str) and bool(evidence['source'].strip())
                and isinstance(evidence['sha256'], str) and re.fullmatch('[a-f0-9]{64}', evidence['sha256']),
                'Person aliases require explicit evidence locator and hash')
        for family in ids:
            merge(ids[0], family)
    grouped = defaultdict(list)
    for row in audit:
        grouped[root(row['family'])].append(row)
    decisions, lookup = [], {}
    for group, rows in sorted(grouped.items()):
        families = sorted(f for f in parents if root(f) == group)
        reasons = set()
        for row in rows:
            if isinstance(row['decision'], str):
                reasons.add(row['decision'])
            if any(m['original_split'] in native.PROTECTED_SPLITS for m in row['members']):
                reasons.add('protected_reference_family')
        if set(families) & set(registry['protected_families']):
            reasons.add('protected_family')
        decision = {'group_id': group, 'families': families, 'eligible': not reasons,
                    'reasons': sorted(reasons), 'members': [m for row in rows for m in row['members']]}
        decisions.append(decision)
        for row in rows:
            for member in row['members']:
                lookup[(member['dataset'], member['record_id'])] = decision
    return decisions, lookup, aliases


def clean_teacher(body, start):
    """Remove annotation tokens only; map retained Unicode text to original offsets."""
    first = FIRST_TAG.match(body)
    label = first[1].lower() if first and first[1].lower() in CLASSES else None
    label_span = [start + first.start(1) - 1, start + first.end(1) + 1] if label else None
    removed = [(m.start(), m.end()) for m in TAG.finditer(body)]
    positions = [i for i in range(len(body)) if not any(a <= i < b for a, b in removed)]
    while positions and body[positions[0]].isspace():
        positions.pop(0)
    while positions and body[positions[-1]].isspace():
        positions.pop()
    mappings = []
    for clean, raw in enumerate(positions):
        if mappings and mappings[-1]['source'][1] == start + raw:
            mappings[-1]['source'][1] += 1
            mappings[-1]['clean'][1] += 1
        else:
            mappings.append({'source': [start + raw, start + raw + 1], 'clean': [clean, clean + 1]})
    return {'text': ''.join(body[i] for i in positions), 'label': label, 'label_span': label_span,
            'removed_tag_spans': [[start + a, start + b] for a, b in removed], 'source_map': mappings}


def parse_conversation(row):
    """Preserve segment positions, including malformed/empty turns; never guess labels."""
    conversation = native.require_text(row.get('conversation'), 'missing_conversation')
    # Persona names are syntax aliases inside ONE conversation, never person IDs.
    profile = row.get('student_profile', '')
    match = re.match(r'^\s*([\w\'-]+)\s+is\b', profile) if isinstance(profile, str) else None
    student_names = {'Student'} | ({match[1]} if match else set())
    turns, cursor = [], 0
    for index, segment in enumerate(conversation.split('|EOM|')):
        speaker, colon, body = segment.partition(':')
        start = cursor + len(speaker) + len(colon)
        role = 'teacher' if speaker.strip() == 'Teacher' else 'learner' if speaker.strip() in student_names else None
        cleaned = clean_teacher(body, start) if role == 'teacher' else {'text': body.strip(), 'label': None}
        error = None
        if not colon or role is None:
            error = 'unknown_speaker_or_segment'
        elif not cleaned['text']:
            error = 'empty_turn'
        elif role == 'teacher' and cleaned['label'] is None:
            error = 'missing_or_unknown_move_tag'
        turns.append({'index': index, 'role': role, 'segment_span': [cursor, cursor + len(segment)],
                      'body_span': [start, cursor + len(segment)], 'error': error, **cleaned})
        cursor += len(segment) + len('|EOM|')
    return turns


def project_move(record, turns, index, group):
    """Observe the task and causal prefix, then one source teacher segment only."""
    require(record.dataset == 'mathdial' and record.original_split == 'train'
            and native.digest(record.value) == record.sha256, 'Mutated or ineligible source record')
    require(group.get('eligible') is True and any(
        member['dataset'] == record.dataset and member['record_id'] == record.record_id
        and member['sha256'] == record.sha256 for member in group.get('members', [])),
        'Source record is not admitted to this group')
    require(type(index) is int and 0 <= index < len(turns), 'Invalid source turn index')
    action = turns[index]
    require(action['role'] == 'teacher' and action['label'] in CLASSES, 'Not a tagged teacher move')
    require(not any(t['error'] for t in turns[:index + 1]), 'invalid_causal_prefix')
    row = record.value
    question = native.require_text(row.get('question'), 'missing_task')
    attempt = native.require_text(row.get('student_incorrect_solution'), 'missing_initial_attempt')
    prefix = [{'role': 'learner', 'text': 'Task:\n' + question + '\n\nInitial learner attempt:\n' + attempt}]
    prefix += [{'role': t['role'], 'text': t['text']} for t in turns[:index]]
    native.check_context(question, prefix + [{'role': 'tutor', 'text': action['text']}])
    require(not any(TAG.search(t['text']) for t in prefix) and not TAG.search(action['text']), 'residual_annotation_tag')
    identity = 'mathdial-move-' + native.digest({'key': record.key, 'turn': index})[:24]
    events = [{'event_id': identity + f'-prefix-{i}', 'phase': 'pre_action', 'visibility': 'public',
               'kind': 'actor_message' if t['role'] == 'teacher' else 'learner_message', 'text': t['text']}
              for i, t in enumerate(prefix)]
    prior_events = deepcopy(events)
    events.append({'event_id': identity + '-action', 'phase': 'delivered', 'visibility': 'public',
                   'kind': 'actor_message', 'text': action['text']})
    views, refs = [], {}
    for boundary, selected in (('pre_action', prior_events), ('delivered', events)):
        last = selected[-1]
        projection = {'record_id': identity + '-' + boundary, 'family_id': group['group_id'],
                      'boundary': boundary, 'latest_allowed_event_id': last['event_id'], 'events': selected,
                      'spans': [{'event_id': last['event_id'], 'start': 0, 'end': len(last['text'])}]}
        view = observer.boundary_view(projection)
        refs[boundary] = {'record_id': projection['record_id'], 'projection_sha256': native.digest(projection),
                          'text_sha256': view['text_sha256'], 'template_sha256': view['template_sha256']}
        views.append(projection)
    source = {'dataset': record.dataset, 'revision': record.revision, 'asset': record.asset,
              'asset_sha256': record.asset_sha256, 'record_id': record.record_id,
              'record_sha256': record.sha256, 'qid': row['qid'], 'original_split': record.original_split,
              'license': record.license, 'conversation_sha256': sha256(row['conversation'].encode())}
    example = {'id': identity, 'split_family': group['group_id'], 'source': source,
        'target': {'name': 'mathdial_teacher_move', 'value': action['label'], 'fit_mask': True,
                   'boundary': 'delivered', 'origin': 'source_teacher_move_tag',
                   'annotation_span': action['label_span']},
        'cut': {'source_field': 'conversation', 'offset_unit': 'unicode_codepoint', 'interval': 'half_open',
                'turn_index': index, 'prefix_end': action['segment_span'][0],
                'previous_role': turns[index - 1]['role'] if index else 'initial_learner_attempt',
                'prefix_source_sha256': sha256(row['conversation'][:action['segment_span'][0]].encode()),
                'action_segment_span': action['segment_span'], 'action_body_span': action['body_span']},
        'transformation': {'version': VERSION, 'action_source_map': action['source_map'],
                           'prefix_turns': [{'turn_index': t['index'], 'role': t['role'],
                                             'segment_span': t['segment_span'], 'body_span': t['body_span'],
                                             'clean_text_sha256': sha256(t['text'].encode()),
                                             'teacher_source_map': t.get('source_map')}
                                            for t in turns[:index]],
                           'removed_tags': [{'turn_index': t['index'], 'spans': t['removed_tag_spans']}
                                            for t in turns[:index + 1] if t['role'] == 'teacher'],
                           'initial_fields': ['question', 'student_incorrect_solution'],
                           'excluded_fields': ['ground_truth', 'student_profile', 'teacher_described_confusion',
                                               'self-correctness', 'self-typical-confusion', 'self-typical-interactions']},
        'observer_inputs': refs, 'pre_action_target': None, 'retrospective_target': None, 'learning_outcome': None,
        'authorship': {'teacher': 'human_teacher_source', 'learner': 'simulated_llm_source',
                       'person_identity': 'not_exposed_by_pinned_release'},
        'runtime_execution': False, 'actor_policy_training_eligible': False}
    return example, views


def partition_groups(examples):
    groups = sorted({e['split_family'] for e in examples}, key=lambda x: sha256((VERSION + ':' + x).encode()))
    if len(groups) < 5:
        return {'status': 'insufficient_groups', 'candidate_groups': groups, 'train': [], 'calibration': [], 'test': []}
    held = len(groups) // 5
    return {'status': 'authored_source_probe_split_not_published_holdout',
            'train': groups[2 * held:], 'calibration': groups[:held], 'test': groups[held:2 * held]}


def build_supervision(cache=sources.CACHE, registry=None, *, catalog=None, person_aliases=None):
    """Public API: source verification and full family closure are not optional."""
    registry = native.load_registry() if registry is None else registry
    records, assets = load_snapshot(cache, registry, catalog)
    groups, lookup, aliases = family_groups(records, registry, person_aliases)
    examples, projections, rejected = [], [], []
    train = [r for r in records if r.dataset == 'mathdial' and r.original_split == 'train']
    all_labels, eligible_labels = Counter(), Counter()
    for record in train:
        try:
            turns = parse_conversation(record.value)
        except ValueError as error:
            rejected.append({'record_id': record.record_id, 'reason': str(error)})
            continue
        all_labels.update(t['label'] or 'unavailable' for t in turns if t['role'] == 'teacher')
        group = lookup.get(('mathdial', record.record_id))
        if group is None or not group['eligible']:
            rejected.append({'record_id': record.record_id, 'reason': 'family_excluded',
                             'family_reasons': group['reasons'] if group else ['unresolved_origin']})
            continue
        for i, turn in enumerate(turns):
            if turn['role'] != 'teacher':
                continue
            if turn['error']:
                rejected.append({'record_id': record.record_id, 'turn_index': i, 'reason': turn['error']})
                continue
            try:
                example, inputs = project_move(record, turns, i, group)
            except ValueError as error:
                rejected.append({'record_id': record.record_id, 'turn_index': i, 'reason': str(error)})
                continue
            examples.append(example)
            projections.extend(inputs)
            eligible_labels[turn['label']] += 1
    split = partition_groups(examples)
    membership = {group: part for part in ('train', 'calibration', 'test') for group in split[part]}
    for example in examples:
        example['partition'] = membership.get(example['split_family'])
        example['target']['fit_mask'] = example['partition'] == 'train'
        example['target']['evaluation_mask'] = example['partition'] in ('calibration', 'test')
        example['example_sha256'] = native.digest(example)
    coverage = {part: dict(Counter(e['target']['value'] for e in examples if e['partition'] == part))
                for part in ('train', 'calibration', 'test')}
    manifest = {'schema_version': 1, 'kind': VERSION, 'source_revision': REVISION,
        'base_native_registry_sha256': native.digest(registry), 'person_aliases_sha256': native.digest(aliases),
        'assets': assets, 'classes': list(CLASSES), 'source_train_conversations': len(train),
        'source_train_teacher_tags': dict(all_labels),
        'family_admitted_train_conversations': sum(bool(lookup.get(('mathdial', r.record_id), {}).get('eligible')) for r in train),
        'usable_source_conversations': len({e['source']['record_id'] for e in examples}),
        'usable_groups': len({e['split_family'] for e in examples}), 'examples': len(examples),
        'observer_records': len(projections), 'class_counts': dict(eligible_labels), 'partition_class_counts': coverage,
        'partition_group_counts': {part: len(split[part]) for part in coverage},
        'missing_classes_by_partition': {part: sorted(set(CLASSES) - counts.keys()) for part, counts in coverage.items()},
        'rejections': dict(Counter(r['reason'] for r in rejected)),
        'person_alias_groups': len(aliases['groups']), 'human_person_holdout_established': False,
        'measurement': 'Source teacher-move classification only; no SAR, need, correctness or learning target.',
        'source_authorship': 'Human teachers interacting with simulated LLM students.',
        'feature_status': 'not_extracted', 'policy_training_status': 'unavailable_source_not_actor_capture'}
    bundle = {'manifest.json': manifest, 'examples.json': {'examples': examples},
              'observer-inputs.json': {'records': projections}, 'splits.json': split,
              'family-audit.json': {'groups': groups, 'person_aliases': aliases}, 'rejected.json': {'records': rejected}}
    manifest['artifact_sha256'] = {name: native.digest(value) for name, value in bundle.items() if name != 'manifest.json'}
    return bundle


def write_bundle(bundle, output):
    directory = native.output_directory(output)
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, value in bundle.items():
        fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(native.canonical(value) + '\n')
    return directory


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('inspect', 'build'))
    parser.add_argument('--cache', type=Path, default=sources.CACHE)
    parser.add_argument('--registry', type=Path, default=native.REGISTRY)
    parser.add_argument('--person-aliases', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    if (args.command == 'build') != (args.output is not None):
        parser.error('Only build requires and accepts --output')
    aliases = json.loads(args.person_aliases.read_text()) if args.person_aliases else None
    bundle = build_supervision(args.cache, native.load_registry(args.registry), person_aliases=aliases)
    if args.command == 'build':
        write_bundle(bundle, args.output)
    print(json.dumps(bundle['manifest.json'], indent=2))


if __name__ == '__main__':
    main()
