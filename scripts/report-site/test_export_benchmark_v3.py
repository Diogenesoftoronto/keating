import unittest

from export_benchmark_v3 import episode_usage, public_trace, truncated_calls


class ExportTests(unittest.TestCase):
    def test_cache_reads_are_not_charged_as_uncached_input_twice(self):
        assistant = {'role': 'assistant', 'stopReason': 'stop',
                     'usage': {'input': 100, 'output': 20, 'cacheRead': 900, 'cacheWrite': 0}}
        result = {'steps': [{'state': {'sessionId': 'one'}, 'messages': [assistant]},
                            {'state': {'sessionId': 'one'}, 'messages': [assistant]}]}
        usage = episode_usage(result, {'input_per_million': 2, 'output_per_million': 10, 'cached_input_per_million': .2})
        self.assertAlmostEqual(usage['cost_usd'], .00058)
        self.assertAlmostEqual(usage['estimated_uncached_cost_usd'], .0022)
        self.assertEqual(usage['output_tokens'], 20)
        assistant['stopReason'] = 'error'
        self.assertIsNone(episode_usage(result, {})['cost_usd'])
        self.assertIsNone(episode_usage(result, {})['output_tokens'])
        self.assertIsNone(episode_usage(result, {})['estimated_uncached_cost_usd'])

    def test_export_retains_visible_evidence_and_drops_reasoning_and_raw_settings(self):
        result = {'steps': [{'index': 0, 'kind': 'message', 'status': 'completed', 'message_start_index': 0,
                            'messages': [{'role': 'assistant', 'content': [{'type': 'thinking', 'thinking': 'PRIVATE'},
                                         {'type': 'text', 'text': 'A visible answer'}]}], 'files': []}],
                  'configuration': {'credential': 'PRIVATE'}, 'requests': [], 'source_provenance': {'unchanged_at_end': True}}
        exported = public_trace(result)
        self.assertNotIn('PRIVATE', str(exported))
        self.assertIn('A visible answer', str(exported))
        self.assertTrue(exported['runtime_unchanged'])

    def test_output_limit_count_ignores_repeated_history_and_reopen(self):
        answer = {'role': 'assistant', 'stopReason': 'length'}
        result = {'steps': [{'kind': 'message', 'messages': [answer], 'message_start_index': 0},
                            {'kind': 'reopen', 'messages': [answer], 'message_start_index': 0},
                            {'kind': 'message', 'messages': [answer, {'role': 'assistant', 'stopReason': 'stop'}], 'message_start_index': 1}]}
        self.assertEqual(truncated_calls(result), 1)


if __name__ == '__main__':
    unittest.main()
