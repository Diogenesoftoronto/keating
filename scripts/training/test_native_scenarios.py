"""Small authored fixtures: no source conversations or restricted data copied."""
from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
import io

import benchmark_sources as sources
import native_scenarios as native


QUESTION = 'A crate has 9 blue balls and 4 red balls. How many balls are there?'
ATTEMPT = 'I subtracted the red balls from the blue balls and got 5 balls.'
SECRET = 'PRIVATE_GOLD_SENTINEL_91e38'
FUTURE = 'PRIVATE_FUTURE_SENTINEL_99be2'
LABEL = 'PRIVATE_LABEL_SENTINEL_ab817'
PROFILE = 'PRIVATE_PERSONA_SENTINEL_ade96'
TM_UUID = '01234567-89ab-4cde-8fab-0123456789ab'


def mathdial(qid=71):
    return {'qid': qid, 'question': QUESTION, 'student_incorrect_solution': ATTEMPT,
            'student_profile': PROFILE, 'teacher_described_confusion': LABEL,
            'ground_truth': SECRET, 'conversation': FUTURE, 'self-correctness': LABEL}


def bridge(identity='451_12'):
    return {'c_id': identity, 'lesson_topic': 'Addition',
            'c_h': [{'user': 'tutor', 'text': QUESTION},
                    {'user': 'student', 'text': ATTEMPT}],
            'c_r': [{'user': 'tutor', 'text': SECRET}],
            'c_r_': [{'user': 'tutor', 'text': FUTURE}],
            'c_revision': [{'user': 'student', 'text': FUTURE}],
            'e': LABEL, 'z_what': LABEL, 'z_why': LABEL}


def mrbench():
    return {'conversation_id': 'repacked-id-does-not-establish-family',
            'conversation_history': f'Tutor: The question is: {QUESTION}\n\u00a0Student: {ATTEMPT}',
            'tutor_responses': {'expert': {'response': SECRET, 'annotation': LABEL}}}


def mathtutorbench():
    return {'problem': QUESTION, 'topic': 'Math Word Problem', 'reference_solution': SECRET,
            'dialog_history': [{'user': 'Teacher', 'text': 'Tell me your attempt.'},
                               {'user': 'Student', 'text': ATTEMPT},
                               {'user': 'Teacher', 'text': FUTURE}]}


def tutormoments():
    return {'id': 'authored-moment', 'context': [
                {'turn_number': 1, 'role': 'tutor', 'text': QUESTION},
                {'turn_number': 2, 'role': 'student', 'text': ATTEMPT}],
            'dimension': LABEL, 'student': {'reference': FUTURE, 'trait': PROFILE},
            'rubric': {'gold': LABEL, 'hint': SECRET},
            'provenance': {'conv_id': 'authored_' + TM_UUID, 'cut_turn': 2}}


def record(dataset, row, split='train', index=0, registry=None):
    policy = (registry or native.load_registry())['sources'][dataset]
    asset = next(a for a, s in native.SPLITS[dataset].items() if s == split)
    return native.SourceRecord(dataset, policy['revision'], 'fixture-license', split,
                               asset, policy['assets'][asset], f'{asset}#row={index}',
                               native.digest(row), row)


class NativeScenarioTests(unittest.TestCase):
    def setUp(self):
        self.registry = native.load_registry()

    def build(self, rows, purpose='development', source='all'):
        return native.build_native_scenarios(rows, self.registry, source, purpose)

    def assertPrivate(self, scenario):
        public = native.canonical(native.public_views(scenario))
        for secret in (SECRET, FUTURE, LABEL, PROFILE):
            self.assertNotIn(secret, public)
        self.assertEqual(scenario['evaluation_only']['native_assessment'],
                         {'status': 'unassessed', 'outcome': None})
        self.assertEqual(scenario['learner']['assumptions'], [])

    def test_mathdial_initial_attempt_not_original_tutoring_or_labels(self):
        scenario, = self.build([record('mathdial', mathdial())])['scenarios']
        self.assertPrivate(scenario)
        self.assertIn(QUESTION, scenario['actor']['opening_message'])
        self.assertIn(ATTEMPT, scenario['actor']['opening_message'])
        self.assertEqual(scenario['evaluation_only']['original']['ground_truth'], SECRET)

    def test_bridge_history_only_with_private_revisions_and_no_invented_result(self):
        scenario, = self.build([record('bridge', bridge())])['scenarios']
        self.assertPrivate(scenario)
        self.assertEqual(scenario['family'], 'bridge-conversation-451')

    def test_mrbench_matches_mathdial_origin_and_withholds_candidate_judgments(self):
        report = self.build([record('mathdial', mathdial()), record('mrbench', mrbench(), 'dev')])
        self.assertEqual(report['summary']['eligible'], 2)
        self.assertEqual({s['family'] for s in report['scenarios']}, {'mathdial-qid-71'})
        self.assertPrivate(report['scenarios'][1])

    def test_mathtutorbench_cuts_trailing_response_and_propagates_benchmark_protection(self):
        rows = [record('mathdial', mathdial()), record('mathtutorbench', mathtutorbench(), 'benchmark')]
        self.assertEqual(self.build(rows)['summary']['eligible'], 0)
        report = self.build(rows, 'reference')
        self.assertEqual(report['summary']['eligible'], 2)
        scenario = report['scenarios'][1]
        self.assertPrivate(scenario)
        self.assertEqual(scenario['evaluation_only']['cut']['withheld_trailing_tutor_turns'], 1)
        self.assertEqual(scenario['evaluation_only']['admission']['source_splits'],
                         ['mathdial:train', 'mathtutorbench:benchmark'])

    def test_bridge_reused_by_both_collections_has_original_conversation_family(self):
        original = bridge()
        # A different problem prevents a MathDial join; only the original
        # Bridge learner utterance establishes this repack's source family.
        original['c_h'][0]['text'] = 'Please solve 19 + 25. What do you get?'
        mt = {'problem': '', 'topic': 'Addition', 'reference_solution': SECRET,
              'dialog_history': original['c_h'] + [{'user': 'tutor', 'text': FUTURE}]}
        mr = {'conversation_id': 'unrelated-uuid', 'conversation_history':
              'Tutor: Please solve 19 + 25. What do you get?\nStudent: ' + ATTEMPT,
              'tutor_responses': {'one': SECRET}}
        rows = [record('bridge', original), record('mathtutorbench', mt, 'benchmark'), record('mrbench', mr, 'dev')]
        report = self.build(rows, 'reference')
        self.assertEqual(report['summary']['eligible'], 3)
        self.assertEqual({s['family'] for s in report['scenarios']}, {'bridge-conversation-451'})
        self.assertEqual(self.build(rows)['summary']['eligible'], 0)

    def test_tutormoments_cut_and_equal_number_enrichment_keep_future_private(self):
        row = tutormoments()
        row['context'].insert(1, {'turn_number': 2, 'role': 'tutor', 'text': 'Take your time.'})
        scenario, = self.build([record('tutormoments', row, 'benchmark')], 'reference')['scenarios']
        self.assertPrivate(scenario)
        self.assertEqual(scenario['family'], 'tm-' + TM_UUID)
        row['context'][-1]['turn_number'] = 3
        report = self.build([record('tutormoments', row, 'benchmark')], 'reference')
        self.assertEqual(report['rejected'][0]['reason'], 'post_cut_or_unordered_context')

    def test_tutormoments_latest_explicit_problem_drops_unrelated_old_screen(self):
        row = tutormoments()
        row['context'] = [{'turn_number': 1, 'role': 'tutor', 'text': 'Old unrelated graph.'},
            {'turn_number': 2, 'role': 'tutor', 'text': '[PROBLEM_CHANGE: p2 (start)] ' + QUESTION},
            {'turn_number': 2, 'role': 'student', 'text': ATTEMPT}]
        scenario, = self.build([record('tutormoments', row, 'benchmark')], 'reference')['scenarios']
        self.assertNotIn('Old unrelated', scenario['actor']['opening_message'])
        self.assertEqual(scenario['evaluation_only']['cut']['start_index'], 1)

    def test_six_existing_moments_have_five_exposed_families(self):
        entries = self.registry['development_exposed']
        self.assertEqual(len(entries), 5)
        self.assertEqual(sum(len(e['source_record_ids']) for e in entries), 6)
        row = tutormoments()
        row['provenance']['conv_id'] = 'authored_' + entries[0]['family'].removeprefix('tm-')
        rows = [record('tutormoments', row, 'benchmark')]
        self.assertEqual(self.build(rows)['summary']['eligible'], 1)
        scenario, = self.build(rows, 'reference')['scenarios']
        self.assertEqual(scenario['evaluation_only']['admission']['exposure'], 'development-exposed')

    def test_source_filter_does_not_hide_cross_collection_protection(self):
        rows = [record('mathdial', mathdial()), record('mrbench', mrbench(), 'test')]
        report = self.build(rows, source='mathdial')
        self.assertEqual(report['summary']['eligible'], 0)
        self.assertEqual(report['rejected'][0]['reason'], 'protected_source_split')

    def test_train_test_family_overlap_even_with_distinct_record_ids(self):
        rows = [record('mathdial', mathdial()), record('mathdial', mathdial(), 'test')]
        report = self.build(rows)
        self.assertEqual(report['summary']['eligible'], 0)
        self.assertEqual(report['summary']['rejected'], 2)

    def test_equal_problem_different_qids_share_protection(self):
        rows = [record('mathdial', mathdial()), record('mathdial', mathdial(72), 'test')]
        self.assertEqual(self.build(rows)['summary']['eligible'], 0)
        family, = self.build(rows, 'reference')['families']
        self.assertEqual(family['aliases'], ['mathdial-qid-71', 'mathdial-qid-72'])

    def test_same_qid_different_math_is_collision_not_normalization(self):
        a, b = mathdial(), mathdial()
        a['question'] = 'What is 2 + 3?'
        b['question'] = 'What is 2 - 3?'
        report = self.build([record('mathdial', a), record('mathdial', b, index=1)])
        self.assertEqual({r['reason'] for r in report['rejected']}, {'origin_identity_collision'})

    def test_invalid_test_record_still_reserves_its_known_family(self):
        test = mathdial(); test['question'] = None
        rows = [record('mathdial', mathdial()), record('mathdial', test, 'test')]
        report = self.build(rows)
        self.assertEqual(report['summary']['eligible'], 0)
        self.assertIn('protected_source_split', [r['reason'] for r in report['rejected']])

    def test_cannot_relabel_test_asset_as_train(self):
        original = record('mathdial', mathdial(), 'test')
        report = self.build([replace(original, original_split='train')])
        self.assertEqual(report['rejected'][0]['reason'], 'unapproved_snapshot')

    def test_mrbench_keeps_mathematical_unicode_in_public_history(self):
        row = mrbench()
        row['conversation_history'] += ' I wrote 3², not 32.'
        report = self.build([record('mathdial', mathdial()), record('mrbench', row, 'dev')])
        self.assertIn('3²', report['scenarios'][1]['actor']['opening_message'])

    def test_ambiguous_bridge_anchor_and_missing_identity_fail_closed(self):
        rows = [record('bridge', bridge()), record('bridge', bridge('452_12'), index=1),
                record('mrbench', {'conversation_history': 'Tutor: Compute 8 + 9.\nStudent: ' + ATTEMPT}, 'dev')]
        report = self.build(rows)
        self.assertEqual(report['rejected'][0]['reason'], 'ambiguous_origin')
        row = mathdial(); row.pop('qid')
        self.assertEqual(self.build([record('mathdial', row)])['rejected'][0]['reason'], 'missing_origin_identity')

    def test_short_generic_bridge_reply_cannot_establish_origin(self):
        original = bridge(); original['c_h'][-1]['text'] = '5'
        mt = {'problem': '', 'dialog_history': original['c_h'] + [{'user': 'tutor', 'text': SECRET}]}
        report = self.build([record('bridge', original), record('mathtutorbench', mt, 'benchmark')], 'reference')
        self.assertIn('unresolved_origin', [r['reason'] for r in report['rejected']])

    def test_registry_denial_and_unapproved_snapshot(self):
        rows = [record('mathdial', mathdial())]
        self.registry['protected_families'] = ['mathdial-qid-71']
        self.assertEqual(self.build(rows)['rejected'][0]['reason'], 'protected_family')
        self.registry['protected_families'] = []
        self.registry['sources']['mathdial']['split_purposes']['train'] = []
        self.assertEqual(self.build(rows)['rejected'][0]['reason'], 'unauthorized_family')
        self.registry = native.load_registry()
        self.assertEqual(self.build([replace(rows[0], revision='0' * 40)])['rejected'][0]['reason'], 'unapproved_snapshot')
        self.registry['sources']['mathdial']['split_purposes']['test'].append('development')
        with self.assertRaisesRegex(ValueError, 'protected source split'):
            self.build(rows)

    def test_missing_context_flagged_instead_of_invented(self):
        visual = mathdial(); visual['question'] = 'What is the shaded area in the diagram?'
        report = self.build([record('mathdial', visual)])
        self.assertEqual(report['rejected'][0]['reason'], 'missing_visual_context')
        absent = bridge(); absent['c_h'][0]['text'] = 'Please try that one again.'
        report = self.build([record('bridge', absent)])
        self.assertEqual(report['rejected'][0]['reason'], 'missing_problem_context')

    def test_original_hash_and_public_allowlists_reject_tampering(self):
        row = record('mathdial', mathdial())
        with self.assertRaisesRegex(ValueError, 'mutated'):
            self.build([replace(row, sha256='a' * 64)])
        scenario, = self.build([row])['scenarios']
        scenario['actor']['answer_key'] = SECRET
        with self.assertRaisesRegex(ValueError, 'Actor view'):
            native.public_views(scenario)
        scenario['actor'].pop('answer_key')
        scenario['evaluation_only']['original']['ground_truth'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            native.validate_native_scenario(scenario)

    def test_views_do_not_share_mutable_private_or_scenario_objects(self):
        scenario, = self.build([record('mathdial', mathdial())])['scenarios']
        views = native.public_views(scenario)
        views['learner']['profile_evidence'][0]['text'] = 'changed'
        self.assertEqual(scenario['learner']['profile_evidence'][0]['text'], ATTEMPT)
        self.assertNotIn('evaluation_only', views)

    def test_loader_checks_pinned_original_bytes_and_requires_overlap_corpus(self):
        catalog = []
        with tempfile.TemporaryDirectory() as tmp:
            for d in native.DATASETS:
                source = {'id': d, 'revision': 'f' * 40, 'license': 'authored-fixture', 'files': []}
                for asset_path in native.SPLITS[d]:
                    asset = {'path': asset_path}
                    path = sources.original_path(source, asset, tmp)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    body = (native.canonical(mathdial()) + '\n').encode() if asset_path.endswith('.jsonl') else b'[]'
                    asset.update(bytes=len(body), sha256=native.hashlib.sha256(body).hexdigest())
                    path.write_bytes(body)
                    source['files'].append(asset)
                catalog.append(source)
            loaded = native.load_source_records(tmp, catalog)
            self.assertTrue(loaded)
            with self.assertRaisesRegex(ValueError, 'All five'):
                native.load_source_records(tmp, catalog[:-1])
            asset = catalog[0]['files'][0]
            sources.original_path(catalog[0], asset, tmp).write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                native.load_source_records(tmp, catalog)

    def test_source_payload_cannot_be_written_to_tracked_path(self):
        with self.assertRaisesRegex(ValueError, 'Source-derived'):
            native.output_directory(native.ROOT / 'scripts/training/raw-data')

    def test_cli_roundtrip_rejects_answer_injection_and_replays_admission(self):
        rows = [record('mathdial', mathdial())]
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / 'build'
            with patch.object(native, 'load_source_records', return_value=rows), \
                 patch.object(native, 'load_registry', return_value=self.registry), \
                 patch.object(native, 'EXPOSURE_LEDGER', Path(tmp) / 'exposure.json'), \
                 patch.object(native, 'output_directory', side_effect=lambda p: Path(p)), \
                 redirect_stdout(io.StringIO()):
                argv = ['native_scenarios.py', 'build', '--source', 'mathdial', '--output', str(destination)]
                with patch('sys.argv', argv):
                    native.main()
                argv[1] = 'validate'
                with patch('sys.argv', argv):
                    native.main()
                actor_path = destination / 'actor.json'
                actor = json.loads(actor_path.read_text())
                actor[0]['opening_message'] += SECRET
                actor_path.write_text(json.dumps(actor))
                with patch('sys.argv', argv), self.assertRaisesRegex(ValueError, 'Grounding / admission replay mismatch'):
                    native.main()
                self.registry['protected_families'] = ['mathdial-qid-71']
                with patch('sys.argv', argv), self.assertRaisesRegex(ValueError, 'Grounding / admission replay mismatch'):
                    native.main()

    def test_exposure_journal_is_monotonic_and_never_grants_admission(self):
        first = self.build([record('mathdial', mathdial())])
        second = self.build([record('mathdial', mathdial(72))])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'exposures.json'
            ledger = native.read_exposure_ledger(path)
            native.persist_exposures(first, Path(tmp) / 'first', ledger, path)
            ledger = native.read_exposure_ledger(path)
            native.persist_exposures(second, Path(tmp) / 'second', ledger, path)
            ledger = native.read_exposure_ledger(path)
            self.assertEqual(set(ledger['families']), {'mathdial-qid-71', 'mathdial-qid-72'})
            self.assertEqual(ledger['families']['mathdial-qid-71']['first_output'], str(Path(tmp) / 'first'))
            rows = [record('mathdial', mathdial())]
            reference = native.build_native_scenarios(rows, self.registry, purpose='reference', exposed_families=ledger['families'])
            self.assertEqual(reference['scenarios'][0]['evaluation_only']['admission']['exposure'], 'development-exposed')
            self.registry['protected_families'] = ['mathdial-qid-71']
            refused = native.build_native_scenarios(rows, self.registry, exposed_families=ledger['families'])
            self.assertEqual(refused['rejected'][0]['reason'], 'protected_family')
            path.write_text('{"schema_version": 1, "families": []}')
            with self.assertRaisesRegex(ValueError, 'refusing to forget'):
                native.read_exposure_ledger(path)


if __name__ == '__main__':
    unittest.main()
