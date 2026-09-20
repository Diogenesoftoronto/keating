"""Authored fixtures conforming to the pinned publisher schemas; no source PII."""
from copy import deepcopy
import io
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import native_scenarios as native
import tutormoments_supervision as sar


TRANSCRIPT = '01234567-89ab-4cde-8fab-0123456789ab'
PERSON = '11111111-1111-4111-8111-111111111111'
ANNOTATOR = '22222222-2222-4222-8222-222222222222'
FUTURE = 'FUTURE_OUTCOME_SENTINEL'
SECRET = 'PRIVATE_SAR_SENTINEL'


def transcript(identity=TRANSCRIPT):
    return {'transcript_id': identity, 'session': {'student_id': PERSON, 'tutor_id': 'tutor', 'session_id': identity},
            'enrichments': [{'before_turn': 3, 'content': 'HIDDEN_SCREEN_KEY'}],
            'turns': [{'turn_number': 1, 'role': 'Tutor', 'text': 'What is 9 + 4?'},
                      {'turn_number': 2, 'role': 'Student', 'text': 'I got 5. Help me think.'},
                      {'turn_number': 3, 'role': 'Tutor', 'text': 'Should the sum exceed 9?'},
                      {'turn_number': 4, 'role': 'Student', 'text': FUTURE},
                      {'turn_number': 5, 'role': 'Tutor', 'text': 'BEYOND_ANNOTATED_SPAN'}]}


def annotation():
    return {'turn_number_start': 2, 'turn_number_end': 4, 'cut_turn': 2,
            'moment_id': 'moment-authored-1', 'annotation_timestamp': '2026-01-01T00:00:00',
            'situation': SECRET + ' situation', 'action': SECRET + ' action',
            'result': SECRET + ' result'}


def ground_truth():
    a = annotation()
    return {'turn_start': 2, 'turn_end': 4, 'cut_turn': 2, 'moment_id': a['moment_id'],
            'annotation_type': 'scaffolding', 'annotator_id': ANNOTATOR,
            **{k: a[k] for k in ('situation', 'action', 'result')},
            'situation_label': {'scaffolding': 'yes', 'rigor': 'no_mention'},
            'situation_label_agg': 'scaffolding', 'action_direction_agg': 'rigor',
            'student_outcome_agg': 'no_evidence', 'strategy_label': 'partial',
            'action_decomposed': ['authored action facet'], 'result_decomposed': [],
            'overscaffold_decomposed': []}


def moment(identity=TRANSCRIPT, number=0):
    return {'id': f'fixture-{number}', 'dimension': 'scaffolding',
            'rubric': {'gold': 'scaffolding', 'hint': SECRET},
            'provenance': {'conv_id': 'tutor_' + PERSON + '_' + identity, 'cut_turn': 2,
                           'turn_start': 2, 'turn_end': 4, 'moment_id': 'moment-authored-1'},
            'context': [{'turn_number': t['turn_number'], 'role': t['role'].lower(), 'text': t['text']}
                        for t in transcript(identity)['turns'][:2]],
            'student': {'reference': FUTURE, 'trait': 'PRIVATE_PERSONA'}}


def fixture():
    registry = native.load_registry()
    m = moment()
    policy = registry['sources']['tutormoments']
    record = native.SourceRecord('tutormoments', policy['revision'], 'fixture', 'benchmark',
        'moments.jsonl', policy['assets']['moments.jsonl'], 'moments.jsonl#row=0', native.digest(m), m)
    snapshot = {'rows': {'transcripts.jsonl': [transcript()], 'annotations.jsonl': [{
        'transcript_id': TRANSCRIPT, 'annotation_type': 'scaffolding', 'annotator_id': ANNOTATOR,
        'interface_version': 'v1_cut_point', 'turn_annotations': [annotation()]}],
        'ground_truth.jsonl': [{'conversation_id': TRANSCRIPT, 'key_moments': [ground_truth()]}],
        'moments.jsonl': [m]}}
    seal_snapshot(snapshot)
    return [record], registry, snapshot


def seal_snapshot(snapshot):
    snapshot['refs'] = {name: [{'asset': name, 'line_number': i + 1,
        'record_sha256': native.digest(r), 'line_sha256': sar.sha256((native.canonical(r) + '\n').encode())}
        for i, r in enumerate(rows)] for name, rows in snapshot['rows'].items()}
    snapshot['assets'] = {name: {'status': 'verified', 'sha256': native.digest(rows), 'rows': len(rows)}
                          for name, rows in snapshot['rows'].items()}


class TemporalSupervisionTests(unittest.TestCase):
    def test_three_views_exclude_future_labels_and_unallowlisted_fields(self):
        views, reasons = sar.project_annotation(transcript(), annotation())
        self.assertEqual(reasons, {})
        self.assertEqual([v['latest_allowed_turn'] for v in (views['pre_action'], views['action'], views['retrospective'])], [2, 3, 4])
        for boundary in ('pre_action', 'action'):
            self.assertNotIn(FUTURE, json.dumps(views[boundary]))
        self.assertIn(FUTURE, json.dumps(views['retrospective']))
        self.assertNotIn('BEYOND_ANNOTATED_SPAN', json.dumps(views))
        self.assertNotIn('HIDDEN_SCREEN_KEY', json.dumps(views))
        self.assertNotIn(SECRET, json.dumps(views))

    def test_future_mutation_cannot_change_prefix_or_action_hash(self):
        original, _ = sar.project_annotation(transcript(), annotation())
        altered = transcript()
        altered['turns'][3]['text'] = 'A different later response.'
        changed, _ = sar.project_annotation(altered, annotation())
        for b in ('pre_action', 'action'):
            self.assertEqual(original[b], changed[b])
        self.assertNotEqual(original['retrospective']['input_sha256'], changed['retrospective']['input_sha256'])

    def test_multiturn_action_label_does_not_relabel_first_response(self):
        a = annotation()
        a['turn_number_end'] = 5
        views, reasons = sar.project_annotation(transcript(), a)
        self.assertIsNone(views['action'])
        self.assertEqual(reasons['action'], 'action_span_crosses_learner_feedback')
        self.assertIsNotNone(views['pre_action'])
        self.assertIsNotNone(views['retrospective'])

    def test_action_before_cut_not_claimed_as_new_action(self):
        a = annotation()
        a['turn_number_start'] = 1
        views, reasons = sar.project_annotation(transcript(), a)
        self.assertIsNone(views['action'])
        self.assertEqual(reasons['action'], 'action_span_starts_before_decision')

    def test_missing_cuts_transcripts_visuals_and_turns_are_rejections(self):
        for mutate, reason in (
            (lambda t, a: a.update(cut_turn=None), 'missing_or_invalid_annotator_cut'),
            (lambda t, a: t['turns'][0].update(text='Use the worksheet to solve 9 + 4?'), 'missing_visual_context'),
            (lambda t, a: t['turns'].pop(0), 'missing_or_invalid_transcript_turns'),
            (lambda t, a: t['turns'][1].update(role='Tutor'), 'cut_not_at_learner_decision')):
            t, a = transcript(), annotation()
            mutate(t, a)
            views, reasons = sar.project_annotation(t, a)
            self.assertTrue(all(v is None for v in views.values()))
            self.assertEqual(set(reasons.values()), {reason})

    def test_no_learner_result_is_not_negative_learning(self):
        a = annotation()
        a['turn_number_end'] = 3
        views, reasons = sar.project_annotation(transcript(), a)
        self.assertIsNotNone(views['action'])
        self.assertIsNone(views['retrospective'])
        self.assertEqual(reasons['retrospective'], 'missing_learner_consequence')


class LabelAndJoinTests(unittest.TestCase):
    def test_rapport_and_scaffolding_effectiveness_are_separate_constructs(self):
        examples = []
        for kind, value in (('rapport', 'effective'), ('scaffolding', 'ineffective')):
            g = ground_truth()
            g['strategy_label'] = value
            labels = sar.ground_truth_targets(g)
            for label in labels.values():
                label['fit_mask'] = label['mask']
            examples.append({'id': kind, 'kind': 'source_sar', 'transcript_id': TRANSCRIPT,
                'span': [2, 4], 'annotation_type': kind, 'targets': labels})
        sar.apply_disagreements(examples)
        self.assertTrue(all(e['targets']['result.effectiveness']['fit_mask'] for e in examples))

    def test_aggregate_copies_share_evidence_and_weight_not_independent_votes(self):
        examples = []
        for annotator in ('one', 'two', 'three'):
            labels = sar.ground_truth_targets(ground_truth())
            for label in labels.values():
                label['fit_mask'] = label['mask']
            examples.append({'transcript_id': TRANSCRIPT, 'span': [2, 4],
                             'annotation_type': 'scaffolding', 'annotator_id': annotator, 'targets': labels})
        sar.evidence_groups(examples)
        shared = [e['targets']['action.rigor'] for e in examples]
        self.assertEqual(len({label['evidence_group'] for label in shared}), 1)
        self.assertAlmostEqual(sum(label['fit_weight'] for label in shared), 1)
        self.assertEqual(len({e['targets']['situation.scaffolding']['evidence_group'] for e in examples}), 3)

    def test_actual_action_is_not_desired_situation(self):
        labels = sar.ground_truth_targets(ground_truth())
        self.assertEqual(labels['situation.scaffolding']['value'], 1)
        self.assertEqual(labels['action.scaffolding']['value'], 0)
        self.assertEqual(labels['action.rigor']['value'], 1)
        self.assertEqual(labels['result.effectiveness']['value'], 'partial')
        self.assertEqual(labels['result.positive']['mask'], 0)

    def test_unknown_is_not_negative_and_both_is_not_exclusive(self):
        g = ground_truth()
        for value in ('unclear', 'unknown', None, 'new-unreviewed-category'):
            g['action_direction_agg'] = value
            self.assertEqual(sar.ground_truth_targets(g)['action.scaffolding']['mask'], 0)
        g['action_direction_agg'] = 'both'
        labels = sar.ground_truth_targets(g)
        self.assertEqual([labels[f'action.{c}']['value'] for c in ('scaffolding', 'rigor')], [1, 1])
        self.assertEqual(labels['situation.rigor']['mask'], 0)

    def test_ambiguous_and_conflicting_identity_joins_stay_unknown(self):
        candidate = (ground_truth(), {'asset': 'ground_truth.jsonl'})
        self.assertEqual(sar.exact_join([candidate, candidate], annotation())[1], 'ambiguous_ground_truth_join')
        a = annotation()
        a['cut_turn'] = 3
        self.assertEqual(sar.exact_join([candidate], a)[1], 'missing_exact_ground_truth_join')

    def test_exact_sar_text_required_for_join(self):
        records, registry, snapshot = fixture()
        snapshot['rows']['ground_truth.jsonl'][0]['key_moments'][0]['action'] = 'Different action'
        seal_snapshot(snapshot)
        bundle = sar.build_supervision(records, registry, snapshot)
        example = bundle['source-targets.json'][0]
        self.assertEqual(example['join_reason'], 'missing_exact_ground_truth_join')
        self.assertEqual(example['targets']['action.rigor']['mask'], 0)
        self.assertEqual(len(bundle['unjoined-ground-truth.json']), 1)

    def test_disagreement_preserves_individual_values_without_fitting(self):
        records, registry, snapshot = fixture()
        row = deepcopy(snapshot['rows']['annotations.jsonl'][0])
        row['annotator_id'] = '33333333-3333-4333-8333-333333333333'
        snapshot['rows']['annotations.jsonl'].append(row)
        g = ground_truth()
        g['annotator_id'] = row['annotator_id']
        g['action_direction_agg'] = 'scaffolding'
        snapshot['rows']['ground_truth.jsonl'][0]['key_moments'].append(g)
        seal_snapshot(snapshot)
        examples = sar.build_supervision(records, registry, snapshot)['source-targets.json'][:2]
        self.assertEqual([e['targets']['action.scaffolding']['value'] for e in examples], [0, 1])
        for e in examples:
            self.assertEqual(e['targets']['action.scaffolding']['fit_mask'], 0)
            self.assertEqual(len(e['targets']['action.scaffolding']['disagreement']), 2)

    def test_frozen_gate_does_not_label_other_need_action_or_result(self):
        records, registry, snapshot = fixture()
        bundle = sar.build_supervision(records, registry, snapshot)
        e = bundle['source-targets.json'][-1]
        self.assertEqual(e['targets']['situation.scaffolding']['value'], 1)
        self.assertEqual(sum(t['mask'] for t in e['targets'].values()), 1)
        self.assertEqual(sum(t['fit_mask'] for t in e['targets'].values()), 0)
        self.assertNotIn(SECRET, json.dumps(bundle['inputs.json']))


class IntegrityAndFamilyTests(unittest.TestCase):
    def test_source_proposal_keeps_unpartitioned_release_and_no_live_admission(self):
        records, registry, snapshot = fixture()
        identity = '44444444-4444-4444-8444-444444444444'
        t = transcript(identity)
        t['session']['student_id'] = '55555555-5555-4555-8555-555555555555'
        snapshot['rows']['transcripts.jsonl'].append(t)
        a = deepcopy(snapshot['rows']['annotations.jsonl'][0])
        a['transcript_id'] = identity
        snapshot['rows']['annotations.jsonl'].append(a)
        g = deepcopy(snapshot['rows']['ground_truth.jsonl'][0])
        g['conversation_id'] = identity
        snapshot['rows']['ground_truth.jsonl'].append(g)
        seal_snapshot(snapshot)
        original_registry = deepcopy(registry)
        b = sar.build_supervision(records, registry, snapshot)
        proposal = b['admission-proposal.json']
        policy = proposal['source_supervision']['sources']['tutormoments']
        self.assertEqual(policy['allowed_families'], ['tm-' + identity])
        self.assertEqual(policy['original_partition'], 'unpartitioned_published_source_release')
        self.assertFalse(policy['publisher_loader_split_is_training_admission'])
        self.assertEqual(proposal['source_supervision']['default'], 'deny')
        self.assertEqual(proposal['counts']['current_fit_eligible_families'], 0)
        self.assertEqual(registry, original_registry)
        self.assertTrue(all(not e['eligibility']['eligible'] for e in b['source-targets.json']))
        unsigned = deepcopy(proposal)
        digest = unsigned.pop('proposal_sha256')
        self.assertEqual(digest, native.digest(unsigned))
        # A protected same-person connection removes the candidate, rather
        # than grandfathering the previously proposed explicit allowlist.
        snapshot['rows']['transcripts.jsonl'][-1]['session']['student_id'] = PERSON
        seal_snapshot(snapshot)
        blocked = sar.build_supervision(records, registry, snapshot)['admission-proposal.json']
        self.assertEqual(blocked['counts']['surviving_sar_families'], 0)

    def test_native_test_alias_propagates_through_same_person_family_closure(self):
        registry = native.load_registry()
        second = '44444444-4444-4444-8444-444444444444'
        audit = {'families': [{'family': 'bridge-conversation-fixture',
            'aliases': ['bridge-conversation-fixture', 'tm-' + TRANSCRIPT],
            'members': [{'original_split': 'test'}], 'decision': 'protected_source_split'}]}
        with patch.object(native, 'build_native_scenarios', return_value=audit):
            _, families = sar.family_census([], registry, [transcript(), transcript(second)])
        self.assertEqual(families['tm-' + second]['group'], families['tm-' + TRANSCRIPT]['group'])
        self.assertIn('protected_reference_family', families['tm-' + second]['reasons'])
        self.assertIn('protected_source_split', families['tm-' + second]['reasons'])
        self.assertFalse(families['tm-' + second]['eligible'])

    def test_proposed_partition_policy_is_grouped_reproducible_and_authored(self):
        groups = [f'group-{i}' for i in range(55)]
        partition = sar.proposed_partitions(groups)
        self.assertEqual(partition, sar.proposed_partitions(reversed(groups)))
        self.assertEqual([len(partition[k]) for k in ('train', 'calibration', 'test')], [33, 11, 11])
        self.assertEqual(set(sum((partition[k] for k in ('train', 'calibration', 'test')), [])), set(groups))
        self.assertFalse(partition['policy']['selected_using_labels_or_model_scores'])
        self.assertFalse(partition['policy']['release_holdout'])
        self.assertEqual(sar.proposed_partitions(groups[:4])['status'], 'insufficient_candidate_groups')

    def test_alias_proposal_does_not_grant_admission_and_checks_composite_identity(self):
        records, registry, snapshot = fixture()
        bundle = sar.build_supervision(records, registry, snapshot)
        proposal = bundle['alias-requirements.json']['transcripts'][0]
        self.assertEqual(proposal['proposed_aliases']['ground_truth.conversation_id'], TRANSCRIPT)
        self.assertEqual(proposal['admission'], 'not_granted')
        self.assertEqual(bundle['manifest.json']['sar_families']['eligible'], 0)
        snapshot['rows']['transcripts.jsonl'][0]['session']['tutor_id'] = 'other-tutor'
        seal_snapshot(snapshot)
        with self.assertRaisesRegex(ValueError, 'composite identity'):
            sar.build_supervision(records, registry, snapshot)

    def test_fetch_verifies_bytes_and_never_overwrites_cached_data(self):
        body = b'{"authored":true}\n'
        pin = {'bytes': len(body), 'sha256': sar.sha256(body)}
        with tempfile.TemporaryDirectory() as cache:
            with patch.object(sar.urllib.request, 'urlopen', return_value=io.BytesIO(body)) as request:
                report = sar.fetch_asset('annotations.jsonl', pin, cache)
                self.assertEqual(request.call_args.args[0], sar.SCHEMA_URL + 'annotations.jsonl')
                self.assertEqual(report['sha256'], pin['sha256'])
            with patch.object(sar.urllib.request, 'urlopen', side_effect=AssertionError('already cached')):
                self.assertEqual(report, sar.fetch_asset('annotations.jsonl', pin, cache))
                path = Path(cache) / 'tutormoments' / sar.REVISION / 'annotations.jsonl'
                path.write_bytes(b'altered')
                with self.assertRaisesRegex(ValueError, 'byte count'):
                    sar.fetch_asset('annotations.jsonl', pin, cache)
                self.assertEqual(path.read_bytes(), b'altered')

    def test_fetch_rejects_truncated_corrupt_and_oversized_before_publish(self):
        body = b'expected'
        pin = {'bytes': len(body), 'sha256': sar.sha256(body)}
        for received in (body[:-1], b'corrupt!', body + b'overflow'):
            with tempfile.TemporaryDirectory() as cache:
                with patch.object(sar.urllib.request, 'urlopen', return_value=io.BytesIO(received)):
                    with self.assertRaises(ValueError):
                        sar.fetch_asset('annotations.jsonl', pin, cache)
                self.assertFalse(list(Path(cache).rglob('*.jsonl')))

    def test_protected_family_blocks_all_derivatives_even_development_exposed(self):
        records, registry, snapshot = fixture()
        registry['development_exposed'].append({'family': 'tm-' + TRANSCRIPT,
            'source_record_ids': ['fixture-0'], 'evidence': 'authored fixture'})
        b = sar.build_supervision(records, registry, snapshot)
        self.assertTrue(all(not e['eligibility']['eligible'] for e in b['source-targets.json']))
        self.assertEqual(b['manifest.json']['labels']['action.rigor']['fit_eligible'], 0)
        self.assertEqual(b['family-splits.json']['train'], [])

    def test_full_person_family_closure_includes_unselected_transcripts(self):
        records, registry, snapshot = fixture()
        other = '44444444-4444-4444-8444-444444444444'
        snapshot['rows']['transcripts.jsonl'].append(transcript(other))
        seal_snapshot(snapshot)
        families = sar.build_supervision(records, registry, snapshot)['family-closure.json']['source_groups']
        self.assertEqual(families['tm-' + TRANSCRIPT]['group'], families['tm-' + other]['group'])
        self.assertIn('protected_reference_family', families['tm-' + other]['reasons'])
        self.assertFalse(families['tm-' + other]['eligible'])

    def test_unapproved_snapshot_blocks_family(self):
        records, registry, snapshot = fixture()
        registry['sources']['tutormoments']['revision'] = '0' * 40
        b = sar.build_supervision(records, registry, snapshot)
        self.assertIn('unapproved_snapshot', b['source-targets.json'][0]['eligibility']['reasons'])

    def test_post_verification_mutation_rejected(self):
        records, registry, snapshot = fixture()
        snapshot['rows']['annotations.jsonl'][0]['turn_annotations'][0]['result'] += ' tampered'
        with self.assertRaisesRegex(ValueError, 'mutated'):
            sar.build_supervision(records, registry, snapshot)

    def test_exact_file_and_line_hashes_and_git_blob_verification(self):
        body = b'{"a": 1}\r\n'
        for pin in ({'bytes': len(body), 'sha256': sar.sha256(body)},
                    {'bytes': len(body), 'git_blob_sha1': hashlib.sha1(f'blob {len(body)}\0'.encode() + body).hexdigest()}):
            with tempfile.TemporaryDirectory() as directory:
                p = Path(directory) / 'annotations.jsonl'
                p.write_bytes(body)
                rows, refs, report = sar.read_pinned(p, pin)
                self.assertEqual(refs[0]['line_sha256'], sar.sha256(body))
                self.assertEqual(report['sha256'], sar.sha256(body))
                p.write_bytes(body.replace(b'1', b'2'))
                with self.assertRaises(ValueError):
                    sar.read_pinned(p, pin)

    def test_split_is_order_independent_and_never_splits_derivatives(self):
        examples = [{'split_family': f'f-{i}', 'eligibility': {'eligible': True},
                     'targets': {'label': {'fit_mask': 1}}} for i in range(10)]
        splits = sar.split_families(examples)
        self.assertEqual(splits, sar.split_families(list(reversed(examples)) + examples))
        self.assertEqual([len(splits[k]) for k in ('train', 'calibration', 'test')], [6, 2, 2])
        self.assertEqual(len(set(sum((splits[k] for k in ('train', 'calibration', 'test')), []))), 10)
        self.assertEqual(sar.split_families(examples[:4])['train'], [])

    def test_output_is_explicit_private_ignored_and_exclusive(self):
        with self.assertRaises(ValueError):
            sar.write_bundle({}, native.ROOT / 'docs/sar-should-not-exist')
        output_root = native.ROOT / '.keating/outputs'
        output_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output_root) as parent:
            path = Path(parent) / 'new'
            sar.write_bundle({'manifest.json': {'test': True}}, path)
            self.assertEqual((path / 'manifest.json').stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                sar.write_bundle({}, path)

    def test_missing_cache_is_reported_without_network_or_invented_sar(self):
        records, registry, snapshot = fixture()
        for name in sar.SAR_ASSETS:
            snapshot['rows'][name], snapshot['refs'][name] = [], []
            snapshot['assets'][name] = {'status': 'missing', 'expected': sar.SAR_ASSETS[name]}
        with patch('socket.create_connection', side_effect=AssertionError('network forbidden')):
            b = sar.build_supervision(records, registry, snapshot)
        self.assertEqual(b['manifest.json']['source_sar_examples'], 0)
        self.assertEqual(b['manifest.json']['frozen_reference_examples'], 1)
        self.assertEqual(len(b['manifest.json']['missing_assets']), 3)
        self.assertEqual(b['manifest.json']['labels']['action.scaffolding']['known'], 0)


def source_admission_fixture():
    records, registry, snapshot = fixture()
    # Six source families in five student groups plus the protected reference.
    for i in range(6):
        identity = f'{i + 16:08x}-4444-4444-8444-444444444444'
        person = f'{max(i, 1) + 32:08x}-5555-4555-8555-555555555555'
        t = transcript(identity)
        t['session']['student_id'] = person
        snapshot['rows']['transcripts.jsonl'].append(t)
        a = deepcopy(snapshot['rows']['annotations.jsonl'][0])
        a['transcript_id'] = identity
        snapshot['rows']['annotations.jsonl'].append(a)
        g = deepcopy(snapshot['rows']['ground_truth.jsonl'][0])
        g['conversation_id'] = identity
        snapshot['rows']['ground_truth.jsonl'].append(g)
    seal_snapshot(snapshot)
    proposal = sar.build_supervision(records, registry, snapshot)['admission-proposal.json']
    sidecar = {'schema_version': 1, 'base_native_registry_sha256': native.digest(registry),
               'proposal_sha256': proposal['proposal_sha256'],
               'source_supervision': deepcopy(proposal['source_supervision'])}
    return records, registry, snapshot, sidecar


def build_authored_admission(records, registry, snapshot, sidecar):
    # Explicit authored-byte pins; these tests never disguise fixtures as the
    # released dataset. The real build separately checks the published pins.
    pins = {name: {'sha256': snapshot['assets'][name].get('sha256')}
            for name in sar.SAR_ASSETS}
    with patch.object(sar, 'SAR_ASSETS', pins):
        return sar.build_supervision(records, registry, snapshot, sidecar)


class SourceAdmissionTests(unittest.TestCase):
    def test_exact_sidecar_admits_source_only_without_changing_inputs_or_cuts(self):
        records, registry, snapshot, sidecar = source_admission_fixture()
        before = deepcopy((registry, snapshot, sidecar))
        baseline = sar.build_supervision(records, registry, snapshot)
        with patch('socket.create_connection', side_effect=AssertionError('network forbidden')):
            admitted = build_authored_admission(records, registry, snapshot, sidecar)
        self.assertEqual((registry, snapshot, sidecar), before)
        self.assertEqual(baseline['admission-proposal.json'], admitted['admission-proposal.json'])
        self.assertEqual(baseline['inputs.json'], admitted['inputs.json'])
        for old, new in zip(baseline['source-targets.json'], admitted['source-targets.json']):
            self.assertEqual(old['cut_turn'], new['cut_turn'])
            self.assertEqual(old['view_rejections'], new['view_rejections'])
            self.assertEqual(old['source'], new['source'])
            self.assertEqual([t['mask'] for t in old['targets'].values()], [t['mask'] for t in new['targets'].values()])
            if old['kind'] == 'frozen_situation_reference' or old['family'] == 'tm-' + TRANSCRIPT:
                self.assertEqual(old, new)
            else:
                self.assertTrue(new['eligibility']['eligible'])
                self.assertEqual(new['targets']['action.rigor']['fit_mask'], 1)
                self.assertEqual(new['targets']['result.positive']['fit_mask'], 0)
        self.assertEqual(admitted['manifest.json']['sar_families']['eligible'], 5)

    def test_absent_sidecar_denies_and_malformed_sidecar_never_admits(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'registry.json'
            self.assertIsNone(sar.load_source_registry(p))
            p.write_text('{"schema_version": 1, "schema_version": 2}')
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                sar.load_source_registry(p)
        records, registry, snapshot, sidecar = source_admission_fixture()
        b = sar.build_supervision(records, registry, snapshot)
        self.assertEqual(b['source-admission.json']['status'], 'absent_default_deny')
        self.assertTrue(all(not t['fit_mask'] for e in b['source-targets.json'] for t in e['targets'].values()))
        for malformed in ([], {}, {**sidecar, 'schema_version': True}, {**sidecar, 'extra': 1}):
            with self.assertRaisesRegex(ValueError, 'envelope'):
                build_authored_admission(records, registry, snapshot, malformed)

    def test_changed_native_hash_or_proposal_hash_is_rejected(self):
        for key in ('base_native_registry_sha256', 'proposal_sha256'):
            records, registry, snapshot, sidecar = source_admission_fixture()
            sidecar[key] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                build_authored_admission(records, registry, snapshot, sidecar)

    def test_allowlist_groups_partitions_purpose_and_pins_must_match_exactly(self):
        for change in ('family', 'group', 'partition', 'purpose', 'asset', 'reference', 'inherit', 'default', 'extra'):
            with self.subTest(change=change):
                records, registry, snapshot, sidecar = source_admission_fixture()
                section = sidecar['source_supervision']
                p = section['sources']['tutormoments']
                if change == 'family': p['allowed_families'].append('tm-' + TRANSCRIPT)
                elif change == 'group': p['family_groups'][next(iter(p['family_groups']))].pop()
                elif change == 'partition': p['partitions']['train'], p['partitions']['test'] = p['partitions']['test'], p['partitions']['train']
                elif change == 'purpose': p['purposes'].append('native_training')
                elif change == 'asset': p['assets']['annotations.jsonl'] = '0' * 64
                elif change == 'reference': p['protected_reference_assets']['moments.jsonl'] = '0' * 64
                elif change == 'inherit': p['native_label_inheritance'] = True
                elif change == 'default': section['default'] = 'allow'
                else: p['unreviewed'] = True
                with self.assertRaisesRegex(ValueError, 'exact section'):
                    build_authored_admission(records, registry, snapshot, sidecar)

    def test_new_same_person_protected_edge_invalidates_reviewed_closure(self):
        records, registry, snapshot, sidecar = source_admission_fixture()
        snapshot['rows']['transcripts.jsonl'][1]['session']['student_id'] = PERSON
        seal_snapshot(snapshot)
        with self.assertRaisesRegex(ValueError, 'proposal/closure'):
            build_authored_admission(records, registry, snapshot, sidecar)

    def test_full_source_records_cannot_be_dropped_after_review(self):
        records, registry, snapshot, sidecar = source_admission_fixture()
        with self.assertRaisesRegex(ValueError, 'full source snapshot'):
            build_authored_admission([], registry, snapshot, sidecar)

    def test_sidecar_cannot_approve_nonrelease_asset_pins(self):
        records, registry, snapshot, sidecar = source_admission_fixture()
        with self.assertRaisesRegex(ValueError, 'asset pin'):
            sar.build_supervision(records, registry, snapshot, sidecar)

    def test_partition_reservations_are_not_resampled_from_available_labels(self):
        records, registry, snapshot, sidecar = source_admission_fixture()
        # Remove a cut BEFORE review; its family still receives its stable
        # authored partition, but no fitting labels.
        snapshot['rows']['annotations.jsonl'][1]['turn_annotations'][0]['cut_turn'] = None
        seal_snapshot(snapshot)
        p = sar.build_supervision(records, registry, snapshot)['admission-proposal.json']
        sidecar.update(proposal_sha256=p['proposal_sha256'], source_supervision=p['source_supervision'])
        b = build_authored_admission(records, registry, snapshot, sidecar)
        partitions = sidecar['source_supervision']['sources']['tutormoments']['partitions']
        for part in ('train', 'calibration', 'test'):
            self.assertEqual(b['family-splits.json'][part], partitions[part])
        examples = b['source-targets.json']
        missing = examples[1]
        self.assertTrue(missing['eligibility']['eligible'])
        self.assertIsNotNone(missing['source_probe_partition'])
        self.assertTrue(all(not t['fit_mask'] for t in missing['targets'].values()))
        self.assertEqual(missing['source_probe_partition'], examples[2]['source_probe_partition'])
        self.assertEqual(missing['split_family'], examples[2]['split_family'])

    def test_admission_never_removes_other_refusals_or_disagreement(self):
        records, registry, snapshot, sidecar = source_admission_fixture()
        b = sar.build_supervision(records, registry, snapshot)
        e = b['source-targets.json'][1]
        e['eligibility']['reasons'].append('unapproved_snapshot')
        e['targets']['action.rigor']['disagreement'] = [{'value': 0}, {'value': 1}]
        sar.apply_source_admission(sidecar, b['source-targets.json'], b['inputs.json'])
        self.assertEqual(e['eligibility']['reasons'], ['unapproved_snapshot'])
        self.assertFalse(e['eligibility']['eligible'])
        self.assertTrue(all(not t['fit_mask'] for t in e['targets'].values()))
        self.assertEqual(e['targets']['action.rigor']['fit_reason'], 'conflicting_exact_span_judgments')


if __name__ == '__main__':
    unittest.main()
