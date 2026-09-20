import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import benchmark_sources as sources


class OriginalSourceTests(unittest.TestCase):
    def fixture(self, body=b'[{"answer": "evaluator-only"}]'):
        asset = dict(path='train.json', bytes=len(body), sha256=hashlib.sha256(body).hexdigest(), url='unused')
        return dict(id='fixture', revision='pinned', files=[asset]), asset, body

    def test_tampering_is_rejected_without_network_or_overwrite(self):
        source, asset, body = self.fixture()
        with tempfile.TemporaryDirectory() as cache:
            path = sources.original_path(source, asset, cache)
            path.parent.mkdir(parents=True)
            path.write_bytes(body)
            self.assertEqual(sources.original_records(source, asset, cache)[0]['answer'], 'evaluator-only')
            path.write_bytes(b'changed')
            with patch('urllib.request.urlopen') as network:
                with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                    sources.cache_source(source, cache)
                network.assert_not_called()
            self.assertEqual(path.read_bytes(), b'changed')

    def test_verified_download_and_idempotent_cache(self):
        from io import BytesIO
        source, asset, body = self.fixture()
        with tempfile.TemporaryDirectory() as cache:
            with patch('urllib.request.urlopen', return_value=BytesIO(body)) as network:
                sources.cache_source(source, cache)
                sources.cache_source(source, cache)
                network.assert_called_once()
            self.assertEqual(sources.checked_bytes(source, asset, cache), body)

    def test_bad_download_is_never_published(self):
        from io import BytesIO
        source, asset, _ = self.fixture()
        with tempfile.TemporaryDirectory() as cache:
            with patch('urllib.request.urlopen', return_value=BytesIO(b'wrong')):
                with self.assertRaises(ValueError):
                    sources.cache_source(source, cache)
            self.assertFalse(sources.original_path(source, asset, cache).exists())

    def test_cache_path_cannot_escape(self):
        source, asset, _ = self.fixture()
        asset['path'] = '../../../../outside.json'
        with tempfile.TemporaryDirectory() as cache:
            with self.assertRaisesRegex(ValueError, 'escapes'):
                sources.original_path(source, asset, cache)


if __name__ == '__main__':
    unittest.main()
