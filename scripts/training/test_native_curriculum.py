"""Authored fixtures and injected local drivers only; no inference or credentials."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

import native_curriculum as curriculum
import native_training as nt
import native_tinker_update as nu
import test_native_tinker_update as updater_fixtures


def family(name, protected=False):
    return {'family': name, 'aliases': [name], 'split': 'test' if protected else 'train',
            'protected': protected, 'sources': [{'dataset': 'MOCK-authored', 'revision': 'fixture-v1',
                'record_id': name, 'record_sha256': nt.native_hash(name),
                'original_split': 'test' if protected else 'train'}]}


def spec():
    return nt.seal({'schema_version': 1, 'kind': 'native-curriculum/v1', 'update_consumer': nu.VERSION,
        'owner': {'account_id': 'MOCK-account', 'project_selection': 'explicit', 'project_id': 'MOCK-project'},
        'root': {'id': 'root', 'model': 'MOCK/InklingSmall',
                 'training_checkpoint': 'tinker://mock-root/weights/root',
                 'sampler_checkpoint': 'tinker://mock-root/sampler_weights/root'},
        'measurement': {'observer_model': 'Qwen/MOCK-frozen-observer', 'observer_manifest_hash': 'a' * 64,
                        'probe_card_hashes': {'knowledge': 'b' * 64, 'uncertainty': 'c' * 64},
                        'simulator_revision': 'MOCK-adaptive-v1', 'metric_revision': 'MOCK-probe-score-v1'},
        'registry_revision': 'MOCK-registry',
        'families': [family('train-a'), family('train-b'), family('v4-a', True), family('v4-b', True)],
        'protected_evaluation_families': ['v4-a', 'v4-b'], 'benchmark_v4_families': ['v4-a', 'v4-b'],
        'replay_policy': {'max_updates': 2, 'seed': 42, 'revoked_aliases': []},
        'stages': [{'id': name, 'topic': topic,
                    'train': [{'scenario_id': 'scenario-' + name, 'family_id': 'train-' + name}],
                    'evaluate': [{'scenario_id': 'eval-' + name, 'family_id': 'v4-' + name}],
                    'quotas': {'recent': 1, 'reservoir': i, 'hard': 0}}
                   for i, (name, topic) in enumerate([('a', 'fractions'), ('b', 'geometry')])]}, 'curriculum_hash')


def receipt(work, value):
    return {'work_hash': work['work_hash'], 'measurement': deepcopy(work['measurement']), 'value': value}


class Drivers:
    def __init__(self, manifest):
        self.spec, self.calls, self.exports = manifest, [], []

    def collect(self, work):
        self.calls.append(('collect', work['stage_id']))
        model = {'provider': 'tinker', 'id': self.spec['root']['model'],
                 'revision': work['parent']['sampler_checkpoint']}
        with patch.object(updater_fixtures, 'MODEL', model):
            bundle, _, config, _ = updater_fixtures.inputs('sft')
        # Adapt existing authored export fixtures to distinct scenario/family IDs.
        # These remain mock provider-shaped inputs, never claimed as real captures.
        ref = work['scenarios'][0]
        def adapt(value):
            if type(value) is dict:
                return {k: adapt(v) for k, v in value.items()}
            if type(value) is list:
                return [adapt(v) for v in value]
            if value == 'authored':
                return ref['scenario_id']
            if value == 'authored-family':
                return ref['family_id']
            return value
        bundle = adapt(bundle)
        bundle['observer_inputs'] = [nt.seal(f, 'feature_hash') for f in bundle['observer_inputs']]
        fresh = bundle['sft'][0]['segment']['capture_hash']
        assignment = {fresh: {'bucket': 'recent', 'rationale': 'MOCK-current-stage', 'evidence_hash': 'd' * 64}}
        for old in self.exports:
            for key in ('episodes', 'sft', 'policy_segments', 'observer_inputs'):
                bundle[key].extend(deepcopy(old[key]))
            for row in old['sft']:
                assignment[row['segment']['capture_hash']] = {
                    'bucket': 'reservoir', 'rationale': 'MOCK-previous-stage', 'evidence_hash': 'e' * 64}
        bundle = nt.seal(bundle, 'export_hash')
        splits = nt.seal({'schema_version': 1, 'export_hash': bundle['export_hash'],
            'registry_revision': self.spec['registry_revision'], 'approved_by': 'MOCK-independent-admission',
            'families': self.spec['families'], 'episodes': bundle['episodes']}, 'split_hash')
        config['model']['revision'] = work['parent']['training_checkpoint']
        config['capture_hashes'] = list(assignment)
        config['allowed_behavior_revisions'] = list(dict.fromkeys(r['segment']['actor']['revision'] for r in bundle['sft']))
        config = nt.seal(config, 'config_hash')
        self.exports.append(bundle)
        return receipt(work, {'bundle': bundle, 'splits': splits, 'config': config, 'signals': None, 'assignment': assignment})

    def update(self, work):
        self.calls.append(('update', work['stage_id']))
        plan = work['plan']
        saved = 'native-' + plan['plan_hash'][:24] + '-updated'
        return receipt(work, nt.seal({'schema_version': 1, 'consumer': nu.VERSION,
            'project_selection': work['owner']['project_selection'], 'project_id': work['owner']['project_id'],
            'plan_hash': plan['plan_hash'], 'export_hash': plan['export_hash'], 'status': 'complete',
            'optimizer_acknowledged': True, 'last_dispatched': 'save_sampler', 'training_client_id': 'mock-client',
            'training_checkpoint': 'tinker://mock-client/weights/' + saved,
            'sampler_checkpoint': 'tinker://mock-client/sampler_weights/' + saved}, 'result_hash'))

    def evaluate(self, work):
        self.calls.append(('evaluate', work['parent']['id'], work['slice']))
        scores = {'root': [.2, .3], 'a': [.6, .3], 'b': [.5, .7]}
        return receipt(work, {'score': scores[work['parent']['id']][work['slice'] == 'b'],
                              'assessment_count': 4, 'assessment_hash': nt.native_hash(work['work_hash'])})


class CurriculumTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'journal.jsonl'
        self.spec = spec()
        self.run = curriculum.Curriculum(self.path, self.spec)
        self.drivers = Drivers(self.spec)

    def step(self, **overrides):
        return self.run.step(**{'collect': self.drivers.collect, 'update': self.drivers.update,
                                'evaluate': self.drivers.evaluate, **overrides})

    def reach_update(self):
        while self.run.inspect()['next_work']['operation'] != 'update':
            self.step()

    def test_two_topics_all_slice_callback_sequence_replay_and_retention(self):
        while self.run.inspect()['status'] != 'complete':
            work = self.run.inspect()['next_work']
            if work['operation'] == 'update' and work['stage_id'] == 'b':
                self.assertEqual(work['parent']['id'], 'a')
                self.assertEqual(work['plan']['config']['model']['revision'], work['parent']['training_checkpoint'])
                self.assertEqual({r['bucket']: r['update_distance'] for r in work['selection']['selected']},
                                 {'recent': 0, 'reservoir': 1})
            self.step()
            self.run = curriculum.Curriculum(self.path, self.spec)  # resume every phase
        self.assertEqual(self.drivers.calls, [
            ('evaluate', 'root', 'a'), ('evaluate', 'root', 'b'), ('collect', 'a'), ('update', 'a'),
            ('evaluate', 'a', 'a'), ('evaluate', 'a', 'b'), ('collect', 'b'), ('update', 'b'),
            ('evaluate', 'b', 'a'), ('evaluate', 'b', 'b')])
        result = self.run.inspect()
        self.assertEqual(result['matrix'], [[.2, .3], [.6, .3], [.5, .7]])
        self.assertAlmostEqual(result['retention']['learning'][1]['forgetting'], .1)
        self.assertFalse(result['lineage']['restoration_verified'])
        before = self.path.read_bytes()
        self.step()
        self.assertEqual(self.path.read_bytes(), before)

    def test_missing_evaluation_cannot_advance_to_collection_or_next_stage(self):
        self.assertEqual(self.run.inspect()['next_work']['operation'], 'evaluate')
        with self.assertRaisesRegex(ValueError, 'missing_evaluate_driver'):
            self.step(evaluate=None)
        self.reach_update()
        self.step()
        with self.assertRaisesRegex(ValueError, 'missing_evaluate_driver'):
            self.step(evaluate=None)
        self.assertNotIn(('collect', 'b'), self.drivers.calls)
        self.assertEqual(self.run.inspect()['acknowledged_updates'], 1)

    def test_missing_evaluation_receipt_is_unresolved_not_a_zero(self):
        with self.assertRaisesRegex(ValueError, 'receipt_work_binding'):
            self.step(evaluate=lambda _: None)
        state = self.run.inspect()
        self.assertEqual(state['status'], 'needs_reconcile')
        self.assertEqual(state['matrix'], [[None, None]])
        with self.assertRaisesRegex(ValueError, 'needs_reconcile'):
            self.step()

    def test_explicit_null_evaluations_remain_unknown_without_fabricated_gain(self):
        def unknown(work):
            return receipt(work, {'score': None, 'assessment_count': 0, 'assessment_hash': 'f' * 64})
        while self.run.inspect()['status'] != 'complete':
            self.step(evaluate=unknown)
        state = self.run.inspect()
        self.assertEqual(state['matrix'], [[None, None]] * 3)
        self.assertEqual(state['retention']['observed_cells'], 6)
        self.assertTrue(all(r['plasticity'] is None and r['forgetting'] is None for r in state['retention']['learning']))

    def test_sibling_reset_config_is_rejected_before_update_driver(self):
        self.reach_update()
        self.step()
        self.step()
        self.step()
        def sibling(work):
            response = self.drivers.collect(work)
            config = response['value']['config']
            config['model']['revision'] = self.spec['root']['training_checkpoint']
            response['value']['config'] = nt.seal(config, 'config_hash')
            return response
        with self.assertRaisesRegex(ValueError, 'curriculum_wrong_parent'):
            self.step(collect=sibling)
        self.assertNotIn(('update', 'b'), self.drivers.calls)

    def test_measurement_and_curriculum_pins_cannot_change_on_resume(self):
        self.step()
        changes = [lambda s: s['measurement'].update(observer_manifest_hash='e' * 64),
                   lambda s: s['measurement']['probe_card_hashes'].update(knowledge='e' * 64),
                   lambda s: s['measurement'].update(simulator_revision='MOCK-v2'),
                   lambda s: s['measurement'].update(metric_revision='MOCK-new-metric'),
                   lambda s: s['stages'].reverse(),
                   lambda s: s['stages'][1]['quotas'].update(reservoir=0),
                   lambda s: s['owner'].update(account_id='different-account'),
                   lambda s: s['families'][0]['sources'][0].update(revision='changed')]
        for change in changes:
            altered = deepcopy(self.spec)
            change(altered)
            with self.assertRaisesRegex(ValueError, 'curriculum_changed'):
                curriculum.Curriculum(self.path, nt.seal(altered, 'curriculum_hash')).inspect()

    def test_changed_observer_receipt_cannot_be_accepted(self):
        def changed(work):
            response = self.drivers.evaluate(work)
            response['measurement']['observer_manifest_hash'] = 'f' * 64
            return response
        with self.assertRaisesRegex(ValueError, 'measurement_changed'):
            self.step(evaluate=changed)
        self.assertEqual(self.run.inspect()['status'], 'needs_reconcile')

    def test_same_base_model_can_have_distinct_frozen_observer_and_actor_roles(self):
        self.spec['root']['model'] = 'Qwen/Qwen3.5-9B-Base'
        self.spec['measurement']['observer_model'] = self.spec['root']['model']
        self.spec = nt.seal(self.spec, 'curriculum_hash')
        self.run = curriculum.Curriculum(self.path, self.spec)
        self.drivers = Drivers(self.spec)
        while self.run.inspect()['status'] != 'complete':
            self.step()
        self.assertEqual(self.run.inspect()['acknowledged_updates'], 2)
        self.assertEqual(self.run.inspect()['evaluations'][-1]['measurement'], self.spec['measurement'])

    def test_account_project_cannot_change_before_optimizer_dispatch(self):
        self.step()
        self.step()
        def moved(work):
            response = self.drivers.collect(work)
            config = response['value']['config']
            config['project_id'] = 'another-project'
            response['value']['config'] = nt.seal(config, 'config_hash')
            return response
        with self.assertRaisesRegex(ValueError, 'curriculum_account_project_changed'):
            self.step(collect=moved)
        self.assertFalse(any(c[0] == 'update' for c in self.drivers.calls))

    def test_replay_preserves_original_runtime_capture_and_review_evidence(self):
        self.reach_update()
        first = self.run.inspect()['next_work']['plan']['rows'][0]['record']
        self.step()
        self.reach_update()
        work = self.run.inspect()['next_work']
        replay = next(item['record'] for item in work['plan']['rows']
                      if item['record']['segment']['capture_hash'] == first['segment']['capture_hash'])
        self.assertEqual(replay, first)
        self.assertEqual(work['owner'], self.spec['owner'])
        self.assertEqual(work['plan']['export_hash'], work['inputs']['bundle']['export_hash'])
        # A producer cannot reseal changed original evidence under an old capture.
        current = self.run._load
        with self.run._locked() as stream:
            state, _ = current(stream)
        collection = deepcopy(state.collections[-1]['inputs'])
        for row in collection['bundle']['sft']:
            if row['segment']['capture_hash'] == first['segment']['capture_hash']:
                row['review_hash'] = 'f' * 64
        collection['bundle'] = nt.seal(collection['bundle'], 'export_hash')
        collection['splits'] = nt.seal({**collection['splits'],
            'export_hash': collection['bundle']['export_hash']}, 'split_hash')
        state.collections.pop()
        with self.assertRaisesRegex(ValueError, 'capture_outside_curriculum'):
            state.collection(state.next_work(), collection)

    def test_protected_v4_training_and_registry_relabeling_fail(self):
        altered = deepcopy(self.spec)
        altered['stages'][0]['train'][0]['family_id'] = 'v4-a'
        with self.assertRaisesRegex(ValueError, 'protected_family_training'):
            curriculum.Curriculum(self.path, nt.seal(altered, 'curriculum_hash'))
        self.step()
        self.step()
        def relabel(work):
            response = self.drivers.collect(work)
            splits = response['value']['splits']
            splits['families'] = deepcopy(splits['families'])
            splits['families'][0]['aliases'].append('v4-a-renamed')
            response['value']['splits'] = nt.seal(splits, 'split_hash')
            return response
        with self.assertRaisesRegex(ValueError, 'family_registry_changed'):
            self.step(collect=relabel)
        self.assertFalse(any(c[0] == 'update' for c in self.drivers.calls))

    def test_replay_quota_shortfall_cannot_silently_redistribute(self):
        self.spec['stages'][0]['quotas']['reservoir'] = 1
        self.spec = nt.seal(self.spec, 'curriculum_hash')
        self.run = curriculum.Curriculum(self.path, self.spec)
        self.step()
        self.step()
        with self.assertRaisesRegex(ValueError, 'insufficient_eligible_replay_reservoir'):
            self.step()

    def test_update_partial_failure_stops_and_reconciliation_is_idempotent(self):
        self.reach_update()
        recovered = []
        def failed(work):
            # A provider may have finished before local transport/persistence failed.
            events = [json.loads(line) for line in self.path.read_text().splitlines()]
            self.assertEqual(events[-1]['kind'], 'dispatch')
            self.assertEqual(events[-1]['value']['work_hash'], work['work_hash'])
            recovered.append(self.drivers.update(work))
            raise RuntimeError('do not log provider details')
        with self.assertRaisesRegex(ValueError, '^driver_failed_needs_reconcile$'):
            self.step(update=failed)
        self.run = curriculum.Curriculum(self.path, self.spec)
        for _ in range(2):
            with self.assertRaisesRegex(ValueError, '^needs_reconcile$'):
                self.step()
        self.assertEqual(self.drivers.calls.count(('update', 'a')), 1)
        self.run.reconcile(recovered[0])
        before = self.path.read_bytes()
        self.run.reconcile(recovered[0])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.run.inspect()['next_work']['operation'], 'evaluate')

    def test_receipt_write_failure_cannot_redispatch_optimizer(self):
        self.reach_update()
        original = self.run._append
        def disk_failure(stream, head, kind, value):
            if kind == 'receipt':
                raise OSError('MOCK disk full')
            return original(stream, head, kind, value)
        with patch.object(self.run, '_append', side_effect=disk_failure), self.assertRaises(OSError):
            self.step()
        self.assertEqual(self.run.inspect()['status'], 'needs_reconcile')
        with self.assertRaisesRegex(ValueError, 'needs_reconcile'):
            self.step()
        self.assertEqual(self.drivers.calls.count(('update', 'a')), 1)

    def test_incomplete_wrong_plan_or_custom_acknowledgment_rejected(self):
        self.reach_update()
        work = self.run.inspect()['next_work']
        with self.assertRaisesRegex(ValueError, 'driver_failed'):
            self.step(update=lambda _: (_ for _ in ()).throw(RuntimeError()))
        for change in ({'optimizer_acknowledged': False}, {'last_dispatched': 'optimizer'},
                       {'plan_hash': 'f' * 64}, {'consumer': 'native-custom-update/v1'},
                       {'project_id': 'another-project'},
                       {'sampler_checkpoint': 'tinker://sibling/sampler_weights/foreign'}):
            response = self.drivers.update(work)
            response['value'] = nt.seal({**response['value'], **change}, 'result_hash')
            with self.assertRaises(ValueError):
                self.run.reconcile(response)
            self.assertEqual(self.run.inspect()['acknowledged_updates'], 0)

    def test_actual_execute_update_receipt_with_injected_sdk(self):
        self.reach_update()
        def actual_api(work):
            budget = Path(self.temp.name) / 'budget.json'
            class Service(updater_fixtures.FakeService):
                def get_info(self):
                    self.checked('get_info')
                    return NS(model_id='mock-training', model_data=NS(
                        model_name=work['parent']['model'], tokenizer_id=work['plan']['config']['tokenizer']['id']))
            service = Service(budget, work['plan'])
            data = work['inputs']
            with patch.object(updater_fixtures, 'MODEL', {'id': work['parent']['model']}):
                result = nu.execute_update(data['bundle'], data['splits'], data['config'], data['signals'],
                    budget_path=budget, cap_usd='1.00', output_dir=Path(self.temp.name) / 'update',
                    sdk=updater_fixtures.SDK, service_factory=service.factory, retry_config_factory=NS)
            self.assertEqual(service.calls.count('optimizer'), 1)
            return receipt(work, result)
        result = self.step(update=actual_api)
        self.assertEqual(result['acknowledged_updates'], 1)
        self.assertEqual(result['lineage']['nodes']['a']['training_client_id'], 'mock-training')

    def test_concurrent_coordinator_and_torn_journal_fail_closed(self):
        other = curriculum.Curriculum(self.path, self.spec)
        def locked(work):
            with self.assertRaisesRegex(ValueError, 'curriculum_busy'):
                other.step(evaluate=self.drivers.evaluate)
            return self.drivers.evaluate(work)
        self.step(evaluate=locked)
        with self.path.open('a') as stream:
            stream.write('{"interrupted":')
        with self.assertRaisesRegex(ValueError, 'journal_truncated_needs_reconcile'):
            other.inspect()

    def test_default_cli_is_read_only_even_without_a_journal(self):
        config = Path(self.temp.name) / 'curriculum.json'
        config.write_text(json.dumps(self.spec))
        result = subprocess.run([sys.executable, '-B', str(Path(curriculum.__file__)), str(config),
                                 '--journal', str(self.path)], capture_output=True, text=True, check=True)
        output = json.loads(result.stdout)
        self.assertEqual(output['next_work']['operation'], 'evaluate')
        self.assertFalse(output['dispatches'])
        self.assertFalse(self.path.exists())


if __name__ == '__main__':
    unittest.main()
