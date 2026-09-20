"""Context, classification, grading and command integration; no hosted inference."""
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

import benchmark_response_grading as g
import benchmark_v4 as v4
from observer_core import digest


def classifier_manifest():
    return {'kind': 'fixture', 'id': 'contract-fixture', 'revision': '1', 'protocol': g.PROTOCOL,
            'artifact_sha256': 'a'*64, 'calibration_sha256': None, 'minimum_confidence': 0.8}


def need_for(request):
    message = request['input']['messages'][-1]
    return {'need': 'explanation_needed', 'confidence': 0.95, 'reason': 'Authored judgment fixture.',
            'evidence': [{'message_index': message['message_index'], 'start': 0,
                          'end': len(message['text']), 'text': message['text']}]}


def reaction_for(request, fit='appropriate'):
    text = request['input']['response']
    return {'legible': True, 'meta': False, 'correct': True, 'confidence': 0.95,
            'reason': 'Authored judgment fixture.', 'moves': [{'kind': 'explanation', 'start': 0,
                'end': len(text), 'text': text, 'fit': fit, 'substantive': True, 'reason': 'Fixture move.'}]}


class ResponseGradingTests(unittest.TestCase):
    def setUp(self):
        self.suite = v4.load_suite()
        self.case = self.suite['cases'][0]
        self.result = {'id': self.case['id'], 'runtime': 'keating-tui-pi-rpc',
                       'measurement': 'model_episode', 'status': 'completed', 'steps': []}
        messages = []
        for i, step in enumerate(self.case['steps']):
            start = len(messages)
            messages.extend([{'role': 'user', 'content': step['text']},
                             {'role': 'assistant', 'content': 'Six times x is 30. Divide by six.', 'stopReason': 'stop'}])
            self.result['steps'].append({'index': i, 'kind': 'message', 'status': 'completed',
                                        'message_start_index': start, 'messages': copy.deepcopy(messages)})
        self.manifest = classifier_manifest()
        self.calls = []

    def classify(self, request):
        self.calls.append(copy.deepcopy(request))
        return need_for(request) if request['stage'] == 'need' else reaction_for(request)

    def grade(self, classify=None):
        return g.grade_case(self.case, self.result, classify or self.classify, self.manifest)

    def test_need_pass_has_prefix_only_not_response_future_or_private_rubric(self):
        report = self.grade()
        self.assertEqual([r['stage'] for r in self.calls], ['need', 'reaction']*6)
        first = self.calls[0]['input']
        self.assertEqual([m['text'] for m in first['messages']], [self.case['steps'][0]['text']])
        self.assertNotIn('response', first)
        self.assertNotIn('reference', first)
        self.assertNotIn('rubric', first)
        self.assertEqual(self.calls[1]['input']['need'], report['responses'][0]['need'])
        self.assertTrue(all(f['available_from_step'] <= 0 for f in self.calls[1]['input']['reference']['facts']))

    def test_same_explanation_can_help_after_failure_or_take_over_productive_attempt(self):
        first = self.grade()
        seen = []
        self.result['steps'][0]['messages'][0]['content'] = 'Wait, I am working it out. I have a new approach.'
        def judge(request):
            if request['stage'] == 'need':
                seen.append(request['input'])
                return {**need_for(request), 'need': 'room_to_reason'}
            return reaction_for(request, 'overhelp')
        second = self.grade(judge)
        self.assertEqual(first['responses'][0]['text'], second['responses'][0]['text'])
        self.assertNotEqual(first['responses'][0]['context']['context_sha256'], second['responses'][0]['context']['context_sha256'])
        self.assertEqual(first['turn_scores'][0]['score'], 2)
        self.assertEqual(second['turn_scores'][0]['score'], 0)
        self.assertEqual(seen[0]['messages'][-1]['text'], 'Wait, I am working it out. I have a new approach.')

    def test_withholding_needed_help_is_a_failure_too(self):
        def judge(request):
            if request['stage'] == 'need': return need_for(request)
            r = reaction_for(request, 'underhelp')
            r['moves'][0]['kind'] = 'withholding'
            return r
        self.assertTrue(all(t['score'] == 0 for t in self.grade(judge)['turn_scores']))

    def test_action_label_alone_never_determines_grade(self):
        for kind in g.MOVES:
            def judge(request):
                if request['stage'] == 'need': return need_for(request)
                r = reaction_for(request)
                r['moves'][0]['kind'] = kind
                return r
            with self.subTest(kind=kind):
                self.assertEqual(self.grade(judge)['turn_scores'][0]['score'], 2)

    def test_insubstantive_help_partial_and_incorrect_help_zero(self):
        for field, value, expected in [('substantive', False, 1), ('correct', False, 0), ('meta', True, 0)]:
            def judge(request):
                if request['stage'] == 'need': return need_for(request)
                r = reaction_for(request)
                if field == 'substantive': r['moves'][0][field] = value
                else: r[field] = value
                return r
            with self.subTest(field=field):
                self.assertEqual(self.grade(judge)['turn_scores'][0]['score'], expected)

    def test_low_confidence_or_unknown_correctness_does_not_become_failure(self):
        for change in ({'confidence': 0.5}, {'correct': None}):
            def judge(request):
                return need_for(request) if request['stage'] == 'need' else {**reaction_for(request), **change}
            report = self.grade(judge)
            self.assertIsNone(report['response_quality'])
            self.assertEqual(report['coverage']['graded_turns'], 0)

    def test_future_need_evidence_rejected(self):
        def judge(request):
            n = need_for(request)
            n['evidence'][0]['message_index'] = 10000
            return n
        with self.assertRaisesRegex(ValueError, 'outside actual prefix'): self.grade(judge)

    def test_forged_localization_and_duplicate_moves_rejected(self):
        for mode in ('wrong_text', 'duplicate'):
            def judge(request):
                if request['stage'] == 'need': return need_for(request)
                r = reaction_for(request)
                if mode == 'wrong_text': r['moves'][0]['text'] = 'fabricated'
                else: r['moves'].append(copy.deepcopy(r['moves'][0]))
                return r
            with self.subTest(mode=mode), self.assertRaises(ValueError): self.grade(judge)

    def test_clipped_or_missing_context_cannot_receive_a_grade(self):
        for mode in ('clipped', 'missing_user', 'image'):
            result = copy.deepcopy(self.result)
            if mode == 'clipped': result['steps'][0]['messages'][1]['stopReason'] = 'length'
            elif mode == 'missing_user': result['steps'][0]['messages'][0]['role'] = 'system'
            else: result['steps'][0]['messages'][0]['content'] = [{'type': 'image', 'data': 'omitted'}]
            report = g.grade_case(self.case, result, self.classify, self.manifest)
            with self.subTest(mode=mode):
                self.assertIsNone(report['turn_scores'][0]['score'])
                self.assertIsNone(report['response_quality'])

    def test_tape_never_dispatches_classifier_or_claims_quality(self):
        self.result['measurement'] = 'offline_integration'
        report = self.grade(lambda _: self.fail('Tape must not dispatch'))
        self.assertIsNone(report['response_quality'])
        self.assertEqual(report['coverage']['graded_turns'], 0)

    def test_fixture_classifier_cannot_masquerade_as_measured_grade(self):
        report = self.grade()
        self.assertEqual(report['source'], 'fixture')
        self.assertEqual(report['coverage']['graded_turns'], 6)
        self.assertIsNone(report['response_quality'])

    def test_automatic_grade_is_reconstructed_before_consumption(self):
        report = self.grade()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'grade.json'
            path.write_text(v4.canonical(report))
            self.assertEqual(g.read_grade(path, self.case, self.result), report)
            report['turn_scores'][0]['score'] = 0
            report['grading_sha256'] = digest({k:v for k,v in report.items() if k != 'grading_sha256'})
            path.write_text(v4.canonical(report))
            with self.assertRaisesRegex(ValueError, 'reconstruction'): g.read_grade(path, self.case, self.result)

    def test_activation_classifier_cannot_reuse_unpinned_or_uncalibrated_head(self):
        self.manifest['kind'] = 'activation_probe'
        with self.assertRaisesRegex(ValueError, 'observer and calibration'): g.validate_classifier(self.manifest)

    def test_cli_automatic_classification_and_review_integration(self):
        # An actual local subprocess exercises the classifier wire protocol. Its
        # authored decisions are fixtures, not a test of a model's teaching judgment.
        code = ('import json,sys; from test_benchmark_response_grading import need_for,reaction_for; '
                'r=json.load(sys.stdin); print(json.dumps(need_for(r) if r["stage"]=="need" else reaction_for(r)))')
        with tempfile.TemporaryDirectory() as temporary:
            run = Path(temporary)
            config = {'command': [sys.executable, '-c', f'import sys;sys.path.insert(0,{str(Path(__file__).parent)!r});'+code],
                      'classifier': self.manifest, 'max_calls': 12, 'timeout_seconds': 10}
            (run/'config.json').write_text(v4.canonical(config))
            (run/'plan.json').write_text(v4.canonical({'cases': [self.case], 'model': 'different-candidate',
                'cases_sha256': self.suite['manifest']['files']['cases.json']}))
            (run/'v4-binding.json').write_text(v4.canonical({'manifest_sha256': self.suite['manifest_sha256'],
                'source_hashes': self.suite['manifest']['files']}))
            (run/(self.case['id']+'.result.json')).write_text(v4.canonical(self.result))
            with redirect_stdout(io.StringIO()) as output:
                v4.main(['grade', str(run), '--grader-config', str(run/'config.json')])
            summary = json.loads(output.getvalue())
            self.assertEqual(summary['rows'][0]['status'], 'classified')
            self.assertEqual(summary['rows'][0]['coverage']['graded_turns'], 6)
            report = v4.review_run(run, run/'no-reviews')
            self.assertEqual(report['rows'][0]['response_grading_status'], 'classified')
            self.assertEqual(report['rows'][0]['response_coverage']['graded_turns'], 6)
            self.assertIsNone(report['rows'][0]['quality'])
            self.assertIsNone(report['rows'][0]['response_quality'])
            with self.assertRaises(FileExistsError): g.grade_run(run, config)


if __name__ == '__main__':
    unittest.main()
