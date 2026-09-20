"""Authored source files, never human records or provider calls."""
from copy import deepcopy
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import mathdial_supervision as m
import native_scenarios as native
import observer_core as observer


def row(qid):
    return {'qid': qid, 'scenario': 1, 'question': f'A basket contains {qid} pears and 3 apples. How many fruits?',
            'student_incorrect_solution': 'I subtracted the apples instead of adding them.',
            'student_profile': 'Mina is a fictional student. PRIVATE_PROFILE',
            'teacher_described_confusion': 'PRIVATE_CONFUSION', 'ground_truth': 'PRIVATE_GOLD',
            'self-correctness': 'PRIVATE_OUTCOME',
            'conversation': 'Teacher: (generic)Can you explain your idea?|EOM|Mina: I subtracted three.'
                '|EOM|Teacher: (focus)Count éach group (focus) separately.|EOM|Student: I can count them.'
                '|EOM|Teacher: (probing)Why add the two counts?|EOM|Student: FUTURE_SENTINEL'
                '|EOM|Teacher: (telling)The operation is addition.'}


class SupervisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='authored-mathdial-')
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name)
        self.registry = deepcopy(native.load_registry())
        self.data = {(d, p): [] for d in native.DATASETS for p in native.SPLITS[d]}
        self.data['mathdial', 'train.jsonl'] = [row(i) for i in range(71, 81)]
        self.catalog = None

    def publish(self):
        self.catalog = []
        for d in native.DATASETS:
            source = {'id': d, 'revision': self.registry['sources'][d]['revision'],
                      'license': 'authored-fixture', 'files': []}
            for path in native.SPLITS[d]:
                rows = self.data[d, path]
                body = ('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + ('\n' if rows else '')).encode() if path.endswith('.jsonl') else json.dumps(rows).encode()
                file = self.cache / d / source['revision'] / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(body)
                pin = {'path': path, 'sha256': m.sha256(body), 'bytes': len(body)}
                self.registry['sources'][d]['assets'][path] = pin['sha256']
                source['files'].append(pin)
            self.catalog.append(source)

    def build(self, aliases=None):
        self.publish()
        if aliases is not None:
            aliases['base_native_registry_sha256'] = native.digest(self.registry)
        return m.build_supervision(self.cache, self.registry, catalog=self.catalog, person_aliases=aliases)

    def test_real_schema_four_labels_and_split_masks(self):
        bundle = self.build()
        self.assertEqual(bundle['manifest.json']['examples'], 40)
        self.assertEqual(bundle['manifest.json']['class_counts'], dict.fromkeys(m.CLASSES, 10))
        self.assertEqual(bundle['manifest.json']['observer_records'], 80)
        split = bundle['splits.json']
        sets = [set(split[p]) for p in ('train', 'calibration', 'test')]
        self.assertEqual(list(map(len, sets)), [6, 2, 2])
        self.assertEqual(sum(map(len, sets)), len(set.union(*sets)))
        for e in bundle['examples.json']['examples']:
            self.assertEqual(e['target']['fit_mask'], e['partition'] == 'train')
            self.assertEqual(e['target']['evaluation_mask'], e['partition'] != 'train')
            self.assertIsNone(e['pre_action_target'])
            self.assertIsNone(e['learning_outcome'])
            self.assertFalse(e['actor_policy_training_eligible'])

    def test_observer_views_exclude_tags_targets_metadata_and_future(self):
        bundle = self.build()
        e = next(e for e in bundle['examples.json']['examples'] if e['source']['qid'] == 71 and e['cut']['turn_index'] == 2)
        views = {v['record_id']: v for v in bundle['observer-inputs.json']['records']}
        for boundary, ref in e['observer_inputs'].items():
            projection = views[ref['record_id']]
            view = observer.boundary_view(projection)
            for secret in ('PRIVATE_', 'FUTURE_SENTINEL', '(generic)', '(focus)', '(probing)', '(telling)'):
                self.assertNotIn(secret, view['text'])
            self.assertEqual(view['text_sha256'], ref['text_sha256'])
            self.assertEqual(native.digest(projection), ref['projection_sha256'])
            span, = view['spans']
            pooled = view['text'][span['start']:span['end']]
            self.assertEqual(pooled, 'I subtracted three.' if boundary == 'pre_action' else 'Count éach group  separately.')

    def test_offsets_reconstruct_exact_clean_unicode_action(self):
        b = self.build()
        e = next(e for e in b['examples.json']['examples'] if e['source']['qid'] == 71 and e['target']['value'] == 'focus')
        source = self.data['mathdial', 'train.jsonl'][0]['conversation']
        mapping = e['transformation']['action_source_map']
        reconstructed = ''.join(source[s['source'][0]:s['source'][1]] for s in mapping)
        self.assertEqual(reconstructed, 'Count éach group  separately.')
        for s in mapping:
            self.assertEqual(source[s['source'][0]:s['source'][1]], reconstructed[s['clean'][0]:s['clean'][1]])
        a, z = e['target']['annotation_span']
        self.assertEqual(source[a:z], '(focus)')
        self.assertEqual(e['cut']['prefix_source_sha256'], m.sha256(source[:e['cut']['prefix_end']].encode()))

    def test_future_change_does_not_change_earlier_observer_projection(self):
        before = self.build()
        self.data['mathdial', 'train.jsonl'][0]['conversation'] = self.data['mathdial', 'train.jsonl'][0]['conversation'].replace('FUTURE_SENTINEL', 'Different later reply')
        after = self.build()
        target = next(e for e in before['examples.json']['examples'] if e['source']['qid'] == 71 and e['target']['value'] == 'focus')
        ids = {r['record_id'] for r in target['observer_inputs'].values()}
        self.assertEqual([r for r in before['observer-inputs.json']['records'] if r['record_id'] in ids],
                         [r for r in after['observer-inputs.json']['records'] if r['record_id'] in ids])

    def test_all_five_files_required_even_when_not_selected(self):
        self.publish()
        source = next(s for s in self.catalog if s['id'] == 'tutormoments')
        (self.cache / 'tutormoments' / source['revision'] / 'moments.jsonl').unlink()
        with self.assertRaises(FileNotFoundError):
            m.build_supervision(self.cache, self.registry, catalog=self.catalog)

    def test_tamper_and_pin_disagreement_rejected(self):
        self.publish()
        path = self.cache / 'mathdial' / m.REVISION / 'train.jsonl'
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            m.build_supervision(self.cache, self.registry, catalog=self.catalog)
        self.publish()
        self.registry['sources']['mathdial']['assets']['train.jsonl'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'asset mismatch'):
            m.build_supervision(self.cache, self.registry, catalog=self.catalog)

    def test_test_qid_and_repacked_benchmark_excluded_before_label_export(self):
        self.data['mathdial', 'test.jsonl'] = [row(71)]
        self.data['mathtutorbench', 'datasets/mathdial_bridge.json'] = [{
            'problem': row(72)['question'], 'dialog_history': [{'user': 'Student', 'text': 'I need help.'}]}]
        b = self.build()
        self.assertFalse({71, 72} & {e['source']['qid'] for e in b['examples.json']['examples']})
        self.assertEqual(b['manifest.json']['rejections']['family_excluded'], 2)

    def test_malformed_test_identity_still_protects_train(self):
        broken = row(71)
        broken['question'] = None
        self.data['mathdial', 'test.jsonl'] = [broken]
        self.assertNotIn(71, {e['source']['qid'] for e in self.build()['examples.json']['examples']})

    def test_equal_question_qid_aliases_share_partition(self):
        extra = row(999)
        extra['question'] = row(71)['question']
        self.data['mathdial', 'train.jsonl'].append(extra)
        rows = [e for e in self.build()['examples.json']['examples'] if e['source']['qid'] in (71, 999)]
        self.assertEqual(len({e['split_family'] for e in rows}), 1)
        self.assertEqual(len({e['partition'] for e in rows}), 1)

    def person_aliases(self, ids):
        return {'schema_version': 1, 'base_native_registry_sha256': '', 'groups': [
            {'person_id': 'authored-person', 'role': 'teacher', 'family_ids': ids,
             'evidence': {'source': 'authored-fixture-author-log', 'sha256': 'a' * 64}}]}

    def test_person_alias_propagates_protection_and_disallows_unknown_family(self):
        self.data['mathdial', 'test.jsonl'] = [row(71)]
        b = self.build(self.person_aliases(['mathdial-qid-71', 'mathdial-qid-72']))
        self.assertFalse({71, 72} & {e['source']['qid'] for e in b['examples.json']['examples']})
        with self.assertRaisesRegex(ValueError, 'Unknown'):
            self.build(self.person_aliases(['mathdial-qid-71', 'unknown-person-family']))

    def test_aliases_do_not_infer_people_from_simulated_names(self):
        b = self.build()
        self.assertEqual(b['manifest.json']['usable_groups'], 10)
        self.assertFalse(b['manifest.json']['human_person_holdout_established'])
        self.assertEqual(b['manifest.json']['person_alias_groups'], 0)

    def test_missing_label_unknown_speaker_and_visual_context_not_guessed(self):
        r = self.data['mathdial', 'train.jsonl'][0]
        r['conversation'] = 'Teacher: (generic)First sound question?|EOM|Alien: invented authority|EOM|Teacher: (focus)Later question'
        b = self.build()
        selected = [e for e in b['examples.json']['examples'] if e['source']['qid'] == 71]
        self.assertEqual(len(selected), 1)
        r['conversation'] = 'Teacher: (invented)Not an official tag|EOM|Student: answer|EOM|Teacher: (focus)Question'
        self.assertFalse(any(e['source']['qid'] == 71 for e in self.build()['examples.json']['examples']))
        r['conversation'] = 'Teacher: (focus)Look at the diagram.'
        self.assertFalse(any(e['source']['qid'] == 71 for e in self.build()['examples.json']['examples']))

    def test_consecutive_teachers_keep_actual_cut_not_invented_learner(self):
        self.data['mathdial', 'train.jsonl'][0]['conversation'] = 'Teacher: (generic)Hello.|EOM|Teacher: (focus)What changed?'
        e = next(e for e in self.build()['examples.json']['examples'] if e['source']['qid'] == 71 and e['cut']['turn_index'] == 1)
        self.assertEqual(e['cut']['previous_role'], 'teacher')

    def test_projection_rejects_mutated_record_or_cross_family_binding(self):
        self.publish()
        records, _ = m.load_snapshot(self.cache, self.registry, self.catalog)
        _, lookup, _ = m.family_groups(records, self.registry)
        first, second = records[:2]
        turns = m.parse_conversation(first.value)
        with self.assertRaisesRegex(ValueError, 'not admitted'):
            m.project_move(first, turns, 0, lookup[second.dataset, second.record_id])
        first.value['question'] = 'Mutated after source verification'
        with self.assertRaisesRegex(ValueError, 'Mutated'):
            m.project_move(first, turns, 0, lookup[first.dataset, first.record_id])

    def test_explicit_protected_alias_cannot_enter_any_probe_split(self):
        self.registry['protected_families'] = ['mathdial-qid-71']
        bundle = self.build()
        self.assertFalse(any(e['source']['qid'] == 71 for e in bundle['examples.json']['examples']))
        self.assertTrue(all('mathdial-qid-71' not in bundle['splits.json'][p]
                            for p in ('train', 'calibration', 'test')))

    def test_insufficient_groups_never_grant_training_mask(self):
        self.data['mathdial', 'train.jsonl'] = [row(71)]
        b = self.build()
        self.assertEqual(b['splits.json']['status'], 'insufficient_groups')
        self.assertTrue(all(not e['target']['fit_mask'] for e in b['examples.json']['examples']))

    def test_no_overwrite_and_private_permissions(self):
        b = self.build()
        output = self.cache / 'output'
        with patch.object(native, 'output_directory', return_value=output):
            m.write_bundle(b, output)
            before = (output / 'examples.json').read_bytes()
            with self.assertRaises(FileExistsError):
                m.write_bundle(b, output)
            self.assertEqual((output / 'examples.json').read_bytes(), before)
            self.assertEqual((output / 'examples.json').stat().st_mode & 0o777, 0o600)

    def test_cli_inspect_uses_real_builder_without_creating_outputs(self):
        self.publish()
        registry_path = self.cache / 'registry.json'
        registry_path.write_text(json.dumps(self.registry))
        before = {str(p): p.read_bytes() for p in self.cache.rglob('*') if p.is_file()}
        with patch.object(m.sources, 'source_catalog', return_value=self.catalog):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                m.main(['inspect', '--cache', str(self.cache), '--registry', str(registry_path)])
        self.assertEqual(json.loads(out.getvalue())['examples'], 40)
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.cache.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
