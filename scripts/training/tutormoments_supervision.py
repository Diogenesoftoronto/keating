"""Source SAR supervision, never labels for changed native episodes.

Inspect/build read verified cache bytes offline. Explicit fetch downloads only
pinned public source assets. No inference, training or credential operations.
"""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.request

import benchmark_sources as sources
import native_scenarios as native
import tutormoments as tm


REVISION = tm.REVISION
SOURCE_REGISTRY = Path(__file__).with_name('source_supervision_registry.json')
# File identities from the publisher's tree at REVISION. The annotation file is
# a Git blob, not an LFS object; verify its Git object ID AND record SHA256 below.
SAR_ASSETS = {
    'annotations.jsonl': {'bytes': 10255887, 'git_blob_sha1': 'ffee6b0fdf052251f42d54fe39a41cf3992620ce',
                         'sha256': '8a7adc65b8c63a78950a278eda5e4feaa5a093bab02d964bad1027468e18914f'},
    'ground_truth.jsonl': {'bytes': 11131708, 'sha256': '9735b8c83575098dfac6928d1ff32a0aa283700651598ab9a7757879d6edcfda'},
    'transcripts.jsonl': {'bytes': 38117914, 'sha256': '34b5d4483302593043f3d9be3bf37f1cde6cba5b031fd2d20d75a15d5498f276'},
}
SCHEMA_URL = f'https://huggingface.co/datasets/{tm.DATASET}/resolve/{REVISION}/'
DOCUMENT_ASSETS = {
    'README.md': {'bytes': 6592, 'sha256': 'd492e5965139f6c25bbbbe4224ce00d5aae18ab181921e1b07ee8ce2e1d816c4'},
    'annotations.schema.json': {'bytes': 5245, 'sha256': 'ed5acda8741e1f1f3a02ea56261a194772312f9ed1514fbc7790df92fbc6a7cd'},
    'ground_truth.schema.json': {'bytes': 6523, 'sha256': '45554dabd0428ab8e5c043311ea775e2c66594e258c6b1f8701eba2c13d09e88'},
    'transcripts.schema.json': {'bytes': 4436, 'sha256': 'ded2cf416b5ffc84af81447fbd27d370e56ab44e8254c8a2cb420928a25d0e28'},
}
TARGETS = {
    'situation.scaffolding': 'pre_action', 'situation.rigor': 'pre_action',
    'situation.aggregate_scaffolding': 'pre_action',
    'situation.aggregate_rigor': 'pre_action',
    'action.scaffolding': 'action', 'action.rigor': 'action',
    'result.positive': 'retrospective', 'result.effectiveness': 'retrospective',
}
UUID = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def verify_asset(body, pin, name):
    if len(body) != pin['bytes']:
        raise ValueError(f'Source byte count mismatch: {name}')
    if 'sha256' in pin and sha256(body) != pin['sha256']:
        raise ValueError(f'Source SHA256 mismatch: {name}')
    if 'git_blob_sha1' in pin:
        oid = hashlib.sha1(f'blob {len(body)}\0'.encode() + body).hexdigest()
        if oid != pin['git_blob_sha1']:
            raise ValueError(f'Source Git blob mismatch: {name}')


def fetch_asset(name, pin, cache):
    """Publish verified bytes exclusively; never repair/overwrite a cached file."""
    source = {'id': 'tutormoments', 'revision': REVISION}
    path = sources.original_path(source, {'path': name}, cache)
    if path.exists():
        body = path.read_bytes()
        verify_asset(body, pin, name)
    else:
        with urllib.request.urlopen(SCHEMA_URL + name, timeout=60) as response:
            body = response.read(pin['bytes'] + 1)
        verify_asset(body, pin, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent) as temporary:
            temporary.write(body)
            temporary.flush()
            os.fsync(temporary.fileno())
            try:
                path.hardlink_to(temporary.name)
            except FileExistsError:
                verify_asset(path.read_bytes(), pin, name)
    return {'asset': name, 'url': SCHEMA_URL + name, 'bytes': len(body),
            'sha256': sha256(body), 'status': 'verified'}


def fetch_sources(cache=sources.CACHE):
    # Read and verify the card/schemas before any corpus download. These are
    # exact documentation bytes inspected when this adapter was implemented.
    reports = [fetch_asset(name, pin, cache) for name, pin in DOCUMENT_ASSETS.items()]
    reports.extend(fetch_asset(name, pin, cache) for name, pin in SAR_ASSETS.items())
    return {'dataset': tm.DATASET, 'revision': REVISION, 'license': 'CC-BY-4.0',
            'attribution': SCHEMA_URL + 'README.md', 'assets': reports}


def read_pinned(path, pin):
    """No trust-on-first-use; altered or partial inputs abort before export."""
    body = Path(path).read_bytes()
    file_hash = sha256(body)
    verify_asset(body, pin, Path(path).name)
    rows, refs = [], []
    for line_number, line in enumerate(body.splitlines(keepends=True), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError('Expected source JSONL objects')
        rows.append(row)
        refs.append({'asset': Path(path).name, 'asset_sha256': file_hash, 'line_number': line_number,
                     'line_sha256': sha256(line), 'record_sha256': native.digest(row)})
    return rows, refs, {'status': 'verified', 'bytes': len(body), 'sha256': file_hash,
                        'rows': len(rows), **({'git_blob_sha1': pin['git_blob_sha1']}
                                              if 'git_blob_sha1' in pin else {})}


def load_snapshot(cache=sources.CACHE):
    """Read all five source collections so a subset cannot hide held-out kin."""
    records = native.load_source_records(cache)
    catalog = sources.source_catalog()
    source = next(s for s in catalog if s['id'] == 'tutormoments')
    if source['revision'] != REVISION:
        raise ValueError('Unsupported TutorMoments revision')
    assets = {a['path']: a for a in source['files']}
    pins = {**SAR_ASSETS, **{name: assets[name] for name in ('moments.jsonl',)}}
    snapshot = {'rows': {}, 'refs': {}, 'assets': {}}
    for name, pin in pins.items():
        path = sources.original_path(source, {'path': name}, cache)
        if not path.exists() and name in SAR_ASSETS:
            snapshot['rows'][name], snapshot['refs'][name] = [], []
            snapshot['assets'][name] = {'status': 'missing', 'expected': pin}
            continue
        rows, refs, report = read_pinned(path, pin)
        snapshot['rows'][name], snapshot['refs'][name] = rows, refs
        snapshot['assets'][name] = report
    tm.validate_records(snapshot['rows']['moments.jsonl'])
    return records, snapshot


def unknown(reason='not_provided'):
    return {'value': None, 'mask': 0, 'reason': reason, 'origin': None,
            'source_field': None, 'raw': None, 'disagreement': []}


def target(raw, mapping, field, origin):
    value = mapping.get(raw) if isinstance(raw, str) else None
    return {'value': value, 'mask': int(value is not None),
            'reason': None if value is not None else 'unknown_or_unmapped_source_value',
            'origin': origin, 'source_field': field, 'raw': raw, 'disagreement': []}


def ground_truth_targets(moment):
    """Explicit schema mappings. SAR text is never heuristically classified."""
    labels = {name: unknown() for name in TARGETS}
    for concept in ('scaffolding', 'rigor'):
        labels[f'situation.{concept}'] = target(
            moment.get('situation_label', {}).get(concept), {'yes': 1, 'no': 0},
            f'situation_label.{concept}', 'llm_assisted_per_annotator_situation')
        direction = {concept: 1, 'both': 1, 'neither': 0,
                     ('rigor' if concept == 'scaffolding' else 'scaffolding'): 0}
        labels[f'situation.aggregate_{concept}'] = target(
            moment.get('situation_label_agg'), direction, 'situation_label_agg',
            'llm_assisted_exact_span_situation_aggregation')
        labels[f'action.{concept}'] = target(
            moment.get('action_direction_agg'), direction, 'action_direction_agg',
            'llm_assisted_exact_span_action_facet_aggregation')
    labels['result.positive'] = target(moment.get('student_outcome_agg'),
        {'pos': 1, 'neg': 0}, 'student_outcome_agg',
        'llm_assisted_exact_span_result_facet_aggregation')
    labels['result.effectiveness'] = target(moment.get('strategy_label'),
        {v: v for v in ('effective', 'partial', 'ineffective')}, 'strategy_label',
        'llm_assisted_hybrid_effectiveness')
    return labels


def annotation_key(transcript_id, annotation_type, annotator_id, turn, ground=False):
    return (transcript_id, annotation_type, annotator_id,
            turn.get('turn_start' if ground else 'turn_number_start'),
            turn.get('turn_end' if ground else 'turn_number_end'),
            *(turn.get(k) for k in ('situation', 'action', 'result')))


def ground_truth_index(snapshot):
    index = defaultdict(list)
    for row, ref in zip(snapshot['rows']['ground_truth.jsonl'], snapshot['refs']['ground_truth.jsonl']):
        for position, moment in enumerate(row['key_moments']):
            key = annotation_key(row['conversation_id'], moment['annotation_type'],
                                 moment['annotator_id'], moment, True)
            index[key].append((moment, {**ref, 'key_moment_index': position,
                                       'key_moment_sha256': native.digest(moment)}))
    return index


def exact_join(candidates, annotation):
    """Never join on overlapping ranges, annotator identity alone, or desired move."""
    matched = []
    for moment, ref in candidates:
        # Missing optional IDs can be joined by exact SAR text and span. A
        # conflicting present ID/cut cannot silently join to another judgment.
        if any(annotation.get(k) is not None and moment.get(k) is not None
               and annotation[k] != moment[k] for k in ('moment_id', 'cut_turn')):
            continue
        matched.append((moment, ref))
    if len(matched) == 1:
        return matched[0], None
    return None, 'ambiguous_ground_truth_join' if matched else 'missing_exact_ground_truth_join'


def input_view(turns, boundary, bound):
    messages = [{'turn_number': t['turn_number'], 'role': t['role'].lower(), 'text': t['text']}
                for t in turns if t['turn_number'] <= bound]
    return {'boundary': boundary, 'latest_allowed_turn': bound, 'turns': messages,
            'input_sha256': native.digest(messages)}


def project_annotation(transcript, annotation):
    """Independent temporal views; exclude session/enrichment/SAR metadata."""
    views = {boundary: None for boundary in set(TARGETS.values())}
    reasons = {}
    cut, start, end = (annotation.get(k) for k in ('cut_turn', 'turn_number_start', 'turn_number_end'))
    if transcript is None:
        return views, {b: 'missing_transcript' for b in views}
    if any(type(v) is not int or v < 1 for v in (cut, start, end)) or not start <= cut < end:
        return views, {b: 'missing_or_invalid_annotator_cut' for b in views}
    turns = transcript.get('turns', [])
    if (not turns or any(type(t.get('turn_number')) is not int or
            t['turn_number'] != i + 1 or t.get('role') not in ('Student', 'Tutor') or
            not isinstance(t.get('text'), str) or not t['text'].strip()
            for i, t in enumerate(turns)) or end > len(turns)):
        return views, {b: 'missing_or_invalid_transcript_turns' for b in views}
    if turns[cut - 1]['role'] != 'Student':
        return views, {b: 'cut_not_at_learner_decision' for b in views}
    try:
        native.check_context(None, [{'role': 'learner' if t['role'] == 'Student' else 'tutor',
                                    'text': t['text']} for t in turns[:cut]])
    except native.Rejected as error:
        return views, {b: str(error) for b in views}
    views['pre_action'] = input_view(turns, 'pre_action', cut)
    continuation = turns[cut:end]
    first_learner = next((i for i, t in enumerate(continuation) if t['role'] == 'Student'), None)
    if not continuation or continuation[0]['role'] != 'Tutor':
        reasons['action'] = reasons['retrospective'] = 'missing_delivered_tutor_action'
        return views, reasons
    # An aggregate for several tutor/learner exchanges cannot label the first
    # tutor response alone, nor can that response's view include later feedback.
    if any(t['role'] == 'Tutor' for t in turns[start - 1:cut]):
        reasons['action'] = 'action_span_starts_before_decision'
    elif first_learner is not None and any(t['role'] == 'Tutor' for t in continuation[first_learner:]):
        reasons['action'] = 'action_span_crosses_learner_feedback'
    else:
        views['action'] = input_view(turns, 'action', cut + (first_learner or len(continuation)))
    if first_learner is None:
        reasons['retrospective'] = 'missing_learner_consequence'
    else:
        views['retrospective'] = input_view(turns, 'retrospective', end)
    return views, reasons


def family_census(records, registry, transcripts):
    # The shared builder computes full source-family closure before filtering;
    # don't rebuild it from accepted scenarios, which discards unusable members.
    closure = native.build_native_scenarios(records, registry, source='tutormoments')
    audit = {f['family']: f for f in closure['families']}
    parents = {}

    def root(family):
        parents.setdefault(family, family)
        while parents[family] != family:
            family = parents[family]
        return family

    def merge(a, b):
        a, b = root(a), root(b)
        parents[max(a, b)] = min(a, b)

    # Resolve aliases from every source, not only TutorMoments. A protected
    # repack/test alias must propagate through the same-person component too.
    for family, item in audit.items():
        root(family)
        for alias in item['aliases']:
            merge(family, alias)
    for family in registry['protected_families']:
        root(family)
    by_person = defaultdict(list)
    for row in transcripts:
        family = 'tm-' + row['transcript_id']
        root(family)
        person = row.get('session', {}).get('student_id')
        if isinstance(person, str) and UUID.fullmatch(person):
            by_person[person].append(family)
    for families in by_person.values():
        for family in families[1:]:
            merge(families[0], family)
    for family in audit:
        root(family)
    groups = defaultdict(set)
    for family in parents:
        groups[root(family)].add(family)
    decisions = {}
    for group, families in groups.items():
        reasons = set()
        for family in families:
            item = audit.get(family)
            if family in registry['protected_families']:
                reasons.add('protected_family')
            if item is None:
                reasons.add('unregistered_source_family')
            else:
                decision = item['decision']
                if isinstance(decision, str):
                    reasons.add(decision)
                # An earlier native development exposure does not release the
                # public benchmark family for source-probe fitting/holdouts.
                if any(m['original_split'] in native.PROTECTED_SPLITS for m in item['members']):
                    reasons.add('protected_reference_family')
        decisions[group] = {'group': group, 'families': sorted(families),
                            'eligible': not reasons, 'reasons': sorted(reasons)}
    return audit, {f: decisions[root(f)] for f in parents}


def split_families(examples):
    """Deterministic 60/20/20 grouped split only when at least five qualify."""
    families = sorted({e['split_family'] for e in examples if e['eligibility']['eligible']
                       and any(t['fit_mask'] for t in e['targets'].values())},
                      key=lambda f: sha256(('tutormoments-source-split-v1:' + f).encode()))
    if len(families) < 5:
        return {'status': 'insufficient_eligible_families', 'minimum_families': 5,
                'candidate_families': families, 'train': [], 'calibration': [], 'test': []}
    held = max(1, len(families) // 5)
    return {'status': 'source_probe_development_split_not_release_holdout',
            'train': families[2 * held:], 'calibration': families[:held], 'test': families[held:2 * held]}


def apply_disagreements(examples):
    """Preserve votes; do not average away source conflict or count copies as votes."""
    groups = defaultdict(list)
    for example in examples:
        key = (example['transcript_id'], *example['span'],
               example.get('annotation_type'), example.get('kind'))
        groups[key].append(example)
    for grouped in groups.values():
        for name in TARGETS:
            # Distinct raw source values are retained even when they map to the
            # same binary result; unknowns never become a vote against presence.
            values = {native.canonical(e['targets'][name]['value']) for e in grouped
                      if e['targets'][name]['mask']}
            if len(values) > 1:
                evidence = [{'example_id': e['id'], 'annotator_id': e.get('annotator_id'),
                             'value': e['targets'][name]['value']} for e in grouped
                            if e['targets'][name]['mask']]
                for e in grouped:
                    e['targets'][name]['disagreement'] = evidence
                    e['targets'][name]['fit_mask'] = 0
                    e['targets'][name]['fit_reason'] = 'conflicting_exact_span_judgments'


def evidence_groups(examples):
    """Aggregate copies and alternate cuts are derivatives, not new votes."""
    members = defaultdict(list)
    for example in examples:
        for name, label in example['targets'].items():
            origin = label['origin'] or ''
            identity = {'transcript_id': example['transcript_id'], 'span': example['span'],
                        'annotation_type': example.get('annotation_type'), 'target': name, 'origin': origin}
            if 'exact_span' not in origin:
                identity['annotator_id'] = example.get('annotator_id')
            label['evidence_group'] = 'tm-label-' + native.digest(identity)
            label['fit_weight'] = 0.0
            if label['fit_mask']:
                members[label['evidence_group']].append(label)
    for labels in members.values():
        for label in labels:
            label['fit_weight'] = 1.0 / len(labels)


def alias_requirements(records, snapshot, audit, families, examples):
    """Evidence for a coordinator registry change, never an admission grant."""
    rows, refs = snapshot['rows'], snapshot['refs']
    annotation_refs, ground_refs, frozen = defaultdict(list), defaultdict(list), defaultdict(list)
    for row, ref in zip(rows['annotations.jsonl'], refs['annotations.jsonl']):
        annotation_refs[row['transcript_id']].append(ref)
    for row, ref in zip(rows['ground_truth.jsonl'], refs['ground_truth.jsonl']):
        ground_refs[row['conversation_id']].append(ref)
    for record in records:
        if record.dataset == 'tutormoments':
            p = record.value['provenance']
            frozen[p['conv_id'].rsplit('_', 1)[-1]].append({'conv_id': p['conv_id'],
                'frozen_moment_id': record.value['id'], 'record_id': record.record_id,
                'record_sha256': record.sha256, 'moment_id': p.get('moment_id'),
                'cut_turn': p['cut_turn']})
    by_family = defaultdict(list)
    for example in examples:
        if example['kind'] == 'source_sar':
            by_family[example['family']].append(example)
    requirements = []
    for transcript, ref in zip(rows['transcripts.jsonl'], refs['transcripts.jsonl']):
        identity = transcript['transcript_id']
        family = 'tm-' + identity
        session = transcript['session']
        expected_conv = '_'.join([session['tutor_id'], session['student_id'], identity])
        if any(m['conv_id'] != expected_conv for m in frozen[identity]):
            raise ValueError('Frozen composite identity conflicts with source transcript')
        requirements.append({'family': family, 'split_group': families[family]['group'],
            'same_student_families': families[family]['families'],
            'transcript_id': identity, 'source_student_id': session['student_id'],
            'source_session_id': session['session_id'], 'transcript_source': ref,
            'annotation_sources': annotation_refs[identity], 'ground_truth_sources': ground_refs[identity],
            'frozen_moments': frozen[identity],
            'proposed_aliases': {'annotations.transcript_id': identity, 'transcripts.transcript_id': identity,
                'ground_truth.conversation_id': identity if ground_refs[identity] else None,
                'moments.provenance.conv_id': expected_conv if frozen[identity] else None},
            'native_registry_family_present': family in audit,
            'admission': 'not_granted', 'exclusion_reasons': families[family]['reasons'],
            'sar_examples': len(by_family[family]),
            'known_sar_labels': {n: sum(e['targets'][n]['mask'] for e in by_family[family]) for n in TARGETS}})
    return {'status': 'proposal_only_no_registry_change', 'revision': REVISION,
        'assets': snapshot['assets'], 'transcripts': requirements,
        'requirements': [
            'Pin all three SAR asset byte hashes at this exact revision in the shared admission contract.',
            'Validate transcript_id = conversation_id and every frozen conv_id against transcript session IDs.',
            'Retain all exact annotation/moment/record identities as derivatives of the transcript family.',
            'Propagate existing protected and exposed families through same-student transcript closure.',
            'Explicitly admit only independently reviewed nonprotected source-probe families; download is not admission.',
            'Add a distinct default-deny source_supervision section; keep the native moments benchmark contract unchanged.',
        ]}


def proposed_partitions(group_ids):
    """Authored source-probe partitions; the HF loader split is not a holdout."""
    salt = 'tutormoments-source-supervision-groups-v1:'
    ordered = sorted(set(group_ids), key=lambda value: (sha256((salt + value).encode()), value))
    policy = {'origin': 'authored_grouped_source_probe_partition', 'version': 1,
              'ordering': 'ascending_sha256_of_utf8_salt_plus_group_id', 'salt': salt,
              'ratios': {'train': 0.6, 'calibration': 0.2, 'test': 0.2},
              'allocation': 'floor(N/5) calibration, floor(N/5) test, remainder train',
              'minimum_groups': 5, 'release_holdout': False,
              'selected_using_labels_or_model_scores': False}
    if len(ordered) < 5:
        return {'policy': policy, 'status': 'insufficient_candidate_groups',
                'train': [], 'calibration': [], 'test': []}
    held = len(ordered) // 5
    return {'policy': policy, 'status': 'proposed_not_activated',
            'train': ordered[2 * held:], 'calibration': ordered[:held], 'test': ordered[held:2 * held]}


def admission_proposal(records, registry, snapshot, audit, families, aliases, examples, inputs):
    """Materialize an exact reviewable registry proposal without consuming it."""
    if any(snapshot['assets'][name]['status'] != 'verified' for name in SAR_ASSETS):
        return {'status': 'missing_source_assets', 'allowed_families': [],
                'current_fit_eligible_families': 0}
    sar_examples = [e for e in examples if e['kind'] == 'source_sar']
    by_family = defaultdict(list)
    for example in sar_examples:
        by_family[example['family']].append(example)
    candidate_families, blocked = [], []
    # Only missing registration may be proposed for review. Snapshot errors,
    # protected aliases or any other unresolved refusal never enter an allowlist.
    for family in sorted(by_family):
        decision = families.get(family)
        if decision is not None and set(decision['reasons']) <= {'unregistered_source_family'}:
            candidate_families.append(family)
        else:
            blocked.append({'family': family, 'reasons': decision['reasons'] if decision
                            else ['unresolved_family'], 'group': decision['group'] if decision else None})
    groups = {families[f]['group']: families[f]['families'] for f in candidate_families}
    partitions = proposed_partitions(groups)
    source_assets = {name: snapshot['assets'][name]['sha256'] for name in SAR_ASSETS}
    reference_hash = snapshot['assets']['moments.jsonl']['sha256']
    section = {'schema_version': 1, 'default': 'deny', 'sources': {'tutormoments': {
        'dataset': tm.DATASET, 'revision': REVISION, 'purposes': ['source_probe'],
        'original_partition': 'unpartitioned_published_source_release',
        'publisher_loader_split': 'train',
        'publisher_loader_split_is_training_admission': False,
        'assets': source_assets, 'protected_reference_assets': {'moments.jsonl': reference_hash},
        'allowed_families': candidate_families, 'family_groups': dict(sorted(groups.items())),
        'partitions': partitions, 'native_label_inheritance': False}}}
    native_seeds = sorted(f for f, item in audit.items()
                          if any(m['original_split'] in native.PROTECTED_SPLITS for m in item['members']))
    protected_seeds = sorted(set(native_seeds) | set(registry['protected_families']))
    candidate_examples = [e for f in candidate_families for e in by_family[f]]
    view_map = {row['id']: row['views'] for row in inputs}
    temporal = {n: [e for e in candidate_examples if e['targets'][n]['mask']
                   and not e['targets'][n]['disagreement'] and view_map[e['id']][TARGETS[n]]]
                for n in TARGETS}
    proposal = {'schema_version': 1, 'status': 'pending_parent_review_not_admission',
        'base_registry_sha256': native.digest(registry), 'source_supervision': section,
        'full_source_snapshot_pins': deepcopy(registry['sources']),
        'source_record_count': len(records), 'native_closure_sha256': native.digest(audit),
        'same_person_closure_sha256': native.digest(families),
        'alias_evidence_sha256': native.digest(aliases),
        'protected_seed_families': protected_seeds,
        'protected_closure_groups': sorted({families[f]['group'] for f in protected_seeds if f in families}),
        'blocked_sar_families': blocked,
        'counts': {'sar_families': len(by_family), 'surviving_sar_families': len(candidate_families),
            'surviving_student_groups': len(groups),
            'all_same_person_transcript_derivatives': len({f for members in groups.values() for f in members}),
            'surviving_sar_entries': len(candidate_examples),
            'known_labels': {n: sum(e['targets'][n]['mask'] for e in candidate_examples) for n in TARGETS},
            'proposed_partition_groups': {k: len(partitions[k]) for k in ('train', 'calibration', 'test')},
            'temporal_labeled_families': len({e['family'] for values in temporal.values() for e in values}),
            'temporal_labels': {n: {'rows': len(values), 'student_groups': len({e['split_family'] for e in values}),
                'values': dict(Counter(str(e['targets'][n]['value']) for e in values))} for n, values in temporal.items()},
            'current_fit_eligible_families': len({e['family'] for e in sar_examples
                                               if any(t['fit_mask'] for t in e['targets'].values())})},
        'activation_requirements': [
            'Parent validates/adopts this distinct section; importer must validate the exact section before permitting source-probe fitting.',
            'Recompute closure from ALL pinned snapshots and ALL transcript student identities; intersect the explicit allowlist with current nonprotected families.',
            'Any missing asset/alias/group, changed pin or new protected connection denies admission; earlier native exposure never overrides protection.',
            'Keep every derivative in its recorded group partition and keep unknown/conflicting/temporally invalid targets masked.',
            'Proposed partitions reserve groups only; they are not evidence of adequate label classes or a validated probe experiment.',
        ]}
    proposal['proposal_sha256'] = native.digest(proposal)
    return proposal


def load_source_registry(path=SOURCE_REGISTRY):
    """Absent admission is denied; malformed or ambiguous JSON is an error."""
    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('Duplicate source registry key: ' + key)
            value[key] = item
        return value

    path = Path(path)
    if not path.exists():
        return None
    value = json.loads(path.read_text(), object_pairs_hook=unique_object)
    if not isinstance(value, dict):
        raise ValueError('Invalid source supervision registry envelope')
    return value


def validate_source_registry(sidecar, proposal, snapshot):
    """Bind admission to the independently recomputed, still-denied proposal."""
    if sidecar is None:
        return {'status': 'absent_default_deny', 'purpose': 'source_probe'}
    fields = {'schema_version', 'base_native_registry_sha256', 'proposal_sha256', 'source_supervision'}
    if not isinstance(sidecar, dict) or set(sidecar) != fields or type(sidecar['schema_version']) is not int or sidecar['schema_version'] != 1:
        raise ValueError('Invalid source supervision registry envelope')
    if proposal['status'] != 'pending_parent_review_not_admission':
        raise ValueError('Source supervision admission requires all pinned source assets')
    for name, pin in SAR_ASSETS.items():
        asset = snapshot['assets'][name]
        if asset.get('status') != 'verified' or asset.get('sha256') != pin['sha256']:
            raise ValueError('Source supervision asset pin mismatch: ' + name)
    if sidecar['base_native_registry_sha256'] != proposal['base_registry_sha256']:
        raise ValueError('Source supervision base native registry mismatch')
    unsigned = deepcopy(proposal)
    claimed = unsigned.pop('proposal_sha256')
    if native.digest(unsigned) != claimed or sidecar['proposal_sha256'] != claimed:
        raise ValueError('Source supervision proposal/closure mismatch')
    # Canonical equality is deliberately stricter than Python dict equality
    # (which would, for example, equate True with 1). No subset/group repair,
    # new purpose, changed split, unknown field or permissive default is allowed.
    if native.canonical(sidecar['source_supervision']) != native.canonical(proposal['source_supervision']):
        raise ValueError('Source supervision exact section mismatch')
    policy = sidecar['source_supervision']['sources']['tutormoments']
    return {'status': 'validated_source_probe_only', 'purpose': 'source_probe',
            'registry_sha256': native.digest(sidecar), 'proposal_sha256': claimed,
            'base_native_registry_sha256': proposal['base_registry_sha256'],
            'allowed_families': len(policy['allowed_families']),
            'allowed_student_groups': len(policy['family_groups']),
            'cut_policy': 'source_annotator_cut_unchanged', 'native_label_inheritance': False}


def apply_source_admission(sidecar, examples, inputs):
    """Remove only the registration refusal; retain every evidence mask."""
    policy = sidecar['source_supervision']['sources']['tutormoments']
    allowed = set(policy['allowed_families'])
    partitions = policy['partitions']
    group_partition = {group: part for part in ('train', 'calibration', 'test') for group in partitions[part]}
    views = {row['id']: row['views'] for row in inputs}
    for example in examples:
        if example['kind'] != 'source_sar' or example['family'] not in allowed:
            continue
        decision = example['eligibility']
        decision['reasons'] = [r for r in decision['reasons'] if r != 'unregistered_source_family']
        decision['eligible'] = not decision['reasons']
        decision['admission_origin'] = 'validated_source_supervision_sidecar'
        example['source_probe_partition'] = group_partition.get(example['split_family'])
        for name, label in example['targets'].items():
            boundary = TARGETS[name]
            label['fit_mask'] = int(bool(label['mask'] and not label['disagreement']
                and decision['eligible'] and example['source_probe_partition'] and views[example['id']][boundary]))
            label['fit_reason'] = (None if label['fit_mask'] else
                'conflicting_exact_span_judgments' if label['disagreement'] else
                example['view_rejections'].get(boundary) or
                ('source_family_excluded' if not decision['eligible'] else
                 'insufficient_partition_groups' if not example['source_probe_partition'] else label['reason']))
    evidence_groups(examples)
    fit_groups = {e['split_family'] for e in examples if any(t['fit_mask'] for t in e['targets'].values())}
    split = deepcopy(partitions)
    split['status'] = 'admitted_source_probe_group_reservations_not_release_holdout'
    split['groups_with_fit_labels'] = {part: [g for g in partitions[part] if g in fit_groups]
                                     for part in ('train', 'calibration', 'test')}
    split['temporal_coverage_status'] = ('insufficient_labeled_groups' if len(fit_groups) < 5
                                         else 'requires_per_target_calibration_review')
    split['target_coverage'] = {name: {part: {
        'rows': len(values := [e for e in examples if e.get('source_probe_partition') == part
                              and e['targets'][name]['fit_mask']]),
        'student_groups': len({e['split_family'] for e in values}),
        'evidence_groups': len({e['targets'][name]['evidence_group'] for e in values}),
        'values': dict(Counter(str(e['targets'][name]['value']) for e in values))}
        for part in ('train', 'calibration', 'test')} for name in TARGETS}
    return split


def build_supervision(records, registry, snapshot, source_registry=None):
    """Pure SOURCE import. Returned private targets must not enter model views."""
    native.validate_registry(registry)
    rows, refs = snapshot['rows'], snapshot['refs']
    for name in ('annotations.jsonl', 'ground_truth.jsonl', 'transcripts.jsonl', 'moments.jsonl'):
        if len(rows[name]) != len(refs[name]) or any(
                native.digest(row) != ref['record_sha256'] for row, ref in zip(rows[name], refs[name])):
            raise ValueError('Source record mutated after verification')
    transcripts, transcript_refs = {}, {}
    for row, ref in zip(rows['transcripts.jsonl'], refs['transcripts.jsonl']):
        identity = row.get('transcript_id')
        if not isinstance(identity, str) or not UUID.fullmatch(identity) or identity in transcripts:
            raise ValueError('Invalid or duplicate transcript ID')
        transcripts[identity], transcript_refs[identity] = row, ref
    audit, families = family_census(records, registry, list(transcripts.values()))
    gt_index = ground_truth_index(snapshot)
    examples, inputs, rejected, seen = [], [], [], set()
    gt_used = set()
    for row, ref in zip(rows['annotations.jsonl'], refs['annotations.jsonl']):
        identity = (row['transcript_id'], row['annotation_type'], row['annotator_id'], row['interface_version'])
        if identity in seen:
            raise ValueError('Duplicate annotation pass identity')
        seen.add(identity)
        if row['annotation_type'] == 'caption':
            rejected.append({'source': ref, 'reason': 'caption_not_sar'})
            continue
        if row['annotation_type'] not in ('scaffolding', 'rapport'):
            raise ValueError('Unsupported annotation type')
        for position, annotation in enumerate(row['turn_annotations']):
            family = 'tm-' + row['transcript_id']
            eligibility = deepcopy(families.get(family, {'group': family, 'families': [family],
                'eligible': False, 'reasons': ['unregistered_source_family']}))
            key = annotation_key(row['transcript_id'], row['annotation_type'], row['annotator_id'], annotation)
            joined, join_reason = exact_join(gt_index.get(key, []), annotation)
            labels = ground_truth_targets(joined[0]) if joined else {n: unknown(join_reason) for n in TARGETS}
            if joined:
                gt_used.add(native.digest(joined[1]))
            views, view_reasons = project_annotation(transcripts.get(row['transcript_id']), annotation)
            source = {**ref, 'turn_annotation_index': position, 'turn_annotation_sha256': native.digest(annotation)}
            example_id = 'tm-sar-' + native.digest(source)
            for name, label in labels.items():
                boundary = TARGETS[name]
                label['fit_mask'] = int(bool(label['mask'] and eligibility['eligible'] and views[boundary]))
                label['fit_reason'] = (None if label['fit_mask'] else view_reasons.get(boundary)
                    or ('source_family_excluded' if not eligibility['eligible'] else label['reason']))
            examples.append({'id': example_id, 'kind': 'source_sar', 'family': family,
                'split_family': eligibility['group'], 'transcript_id': row['transcript_id'],
                'annotator_id': row['annotator_id'], 'annotation_type': row['annotation_type'],
                'interface_version': row['interface_version'], 'span': [annotation.get('turn_number_start'),
                    annotation.get('turn_number_end')], 'cut_turn': annotation.get('cut_turn'),
                'moment_id': annotation.get('moment_id'), 'source': source,
                'transcript_source': transcript_refs.get(row['transcript_id']),
                'ground_truth_source': joined[1] if joined else None, 'join_reason': join_reason,
                'ground_truth_candidates': [candidate[1] for candidate in gt_index.get(key, [])],
                'human_sar': {k: {'text': annotation.get(k), 'origin': 'direct_human_annotation',
                    'known': isinstance(annotation.get(k), str) and bool(annotation[k].strip())}
                    for k in ('situation', 'action', 'result')},
                'source_mapping': deepcopy(joined[0]) if joined else None,
                'targets': labels, 'eligibility': eligibility, 'view_rejections': view_reasons})
            inputs.append({'id': example_id, 'views': views})
    # Frozen replay moments are a distinct reference lane, not surrogate SAR.
    # The gold dimension establishes the chosen need, not absence of the other
    # need, the action actually taken, or any result of a changed conversation.
    for row, ref in zip(rows['moments.jsonl'], refs['moments.jsonl']):
        provenance = row['provenance']
        transcript_id = provenance['conv_id'].rsplit('_', 1)[-1]
        family = 'tm-' + transcript_id
        labels = {n: unknown('frozen_moment_does_not_supply_this_sar_target') for n in TARGETS}
        labels['situation.' + row['dimension']] = target(row['dimension'], {row['dimension']: 1},
            'rubric.gold', 'published_frozen_situation_gate')
        for label in labels.values():
            label.update(fit_mask=0, fit_reason='protected_reference_family')
        views = {b: None for b in set(TARGETS.values())}
        reasons = {}
        record = next((r for r in records if r.dataset == 'tutormoments' and r.value['id'] == row['id']), None)
        if record is None:
            raise ValueError('Missing frozen moment in full source snapshot')
        try:
            tm.validate_records([row])
            problem, turns, _ = native.source_prefix(record)
            native.check_context(problem, turns)
            views['pre_action'] = input_view(row['context'], 'pre_action', provenance['cut_turn'])
        except (ValueError, native.Rejected) as error:
            reasons['pre_action'] = str(error)
        example_id = 'tm-frozen-' + native.digest(ref)
        examples.append({'id': example_id, 'kind': 'frozen_situation_reference',
            'family': family, 'split_family': families[family]['group'], 'transcript_id': transcript_id,
            'annotator_id': provenance.get('annotator_id'), 'source': ref, 'moment_id': provenance.get('moment_id'),
            'frozen_moment_id': row['id'], 'span': [provenance.get('turn_start'), provenance.get('turn_end')],
            'cut_turn': provenance['cut_turn'], 'cut_votes': deepcopy(provenance.get('cut_votes')),
            'targets': labels, 'eligibility': {'eligible': False, 'reasons': ['protected_reference_family']},
            'view_rejections': reasons})
        inputs.append({'id': example_id, 'views': views})
    apply_disagreements(examples)
    evidence_groups(examples)
    split = split_families(examples)
    aliases = alias_requirements(records, snapshot, audit, families, examples)
    proposal = admission_proposal(records, registry, snapshot, audit, families, aliases, examples, inputs)
    # Generate the original proposal BEFORE applying admission so its sealed
    # content, full closure and parent-approved hash remain reproducible.
    admission = validate_source_registry(source_registry, proposal, snapshot)
    if source_registry is not None:
        split = apply_source_admission(source_registry, examples, inputs)
    sar_examples = [e for e in examples if e['kind'] == 'source_sar']
    sar_groups = {e['split_family']: e['eligibility'] for e in sar_examples}
    views_by_id = {row['id']: row['views'] for row in inputs}
    unjoined = [{'source': ref, 'moment': moment, 'reason': 'not_uniquely_joined_to_human_sar'}
                for candidates in gt_index.values() for moment, ref in candidates
                if native.digest(ref) not in gt_used]
    manifest = {'schema_version': 1, 'dataset': tm.DATASET, 'revision': REVISION,
        'scope': 'source_supervision_only_not_native_episode_labels',
        'assets': snapshot['assets'], 'registry_sha256': native.digest(registry),
        'full_family_closure_sha256': native.digest(audit), 'full_family_source_records': len(records),
        'input_rows': {name: len(value) for name, value in rows.items()},
        'missing_assets': [n for n, a in snapshot['assets'].items() if a['status'] == 'missing'],
        'source_examples': len(examples), 'source_sar_examples': sum(e['kind'] == 'source_sar' for e in examples),
        'sar_corpus_status': 'missing_source_assets' if any(snapshot['assets'][n]['status'] == 'missing'
                                                         for n in SAR_ASSETS) else 'imported',
        'frozen_reference_examples': sum(e['kind'] == 'frozen_situation_reference' for e in examples),
        'unjoined_ground_truth_moments': len(unjoined),
        'sar_families': {'transcripts': len({e['family'] for e in sar_examples}),
            'student_groups': len(sar_groups), 'eligible': sum(g['eligible'] for g in sar_groups.values()),
            'protected_groups': sum('protected_reference_family' in g['reasons'] or 'protected_family' in g['reasons']
                                    for g in sar_groups.values()),
            'unregistered_only_groups': sum(g['reasons'] == ['unregistered_source_family'] for g in sar_groups.values())},
        'source_aliases': {'transcripts': len(aliases['transcripts']),
            'missing_native_registry_family': sum(not t['native_registry_family_present'] for t in aliases['transcripts']),
            'frozen_composite_joins_verified': sum(len(t['frozen_moments']) for t in aliases['transcripts'])},
        'admission_proposal_status': proposal['status'],
        'admission_proposal_sha256': proposal.get('proposal_sha256'),
        'source_admission': admission,
        'sar_known_labels': {n: sum(e['targets'][n]['mask'] for e in sar_examples) for n in TARGETS},
        'sar_join_reasons': dict(Counter(e['join_reason'] or 'exact_join' for e in sar_examples)),
        'sar_temporal_views': {b: sum(views_by_id[e['id']][b] is not None for e in sar_examples)
                               for b in ('pre_action', 'action', 'retrospective')},
        'sar_nonprotected_temporal_labels': {n: sum(bool(e['targets'][n]['mask']
            and not e['targets'][n]['disagreement'] and views_by_id[e['id']][TARGETS[n]]
            and not {'protected_reference_family', 'protected_family'}.intersection(e['eligibility']['reasons']))
            for e in sar_examples) for n in TARGETS},
        'labels': {n: {'known': sum(e['targets'][n]['mask'] for e in examples),
                       'unknown': sum(not e['targets'][n]['mask'] for e in examples),
                       'fit_eligible': sum(e['targets'][n]['fit_mask'] for e in examples),
                       'unique_known_evidence_groups': len({e['targets'][n]['evidence_group'] for e in examples
                                                           if e['targets'][n]['mask']}),
                       'conflicting': sum(bool(e['targets'][n]['disagreement']) for e in examples)} for n in TARGETS},
        'exclusions': dict(Counter(reason for e in examples for reason in e['eligibility']['reasons'])),
        'view_rejections': dict(Counter(reason for e in examples for reason in e['view_rejections'].values())),
        'rejected_annotation_passes': dict(Counter(r['reason'] for r in rejected)),
        'split_status': split['status'], 'examples_sha256': native.digest(examples),
        'inputs_sha256': native.digest(inputs), 'split_sha256': native.digest(split)}
    return {'manifest.json': manifest, 'source-targets.json': examples, 'inputs.json': inputs,
            'family-splits.json': split, 'family-closure.json': {'native': audit, 'source_groups': families},
            'rejected.json': rejected, 'unjoined-ground-truth.json': unjoined,
            'alias-requirements.json': aliases, 'admission-proposal.json': proposal,
            'source-admission.json': admission}


def write_bundle(bundle, output):
    directory = native.output_directory(output)
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, value in bundle.items():
        fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(native.canonical(value) + '\n')
    return directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('fetch', 'inspect', 'build'))
    parser.add_argument('--cache', type=Path, default=sources.CACHE)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--source-registry', type=Path, default=SOURCE_REGISTRY,
                        help='Exact source-probe admission sidecar; absence keeps fitting denied')
    args = parser.parse_args()
    if args.command == 'build' and args.output is None:
        parser.error('build requires an explicit --output in an ignored output directory')
    if args.command in ('inspect', 'fetch') and args.output is not None:
        parser.error('Only build accepts --output')
    if args.command == 'fetch':
        print(json.dumps(fetch_sources(args.cache), indent=2))
        return
    records, snapshot = load_snapshot(args.cache)
    bundle = build_supervision(records, native.load_registry(), snapshot,
                               load_source_registry(args.source_registry))
    if args.command == 'build':
        write_bundle(bundle, args.output)
    print(json.dumps(bundle['manifest.json'], indent=2))


if __name__ == '__main__':
    main()
