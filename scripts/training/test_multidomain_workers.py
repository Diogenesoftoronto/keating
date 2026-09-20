"""Worker isolation and honest model provenance across generation and exports."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import agy_multidomain as queue
import multidomain_corpus as data
from test_multidomain_corpus import prepare_fixture


class WorkerTests(unittest.TestCase):
    def test_crush_workers_bind_commands_receipts_reviews_and_exports(self):
        for profile_name in ('crush-minimax', 'crush-deepseek'):
            with self.subTest(profile=profile_name), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                packet, draft, review = prepare_fixture(directory)
                batch = packet['batch_id']
                manifest = data.read(directory / 'manifest.json')
                manifest.pop('manifest_sha256')
                manifest['execution'] = deepcopy(data.EXECUTION_PROFILES[profile_name])
                manifest['manifest_sha256'] = data.digest(manifest)
                (directory / 'manifest.json').write_text(json.dumps(manifest))
                model = manifest['execution']['draft']['model']
                review['model'] = model
                commands = []

                class CompletedProcess:
                    def __init__(self, command, **kwargs):
                        commands.append(command)
                        phase = 'draft' if len(commands) == 1 else 'review'
                        data.write(directory / f'{batch}.{phase}.json', draft if phase == 'draft' else review)

                    def wait(self, **kwargs):
                        return 0

                with patch.object(queue.subprocess, 'Popen', CompletedProcess):
                    # Keep the production document validator outside the fake provider boundary.
                    with patch.object(queue.corpus, 'validate_native_documents', return_value={'documents': 1}):
                        for phase in ('draft', 'review'):
                            receipt = queue.execute_job(directory, batch, phase)
                            self.assertEqual(receipt['status'], 'complete')
                            self.assertEqual((receipt['engine'], receipt['model']), ('crush', model))
                self.assertEqual(len(commands), 2)  # Fresh run for each phase.
                for command in commands:
                    self.assertEqual(command[command.index('--cwd') + 1], str(directory))
                    self.assertEqual(command[command.index('--model') + 1], model)
                    self.assertEqual(command[command.index('--small-model') + 1], model)
                    self.assertNotIn('WORKER_MODEL', command[-1])
                wrong_review = deepcopy(review)
                wrong_review['model'] = data.MODEL
                with self.assertRaisesRegex(ValueError, 'Review identity'):
                    data.validate_multidomain_review(wrong_review, draft, packet, model)

                receipt_path = next(directory.glob(f'{batch}.draft.*.receipt.json'))
                receipt = data.read(receipt_path)
                for field, wrong in [('engine', 'agy'), ('model', data.MODEL)]:
                    receipt_path.write_text(json.dumps(receipt | {field: wrong}))
                    with self.assertRaisesRegex(ValueError, 'Missing successful'):
                        data.accepted_receipt(directory, batch, 'draft', data.digest(draft))
                receipt_path.write_text(json.dumps(receipt))

                output = directory / 'compiled'
                report = data.compile_multidomain(directory, output)
                self.assertEqual(report['review_design'], 'same-model separate-session review')
                self.assertGreater(report['sft_candidates'], 0)
                for record in data.read(output / 'observer-records.json')['records']:
                    self.assertEqual(record['source_metadata']['generation']['draft']['model'], model)
                    for label in record['label_provenance'].values():
                        self.assertEqual(label['model'], model)
                        self.assertEqual(label['draft_model'], model)
                for name in ('native-scenarios.json', 'profiles.json', 'sft-candidates.json'):
                    payload = json.dumps(data.read(output / name))
                    self.assertIn(model, payload)
                    self.assertNotIn(data.MODEL, payload)


if __name__ == '__main__':
    unittest.main()
