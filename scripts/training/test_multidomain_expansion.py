"""Expansion preserves source families while keeping generation jobs small."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import hashlib

import multidomain_corpus as data
import agy_multidomain as queue
from multidomain_sources import extract_text


class ExpansionTests(unittest.TestCase):
    def test_two_workers_cover_new_domains_without_moving_holdout_families(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cards = []
            for domain in ('music', 'computer-science'):
                for index in range(20):
                    text = f'{domain} source {index}. ' * 100
                    cards.append({'id': f'{domain}-{index}', 'domain': domain, 'text': text,
                                  'text_sha256': hashlib.sha256(text.encode()).hexdigest(),
                                  'url': f'https://example.org/{domain}/{index}',
                                  'license': 'authored-fixture', 'attribution': 'test', 'usage_lane': 'fixture'})
            catalog = root / 'catalog.json'
            data.write(catalog, {'sources': cards})
            outputs = [root / '.keating/outputs' / name for name in ('original', 'minimax', 'deepseek')]
            with patch.object(data, 'ROOT', root):
                data.prepare_multidomain(catalog, outputs[0])
                for index, profile in enumerate(('crush-minimax', 'crush-deepseek')):
                    target = data.prepare_multidomain(catalog, outputs[index + 1], profile, index, 2, 1, 'music')
                    self.assertEqual(target['contrasts'], 2000)
            original, left, right = [data.read(p / 'manifest.json') for p in outputs]
            self.assertFalse(set(left['families']) & set(right['families']))
            combined = left['families'] | right['families']
            self.assertEqual(set(combined), set(original['families']))
            for key, member in combined.items():
                self.assertEqual({k: v for k, v in member.items() if k != 'batch_id'},
                                 {k: v for k, v in original['families'][key].items() if k != 'batch_id'})
            for output, manifest in zip(outputs[1:], (left, right)):
                self.assertTrue(manifest['batch_order'][0].startswith('music-'))
                self.assertEqual(len(manifest['batch_order']), 100)
                self.assertEqual(set(manifest['batch_order']), set(manifest['batches']))
                self.assertEqual({d: len(bs) for d, bs in manifest['pilot_batches'].items()},
                                 {'music': 5, 'computer-science': 5})
                for batch in manifest['batches']:
                    _, packet = data.load_packet(output, batch)
                    self.assertEqual(len(packet['families']), 1)
                    self.assertEqual(packet['examples_per_profile'], 10)

    def test_music_markdown_preserves_chord_notation(self):
        self.assertEqual(extract_text(b'Chord: <c e g>4\n<d f a>2', 'markdown'),
                         'Chord: <c e g>4 <d f a>2')

    def test_queue_checks_a_whole_source_group_with_small_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            batches = [f'music-01-f{i:02}' for i in range(1, 6)]
            manifest = {'batches': dict.fromkeys(batches, 'fixture'), 'batch_order': batches,
                        'pilot_batches': {'music': batches}, 'checkpoint_batches': 5,
                        'execution': data.EXECUTION_PROFILES['crush-deepseek']}
            data.write(directory / 'manifest.json', manifest)
            def completed_job(d, batch, phase, timeout):
                if phase == 'review':
                    data.write(d / f'{batch}.review.json', {'families': [{
                        'approved': True, 'examples': [{'approved': True} for _ in range(20)]}]})
                return {'status': 'complete'}
            with patch.object(queue, 'execute_job', completed_job), patch.object(data, 'compile_multidomain') as compile_output:
                queue.run_queue(directory, max_hours=1)
            status = data.read(directory / 'status.json')
            self.assertEqual(status['state'], 'complete')
            self.assertEqual(status['completed_batches'], batches)
            self.assertEqual(compile_output.call_count, 2)


if __name__ == '__main__':
    unittest.main()
