"""Offline authored fixtures; no probe execution or real activation claims."""
from copy import deepcopy
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import benchmark_diagnostics as d
import benchmark_v4 as v4


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.case = next(c for c in v4.load_suite()['cases'] if c['id'] == 'help-hint-then-flip')
        self.text = 'A😀 hint\n</pre><img src=x onerror="alert(1)"> OpenUI(<Card />)'
        self.result = {'id': self.case['id'], 'runtime': 'keating-tui-pi-rpc', 'status': 'completed',
            'measurement': 'model_episode', 'steps': [], 'requests': ['PRIVATE REQUEST'], 'files': ['PRIVATE FILE']}
        for i, step in enumerate(self.case['steps']):
            self.result['steps'].append({'index': i, 'kind': step['kind'], 'status': 'completed',
                'message_start_index': 1 if step['kind'] == 'message' else 0,
                'state': {'secret': 'PRIVATE STATE'}, 'events': ['PRIVATE EVENT'], 'messages': [
                    {'role': 'assistant', 'content': 'OLD ASSISTANT'},
                    {'role': 'user', 'content': 'PRIVATE USER'},
                    {'role': 'assistant', 'content': [{'type': 'thinking', 'thinking': 'PRIVATE THINKING'},
                        {'type': 'toolCall', 'text': 'PRIVATE CALL', 'arguments': {'secret': 'PRIVATE ARG'}},
                        {'type': 'text', 'text': 'PRIVATE BLOCK', 'visibility': 'private'},
                        {'type': 'text', 'text': self.text}], 'stopReason': 'stop'},
                    {'role': 'toolResult', 'content': 'PRIVATE TOOL'},
                    {'role': 'assistant', 'visibility': 'private', 'content': 'PRIVATE MESSAGE'},
                    {'role': 'assistant', 'channel': 'analysis', 'content': 'PRIVATE ANALYSIS'},
                    {'role': 'source_observation', 'content': 'PRIVATE SOURCE'},
                ]})
        responses = d.extract_responses(self.case, self.result)
        self.response = next(r for r in responses if r['step_index'] in self.case['rubric'][0]['evidence_steps'])
        # Production-shaped mock metadata is solely for validator tests.
        manifest = {'evidence': 'model_extraction', 'observer_model': 'MOCK-not-real-Qwen', 'revision': 'fixture'}
        card = {'definition': 'Authored protocol fixture', 'target': 'mock-issue', 'boundary': 'action',
                'observer_manifest_sha256': d.digest(manifest)}
        self.annotation = {'response_hash': self.response['response_hash'], 'observer_manifest_sha256': d.digest(manifest),
            'probe_card_sha256': d.digest(card), 'prediction_sha256': 'c' * 64, 'dimension': card['target'],
            'score': .9, 'threshold': .5, 'spans': [{'start': 1, 'end': 2, 'text': '😀'}],
            'rubric_dimension': self.case['rubric'][0]['dimension'], 'positive_means': 'rubric_issue'}
        self.annotations = {'schema_version': 1, 'observer_manifest': manifest, 'probe_cards': [card],
                            'annotations': [self.annotation]}

    def review(self, score=2):
        ratings = []
        for rule in self.case['rubric']:
            evidence = [{'kind': 'quote', 'step_index': i, 'message_index': 2, 'quote': 'hint'}
                        for i in rule['evidence_steps']]
            ratings.append({'dimension': rule['dimension'], 'score': score,
                'reason': 'Authored protocol fixture; not actual review.', 'evidence': evidence[0],
                'additional_evidence': evidence[1:]})
        return {'reviewer_kind': 'human', 'reviewer_id': 'MOCK-independent-reviewer', 'ratings': ratings,
                'case_sha256': d.digest(self.case), 'result_sha256': d.digest(self.result)}

    def test_only_new_visible_assistant_text_with_explicit_raw_label(self):
        report = d.diagnose(self.case, self.result)
        self.assertEqual(len(report['responses']), sum(s['kind'] == 'message' for s in self.case['steps']))
        self.assertTrue(all(r['text'] == self.text and r['message_index'] == 2 for r in report['responses']))
        encoded = v4.canonical(report)
        for secret in ('OLD ASSISTANT', 'PRIVATE USER', 'PRIVATE THINKING', 'PRIVATE CALL', 'PRIVATE ARG',
                       'PRIVATE BLOCK', 'PRIVATE MESSAGE', 'PRIVATE TOOL', 'PRIVATE ANALYSIS', 'PRIVATE SOURCE',
                       'PRIVATE REQUEST', 'PRIVATE FILE', 'PRIVATE EVENT', 'PRIVATE STATE'):
            self.assertNotIn(secret, encoded)
        self.assertEqual(report['projection'], d.PROJECTION)
        self.assertEqual(report['independent_rubric'], None)
        self.assertEqual(report['candidate_benchmark_gaps'], [])
        self.assertTrue(all(r['probe_status'] == 'unknown' for r in report['responses']))

    def test_stable_hashes_and_offsets_bind_exact_result_and_actor(self):
        report = d.diagnose(self.case, self.result)
        reformatted = json.loads(json.dumps(self.result, indent=4, sort_keys=True))
        self.assertEqual(report, d.diagnose(self.case, reformatted))
        other = deepcopy(self.result)
        other['actor_checkpoint'] = 'different-checkpoint'
        self.assertNotEqual(report['responses'][0]['response_hash'], d.diagnose(self.case, other)['responses'][0]['response_hash'])
        self.assertEqual(report['responses'][0]['character_count'], len(self.text))
        self.assertEqual(report['responses'][0]['text_sha256'], v4.digest(self.text))

    def test_string_and_multiple_text_blocks_have_declared_offsets(self):
        step = next(s for s in self.result['steps'] if s['kind'] == 'message')
        step['messages'][2]['content'] = [{'type': 'text', 'text': 'first'}, {'type': 'thinking', 'text': 'secret'},
                                        {'type': 'text', 'text': '😀last'}]
        self.assertEqual(d.extract_responses(self.case, self.result)[0]['text'], 'first\n😀last')
        step['messages'][2]['content'] = self.text
        self.assertEqual(d.extract_responses(self.case, self.result)[0]['text'], self.text)

    def test_invalid_new_message_boundaries_fail_closed(self):
        for bad in (None, -1, True, 1.5, 999):
            result = deepcopy(self.result)
            result['steps'][0]['message_start_index'] = bad
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, 'boundary'):
                d.diagnose(self.case, result)

    def test_probe_high_score_queues_only_a_proposal_and_does_not_score_rubric(self):
        before = deepcopy((self.case, self.result, self.annotations))
        report = d.diagnose(self.case, self.result, self.annotations)
        candidate = report['candidate_benchmark_gaps'][0]
        self.assertEqual(candidate['reasons'], ['probe_above_threshold'])
        self.assertIsNone(candidate['independent_rubric'])
        self.assertIsNone(candidate['probe_signal']['rubric_disagreement'])
        self.assertEqual(candidate['training_policy'], 'exclude-entire-family')
        self.assertEqual(candidate['proposed_next_suite_addition']['status'], 'needs_independent_review')
        self.assertFalse(report['inference_performed'])
        self.assertFalse(report['suite_changes'])
        self.assertEqual(before, (self.case, self.result, self.annotations))

    def test_low_scores_are_signals_not_passes_and_missing_annotations_stay_unknown(self):
        self.annotation['score'] = .1
        report = d.diagnose(self.case, self.result, self.annotations)
        self.assertEqual(report['candidate_benchmark_gaps'], [])
        annotated = next(r for r in report['responses'] if r['response_hash'] == self.response['response_hash'])
        self.assertEqual(annotated['probe_status'], 'annotations_supplied')
        self.assertTrue(any(r['probe_status'] == 'unknown' for r in report['responses']))
        self.assertNotIn('passing', v4.canonical(report))

    def test_forged_response_observer_card_and_prediction_hashes_are_rejected(self):
        for field in ('response_hash', 'observer_manifest_sha256', 'probe_card_sha256', 'prediction_sha256'):
            annotations = deepcopy(self.annotations)
            annotations['annotations'][0][field] = 'not-a-hash' if field == 'prediction_sha256' else 'f' * 64
            with self.subTest(field=field), self.assertRaises(ValueError):
                d.diagnose(self.case, self.result, annotations)
        self.annotations['probe_cards'][0]['definition'] = 'forged card'
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            d.diagnose(self.case, self.result, self.annotations)

    def test_spans_require_exact_unicode_text_and_valid_end_exclusive_bounds(self):
        for span in ({'start': -1, 'end': 1, 'text': 'A'}, {'start': 0, 'end': 999, 'text': self.text},
                     {'start': 1, 'end': 1, 'text': ''}, {'start': True, 'end': 2, 'text': '😀'},
                     {'start': 1, 'end': 3, 'text': '😀'}, {'start': 1, 'end': 2, 'text': 'invented'}):
            annotations = deepcopy(self.annotations)
            annotations['annotations'][0]['spans'] = [span]
            with self.subTest(span=span), self.assertRaisesRegex(ValueError, 'Span'):
                d.diagnose(self.case, self.result, annotations)

    def test_scores_thresholds_missing_provenance_and_duplicates_fail(self):
        for field in ('score', 'threshold'):
            for value in (float('nan'), float('inf'), -.1, 1.1, True, None):
                annotations = deepcopy(self.annotations)
                annotations['annotations'][0][field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    d.diagnose(self.case, self.result, annotations)
        self.annotations['annotations'].append(deepcopy(self.annotation))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            d.diagnose(self.case, self.result, self.annotations)
        self.annotations['observer_manifest']['evidence'] = 'toy_model_not_qwen'
        with self.assertRaisesRegex(ValueError, 'Real observer'):
            d.diagnose(self.case, self.result, self.annotations)

    def test_independent_rubric_disagreement_uses_explicit_polarity_not_rescaled_scores(self):
        report = d.diagnose(self.case, self.result, self.annotations, self.review(2))
        candidate = report['candidate_benchmark_gaps'][0]
        self.assertIn('probe_rubric_disagreement', candidate['reasons'])
        self.assertEqual(candidate['independent_rubric']['score'], 2)
        self.assertEqual(candidate['probe_signal']['score'], .9)
        self.annotation['score'] = .1
        candidate = d.diagnose(self.case, self.result, self.annotations, self.review(0))['candidate_benchmark_gaps'][0]
        self.assertEqual(candidate['reasons'], ['probe_rubric_disagreement'])
        self.assertEqual(d.diagnose(self.case, self.result, self.annotations, self.review(1))['candidate_benchmark_gaps'], [])

    def test_forged_independent_review_is_not_accepted(self):
        review = self.review()
        review['result_sha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'hash binding'):
            d.diagnose(self.case, self.result, self.annotations, review)

    def test_escaped_standalone_html_and_overlapping_spans(self):
        self.annotation['spans'].append({'start': 0, 'end': len(self.text), 'text': self.text})
        report = d.diagnose(self.case, self.result, self.annotations)
        html = d.render_html(report)
        class Tags(HTMLParser):
            def __init__(self):
                super().__init__()
                self.tags = []
            def handle_starttag(self, tag, attrs):
                self.tags.append(tag)
        parser = Tags()
        parser.feed(html)
        self.assertNotIn('img', parser.tags)
        self.assertNotIn('script', parser.tags)
        self.assertIn('mark', parser.tags)
        self.assertIn('&lt;img', html)
        self.assertIn('including OpenUI source', html)
        self.assertIn('Content-Security-Policy', html)

    def test_failed_partial_results_are_inspectable_without_fabricated_future_responses(self):
        self.result['status'] = 'failed'
        self.result['steps'] = self.result['steps'][:1]
        self.result['steps'][0]['status'] = 'failed'
        self.result['steps'][0]['messages'][2]['stopReason'] = 'length'
        report = d.diagnose(self.case, self.result)
        self.assertEqual(len(report['responses']), 1)
        self.assertEqual(report['responses'][0]['stop_reason'], 'length')
        self.assertIsNone(report['independent_rubric'])

    def test_cli_writes_only_new_diagnostic_outputs_and_preserves_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'result.json', Path(temp) / 'diagnostics'
            source.write_text(json.dumps(self.result))
            before = source.read_bytes()
            cmd = [sys.executable, '-B', d.__file__, str(source), '--output', str(output)]
            run = subprocess.run(cmd, capture_output=True, text=True, check=True)
            self.assertFalse(json.loads(run.stdout)['inference_performed'])
            self.assertEqual({p.name for p in output.iterdir()}, {'index.html', 'diagnostics.json', 'queue.json'})
            self.assertEqual(json.loads((output / 'queue.json').read_text()), [])
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 2)
            cmd[-1] = str(v4.SUITE / 'diagnostic-write-forbidden')
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 2)
            self.assertFalse((v4.SUITE / 'diagnostic-write-forbidden').exists())


if __name__ == '__main__':
    unittest.main()
