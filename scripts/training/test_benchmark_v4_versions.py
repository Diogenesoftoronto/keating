"""Offline version contracts; archive bytes are pinned, active prose is not."""
import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import benchmark_diagnostics as diagnostics
import benchmark_v3 as v3
import benchmark_v4 as v4


ARCHIVE_HASHES = {
    'manifest.json': '0633813d1e7369de0853f0377146d5edc8c93735b2b11d97a40ca741d50653fc',
    'cases.json': '3e1eba5ac57f05e6aadcdab17b81e98afc85007a4c72391aa0a5fa8c29994ec0',
    'README.md': '47b210ba9bff08bedd710c6a38fa72f4d1a9fe346fdd60b6017737adae54df66',
}


def abstention_fixture(case):
    """An authored receipt/review pair, never an inference or quality claim."""
    result = {
        'id': case['id'], 'runtime': 'keating-tui-pi-rpc',
        'status': 'completed', 'measurement': 'model_episode',
        'steps': [
            {'index': index, 'kind': step['kind'], 'status': 'completed',
             'message_start_index': 0,
             'messages': [{'role': 'assistant', 'content': 'Offline fixture response.',
                           'stopReason': 'stop'}] if step['kind'] == 'message' else []}
            for index, step in enumerate(case['steps'])
        ],
    }
    review = {
        'reviewer_kind': 'human', 'reviewer_id': 'offline-version-test-not-a-real-review',
        'case_sha256': v4.digest(v4.canonical(case)),
        'result_sha256': v4.digest(v4.canonical(result)),
        'ratings': [
            {'dimension': rule['dimension'], 'score': None,
             'reason': 'Authored protocol fixture only.',
             'uncertainty': 'No independent teaching assessment was performed.'}
            for rule in case['rubric']
        ],
    }
    return result, review


def write_review_fixture(root, suite):
    """Write only into a caller-owned temporary directory."""
    run_directory, reviews = root / 'run', root / 'reviews'
    run_directory.mkdir()
    reviews.mkdir()
    case = suite['cases'][0]
    result, review = abstention_fixture(case)
    files = {
        run_directory / 'v4-binding.json': {
            'benchmark_id': v4.BENCHMARK_ID, 'version': suite['manifest']['version'],
            'manifest_sha256': suite['manifest_sha256'],
            'source_hashes': suite['manifest']['files'],
        },
        run_directory / 'plan.json': {
            'cases_sha256': suite['manifest']['files']['cases.json'], 'cases': [case],
        },
        run_directory / (case['id'] + '.result.json'): result,
        reviews / (case['id'] + '.json'): review,
    }
    for path, value in files.items():
        path.write_text(json.dumps(value), encoding='utf-8')
    return run_directory, reviews


class BenchmarkVersionTests(unittest.TestCase):
    def setUp(self):
        self.historical = v4.load_suite(v4.HISTORICAL_SUITE)
        self.active = v4.load_suite()

    def test_archive_is_byte_frozen_against_original_external_hashes(self):
        # A rewritten manifest cannot legitimize a rewritten archive here.
        for name, expected in ARCHIVE_HASHES.items():
            with self.subTest(file=name):
                raw = (v4.HISTORICAL_SUITE / name).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)
        self.assertEqual(self.historical['manifest_sha256'], ARCHIVE_HASHES['manifest.json'])
        self.assertEqual(self.historical['manifest']['files'],
                         {name: value for name, value in ARCHIVE_HASHES.items() if name != 'manifest.json'})

    def test_default_load_selects_active_and_explicit_archive_selects_historical(self):
        self.assertEqual(v4.VERSION, '4.1.0')
        self.assertEqual(v4.SUPPORTED_VERSIONS, {'4.0.0', '4.1.0'})
        self.assertEqual(v4.HISTORICAL_SUITE, v4.SUITE / 'versions' / '4.0.0')
        self.assertEqual(self.active['directory'], v4.SUITE)
        self.assertEqual(self.active['manifest']['version'], '4.1.0')
        self.assertEqual(self.historical['directory'], v4.HISTORICAL_SUITE)
        self.assertEqual(self.historical['manifest']['version'], '4.0.0')
        self.assertEqual(v4.load_cases(), self.active['cases'])
        self.assertEqual(v4.load_cases(v4.HISTORICAL_SUITE / 'cases.json'), self.historical['cases'])

    def test_source_and_family_identity_survive_while_each_case_hash_changes(self):
        historical = {case['id']: case for case in self.historical['cases']}
        active = {case['id']: case for case in self.active['cases']}
        self.assertEqual(historical.keys(), active.keys())
        for suite in (self.historical, self.active):
            with self.subTest(version=suite['manifest']['version']):
                self.assertEqual(len(suite['cases']), 12)
                self.assertEqual(len({case['family'] for case in suite['cases']}), 10)
                self.assertEqual(sum(step['kind'] == 'message' for case in suite['cases']
                                     for step in case['steps']), 73)
        for case_id, old in historical.items():
            new = active[case_id]
            with self.subTest(case=case_id):
                for key in ('family', 'category', 'pair_id', 'contrast_condition', 'seed_files',
                            'learner_profile', 'profile_lifecycle', 'transfer', 'training_policy'):
                    self.assertEqual(old.get(key), new.get(key), key)
                self.assertEqual([step['kind'] for step in old['steps']],
                                 [step['kind'] for step in new['steps']])
                active_checks = {check['id']: check for check in new['reference']['math_checks']}
                for check in old['reference']['math_checks']:
                    self.assertEqual(check, active_checks.get(check['id']))
                self.assertNotEqual(v4.digest(v4.canonical(old)), v4.digest(v4.canonical(new)))
        self.assertNotEqual(self.historical['manifest']['files']['cases.json'],
                            self.active['manifest']['files']['cases.json'])

    def test_plans_bind_loaded_version_and_sources_with_same_family_schedule(self):
        historical = v4.make_plan(self.historical)
        active = v4.make_plan(self.active)
        for suite, plan, version in ((self.historical, historical, '4.0.0'),
                                     (self.active, active, '4.1.0')):
            with self.subTest(version=version):
                self.assertEqual(plan['version'], version)
                self.assertEqual(plan['manifest_sha256'], suite['manifest_sha256'])
                self.assertEqual(plan['source_hashes'], suite['manifest']['files'])
                self.assertEqual(len(plan['excluded_training_families']), 10)
                self.assertEqual(len(plan['schedule']), 36)
        self.assertEqual(historical['schedule'], active['schedule'])
        self.assertEqual(historical['excluded_training_families'], active['excluded_training_families'])
        self.assertNotEqual(historical['manifest_sha256'], active['manifest_sha256'])

    def test_cli_validate_and_plan_honor_suite_selection_without_execution(self):
        selections = (([], self.active, '4.1.0'),
                      (['--suite', str(v4.HISTORICAL_SUITE)], self.historical, '4.0.0'))
        for command in ('validate', 'plan'):
            for arguments, suite, version in selections:
                with self.subTest(command=command, version=version), \
                        patch.object(v4, 'legacy', side_effect=AssertionError('Unexpected execution seam')), \
                        redirect_stdout(io.StringIO()) as output:
                    v4.main([command, *arguments])
                    report = json.loads(output.getvalue())
                    self.assertEqual(report['version'], version)
                    self.assertEqual(report['manifest_sha256'], suite['manifest_sha256'])
                    if command == 'validate':
                        self.assertEqual((report['cases'], report['families'], report['learner_messages']),
                                         (12, 10, 73))
                    else:
                        self.assertEqual(report['source_hashes'], suite['manifest']['files'])

    def test_mocked_run_receipt_uses_loaded_version_and_archive_hashes(self):
        for suite, version in ((self.historical, '4.0.0'), (self.active, '4.1.0')):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as temp, \
                    patch.object(v3, 'run') as runner, patch.object(v3.b, 'write_json') as writer:
                output, tapes = Path(temp) / 'run', Path(temp) / 'tapes'
                case_id = suite['cases'][0]['id']
                v4.run(output, suite=suite['directory'], tape_directory=tapes, case_id=case_id)
                runner.assert_called_once()
                self.assertEqual(runner.call_args.args, (output,))
                self.assertEqual(runner.call_args.kwargs['suite'], suite['directory'])
                self.assertEqual(runner.call_args.kwargs['case_id'], case_id)
                self.assertEqual(runner.call_args.kwargs['tape_directory'], tapes)
                writer.assert_called_once()
                path, receipt = writer.call_args.args
                self.assertEqual(path, output / 'v4-binding.json')
                self.assertEqual(receipt['version'], version)
                self.assertEqual(receipt['manifest_sha256'], suite['manifest_sha256'])
                self.assertEqual(receipt['source_hashes'], suite['manifest']['files'])
                self.assertEqual(receipt['measurement'], 'offline_integration')
                self.assertFalse(output.exists())

    def test_valid_historical_reviews_reject_active_cases_with_the_same_id(self):
        active = {case['id']: case for case in self.active['cases']}
        for old in self.historical['cases']:
            with self.subTest(case=old['id']):
                result, review = abstention_fixture(old)
                self.assertIsNone(v4.validate_review(old, result, review))
                with self.assertRaisesRegex(ValueError, 'Review hash binding mismatch'):
                    v4.validate_review(active[old['id']], result, review)

    def test_review_run_reports_loaded_version_for_valid_bound_reviews(self):
        for suite, version in ((self.historical, '4.0.0'), (self.active, '4.1.0')):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as temp:
                run_directory, reviews = write_review_fixture(Path(temp), suite)
                report = v4.review_run(run_directory, reviews, suite=suite['directory'])
                self.assertEqual(report['version'], version)
                self.assertEqual(len(report['rows']), 1)
                row = report['rows'][0]
                self.assertEqual(row['case_id'], suite['cases'][0]['id'])
                self.assertIsNone(row['quality'])
                self.assertEqual(row['status'], 'unknown')
                self.assertIsNone(row['response_quality'])
                self.assertEqual(row['response_grading_status'], 'missing')
                self.assertIsNone(row['response_coverage'])

    def test_historical_run_binding_is_rejected_by_default_active_review(self):
        with tempfile.TemporaryDirectory() as temp:
            run_directory, reviews = write_review_fixture(Path(temp), self.historical)
            self.assertEqual(v4.review_run(run_directory, reviews, v4.HISTORICAL_SUITE)['version'], '4.0.0')
            with self.assertRaisesRegex(ValueError, 'Run suite binding mismatch'):
                v4.review_run(run_directory, reviews)

    def test_diagnostics_attribute_explicit_historical_and_default_active_versions(self):
        for suite, version, kwargs in ((self.historical, '4.0.0', {'benchmark_version': '4.0.0'}),
                                       (self.active, '4.1.0', {})):
            with self.subTest(version=version):
                case = suite['cases'][0]
                result, _ = abstention_fixture(case)
                report = diagnostics.diagnose(case, result, **kwargs)
                self.assertEqual(report['benchmark_version'], version)
                self.assertEqual(report['case_sha256'], v4.digest(v4.canonical(case)))
                self.assertEqual(report['result_sha256'], v4.digest(v4.canonical(result)))
                self.assertTrue(report['responses'])
                self.assertFalse(report['inference_performed'])

    def test_diagnostics_reject_unsupported_version_attribution(self):
        case = self.active['cases'][0]
        result, _ = abstention_fixture(case)
        with self.assertRaisesRegex(ValueError, 'Unknown benchmark version'):
            diagnostics.diagnose(case, result, benchmark_version='4.0.1')

    def test_diagnostic_cli_passes_historical_suite_version_into_saved_report(self):
        case = self.historical['cases'][0]
        result, _ = abstention_fixture(case)
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'result.json', Path(temp) / 'diagnostics'
            source.write_text(json.dumps(result), encoding='utf-8')
            with redirect_stdout(io.StringIO()) as stdout:
                diagnostics.main([str(source), '--suite', str(v4.HISTORICAL_SUITE), '--output', str(output)])
            self.assertFalse(json.loads(stdout.getvalue())['inference_performed'])
            report = json.loads((output / 'diagnostics.json').read_text(encoding='utf-8'))
            self.assertEqual(report['benchmark_version'], '4.0.0')
            self.assertEqual(report['case_sha256'], v4.digest(v4.canonical(case)))
            self.assertFalse(report['inference_performed'])


if __name__ == '__main__':
    unittest.main()
