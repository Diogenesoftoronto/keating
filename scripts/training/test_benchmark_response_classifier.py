"""Hosted adapter wire behavior with mocked HTTP; never sends a request."""
import io
import json
import os
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch, MagicMock

import benchmark_response_classifier as c


class ClassifierAdapterTests(unittest.TestCase):
    def invoke(self, raw, args=None):
        client = MagicMock()
        client.__enter__.return_value = client
        client.post.return_value.json.return_value = raw
        request = {'protocol': 'contextual-tutor-response/v1', 'stage': 'need',
                   'system': 'Classify evidence.', 'input': {'messages': []}}
        default = ['--endpoint', 'https://example.invalid/v1', '--model', 'independent-judge',
                   '--api-key-env', 'KEATING_TEST_JUDGE_KEY']
        with patch.dict(os.environ, {'KEATING_TEST_JUDGE_KEY': 'fixture-not-a-real-secret'}), \
             patch('httpx.Client', return_value=client), patch('sys.stdin', io.StringIO(json.dumps(request))), \
             redirect_stdout(io.StringIO()) as output, redirect_stderr(io.StringIO()) as error:
            try:
                c.main(args or default)
                status = 0
            except SystemExit as e:
                status = e.code
        return status, output.getvalue(), error.getvalue(), client

    def test_json_decision_and_api_parameters_survive_adapter(self):
        value = {'need': 'unknown', 'confidence': 0.1, 'reason': 'Missing context', 'evidence': []}
        status, output, error, client = self.invoke({'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(value)}}]})
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output), value)
        self.assertEqual(error, '')
        self.assertEqual(client.post.call_args.args[0], 'https://example.invalid/v1/chat/completions')
        payload = client.post.call_args.kwargs['json']
        self.assertEqual(payload['response_format'], {'type': 'json_object'})
        self.assertEqual(json.loads(payload['messages'][1]['content'])['stage'], 'need')
        self.assertNotIn('fixture-not-a-real-secret', output)

    def test_truncation_and_malformed_json_have_no_decision_or_raw_error(self):
        for finish, content in [('length', '{}'), ('stop', 'not JSON')]:
            with self.subTest(finish=finish, content=content):
                status, output, error, _ = self.invoke({'choices': [{'finish_reason': finish, 'message': {'content': content}}]})
                self.assertEqual(status, 2)
                self.assertEqual(output, '')
                self.assertIn('no grade', error)
                self.assertNotIn('fixture-not-a-real-secret', error)

    def test_credentials_in_endpoint_are_rejected_before_dispatch(self):
        status, output, _, client = self.invoke({}, ['--endpoint', 'https://user:secret@example.invalid/v1',
            '--model', 'judge', '--api-key-env', 'KEATING_TEST_JUDGE_KEY'])
        self.assertEqual(status, 2)
        self.assertEqual(output, '')
        client.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
