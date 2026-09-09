"""Offline exporter boundary checks; authored fixtures, no model or provider calls."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('export_v2', Path(__file__).with_name('update_benchmark_v2.py'))
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def review(case, transcript, score=2):
    return {'status': 'reviewed', 'case_id': case['id'], 'judge_model': 'test-judge',
            'transcript_sha256': e.b.digest(e.b.canonical(transcript)),
            'case_sha256': e.b.digest(e.b.canonical(e.judge.material(case, transcript)['case'])),
            'judge_prompt_sha256': e.b.digest(e.judge.SYSTEM), 'judge_settings': copy.deepcopy(e.judge.SETTINGS),
            'judge_settings_sha256': e.b.digest(e.b.canonical(e.judge.SETTINGS)),
            'ratings': [{'dimension': 'correctness', 'score': score, 'reason': 'Authored test observation',
                         'support': 'self_contained_reasoning', 'uncertainty': '',
                         'evidence': {'kind': 'quote', 'transcript_index': 0, 'quote': transcript[0]['content'], 'observation': 'Test response evidence'}}],
            'usage': {'input_tokens': 10, 'output_tokens': 5}, 'cost_usd': .5}


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name); self.suite = base / 'suite'; self.run = base / 'run'; self.calibration = base / 'calibration.json'
        self.case = {'id': 'case-1', 'category': 'diagnosis', 'messages': [{'role': 'user', 'content': 'Explain 1+1.'}],
                     'rubric': {'correctness': {'zero': 'Wrong', 'one': 'Incomplete', 'two': 'Correct'}}}
        self.transcript = [{'role': 'assistant', 'content': 'Two.'}]
        context = {'system_prompt': 'Teach clearly.', 'tools': [], 'system_prompt_sha256': e.b.digest('Teach clearly.'),
                   'tool_schema_sha256': e.b.digest(e.b.canonical([])), 'provenance': {'private_context': False}}
        self.context = context
        pair = {'id': 'contrast', 'case': self.case, 'positive': self.transcript,
                'negative': [{'role': 'assistant', 'content': 'Three.'}], 'contrast_dimensions': ['correctness']}
        write(self.suite / 'judge-calibration.json', {'pairs': [pair]})
        write(self.suite / 'cases.json', {'cases': [self.case]}); write(self.suite / 'context.json', context)
        write(self.suite / 'rubric.json', {'dimensions': {'correctness': 'Correctness'}})
        manifest = {'files': {p.name: e.b.digest(p.read_bytes()) for p in self.suite.iterdir()}}
        write(self.suite / 'manifest.json', manifest)
        self.control = {'status': 'complete', 'passed': True, 'judge_model': 'test-judge',
                        'calibration_sha256': e.b.digest((self.suite / 'judge-calibration.json').read_bytes()),
                        'pairs': [{'id': 'contrast', 'passed': True, 'reviews': {side: review(self.case, pair[side], 2 if side == 'positive' else 0) for side in ('positive', 'negative')}}]}
        write(self.calibration, self.control)
        self.arm = {'label': 'Test model', 'model': 'public-model', 'provider': 'tinker-native', 'input_rate': 1, 'output_rate': 2,
                    'sampler_path': 'tinker://private-checkpoint/sampler/1', 'owner_did': 'did:plc:private-owner'}
        write(self.run / 'plan.json', {'suite_sha256': e.b.digest((self.suite / 'manifest.json').read_bytes()), 'cases': ['case-1'], 'arms': [self.arm]})
        self.row = {'case_id': 'case-1', 'category': 'diagnosis', 'stop': 'final_response', 'measurement_status': 'collected',
                    'transcript': self.transcript, 'latency_seconds': 3, 'input_tokens': 999999, 'cost_usd': 999,
                    'checks': {'contract_passed': True, 'checks': [{'name': 'test', 'status': 'pass', 'evidence': 'Valid'}], 'private_debug': 'secret'},
                    'calls': [{'wall_seconds': 2, 'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'raw': {'api_key': 'never-public'}},
                               'cost_usd': .01, 'request': {'secret': 'never-public'}, 'response': {'finish_reason': 'stop'}}]}
        self.result = {'id': 'test-model', 'arm': self.arm, 'status': 'complete', 'rows': [self.row]}
        self.receipt = review({**self.case, 'system_prompt': context['system_prompt']}, self.transcript)
        self.persist()

    def persist(self):
        write(self.run / 'test-model/results.json', self.result)
        write(self.run / 'test-model/reviews/case-1.json', self.receipt)

    def export(self):
        return e.build_export(self.run, self.calibration, self.suite)

    def test_valid_evidence_and_candidate_only_costs(self):
        data = self.export(); row = data['models'][0]['rows'][0]
        self.assertEqual(row['quality'], 100); self.assertIs(row['contract_passed'], True)
        self.assertEqual(row['cost_usd'], .01); self.assertEqual(row['output_tokens'], 5)
        self.assertEqual(row['input_tokens'], 10); self.assertEqual(row['provider_seconds'], 2)
        self.assertEqual(row['latency_seconds'], 3); self.assertEqual(data['judge_summary']['known_cost_usd'], .5)
        raw = json.dumps(data)
        for forbidden in ('private-checkpoint', 'private-owner', 'never-public', 'private_debug'):
            self.assertNotIn(forbidden, raw)
        self.assertEqual(data['models'][0]['coverage'], {'expected': 1, 'recorded': 1, 'missing_case_ids': []})

    def test_provider_error_keeps_partial_cost_and_latency_but_no_scores(self):
        self.row['stop'] = 'provider_error'; self.row['measurement_status'] = 'unavailable'
        self.row['calls'].append({'wall_seconds': 1, 'error': {'kind': 'timeout', 'message': 'Bearer private-token'}})
        self.persist(); row = self.export()['models'][0]['rows'][0]
        self.assertIsNone(row['quality']); self.assertIsNone(row['contract_passed'])
        self.assertIsNone(row['cost_usd']); self.assertIsNone(row['output_tokens'])
        self.assertEqual(row['known_cost_usd'], .01); self.assertEqual(row['latency_seconds'], 3)
        self.assertEqual(row['calls'][1]['error'], {'kind': 'timeout'})

    def test_observed_truncation_and_turn_limit_keep_mechanical_failures(self):
        self.row['checks']['contract_passed'] = False
        for stop, status in [('truncated', 'collected'), ('turn_limit', 'collected')]:
            self.row.update(stop=stop, measurement_status=status); self.persist()
            row = self.export()['models'][0]['rows'][0]
            self.assertIsNone(row['quality']); self.assertIs(row['contract_passed'], False)
            self.assertIs(row['checks']['contract_passed'], False)
        self.row.update(stop='final_response', measurement_status='collected', transcript=[{'role': 'assistant', 'content': ''}]); self.persist()
        row = self.export()['models'][0]['rows'][0]
        self.assertIsNone(row['quality']); self.assertIs(row['contract_passed'], False)

    def test_unobserved_provider_harness_and_checker_failures_remain_unknown(self):
        self.row['checks']['contract_passed'] = False
        for stop, status in [('provider_error', 'unavailable'), ('harness_error', 'unavailable'), ('final_response', 'unavailable'), ('provider_error', 'collected')]:
            self.row.update(stop=stop, measurement_status=status); self.persist()
            row = self.export()['models'][0]['rows'][0]
            self.assertIsNone(row['quality']); self.assertIsNone(row['contract_passed'])

    def test_stale_or_invalid_review_is_unscored(self):
        for field, value in [('transcript_sha256', '0' * 64), ('judge_settings_sha256', '0' * 64), ('judge_model', 'other-judge')]:
            saved = self.receipt[field]; self.receipt[field] = value; self.persist()
            self.assertIsNone(self.export()['models'][0]['rows'][0]['quality'])
            self.receipt[field] = saved
        self.receipt['ratings'][0]['score'] = 3; self.persist()
        self.assertIsNone(self.export()['models'][0]['rows'][0]['quality'])

    def test_calibration_requires_actual_completed_contrasts(self):
        self.control['status'] = 'running'; write(self.calibration, self.control)
        self.assertFalse(self.export()['quality_available'])
        self.control['status'] = 'complete'; self.control['pairs'][0]['reviews']['negative']['ratings'][0]['score'] = 2
        write(self.calibration, self.control)
        with self.assertRaisesRegex(ValueError, 'contrast failed'):
            self.export()

    def test_frozen_source_and_private_transcript_fail_closed(self):
        write(self.suite / 'rubric.json', {'changed': True})
        with self.assertRaisesRegex(ValueError, 'Frozen source changed'):
            self.export()
        with self.assertRaisesRegex(ValueError, 'Private identifier'):
            e.public_guard({'transcript': [{'content': 'tinker://private-checkpoint/sampler/1'}]})
        with self.assertRaisesRegex(ValueError, 'Private field'):
            e.public_guard({'api_key': 'opaque credential'})

    def test_unstarted_models_and_unknown_usage_are_not_zero(self):
        self.result['rows'] = []; self.result['status'] = 'unavailable'; self.persist()
        data = self.export(); self.assertFalse(data['quality_available'])
        self.assertEqual(data['models'][0]['rows'], [])
        self.assertEqual(data['models'][0]['coverage']['missing_case_ids'], ['case-1'])
        totals = e.call_totals([e.call_receipt({'usage': {'prompt_tokens': False, 'completion_tokens': -1}, 'wall_seconds': None})])
        self.assertIsNone(totals['input_tokens']); self.assertIsNone(totals['output_tokens']); self.assertIsNone(totals['cost_usd'])


if __name__ == '__main__':
    unittest.main()
