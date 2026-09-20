"""Generation source-package admission through the real offline bootstrap."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import observer_runpod as manager


class GenerationTransportTests(unittest.TestCase):
    def bundle(self, *, missing=None, extra=None):
        names = ('observer_core.py', 'observer_extract.py', 'observer_models.py', 'observer_experiment.py',
                 'observer_experiment_job.py', 'observer_generation.py', 'observer_generation_job.py')
        files = {'scripts/training/' + name: b'# authored package fixture\n' for name in names}
        files.update({'run.py': b'# no execution\n', 'input.json': b'{"dependency_profile":{}}',
                      'expected-preflight.json': b'{}'})
        if missing:
            files.pop(missing)
        if extra:
            files[extra] = b'not admitted'
        files['bundle.json'] = json.dumps({'files': {k: hashlib.sha256(v).hexdigest()
                                                    for k, v in files.items()}}).encode()
        return manager.archive_bytes(files)

    def install(self, body, directory):
        return subprocess.run([sys.executable, '-c', manager.bootstrap('generation'),
                               hashlib.sha256(body).hexdigest(), str(directory)],
                              input=body, capture_output=True, timeout=10)

    def test_exact_generation_package_and_idempotent_replay(self):
        body = self.bundle()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'job'
            for _ in range(2):
                result = self.install(body, root)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertTrue((root / 'scripts/training/observer_generation_job.py').is_file())

    def test_missing_helper_and_extra_file_rejected_before_unpacking(self):
        variants = [self.bundle(missing='scripts/training/observer_generation.py'),
                    self.bundle(missing='scripts/training/observer_models.py'),
                    self.bundle(extra='scripts/training/unreviewed.py'),
                    self.bundle(extra='../escape')]
        with tempfile.TemporaryDirectory() as temp:
            for i, body in enumerate(variants):
                root = Path(temp) / str(i)
                self.assertNotEqual(self.install(body, root).returncode, 0)
                self.assertFalse((root / 'bundle.sha256').exists())

    def test_generation_requires_overlay_and_its_distinct_entrypoint(self):
        with self.assertRaises(ValueError):
            manager.gpu_command('generation')
        command = manager.gpu_command('generation', overlay=True)
        self.assertEqual(command[-1], 'scripts/training/observer_generation_job.py')
        script = manager.remote_runner('generation', overlay=True).decode()
        ast.parse(script)
        self.assertIn('"scripts/training/observer_generation_job.py","bootstrap-overlay"', script)
        self.assertNotIn('"scripts/training/observer_experiment_job.py","bootstrap-overlay"', script)
        with self.assertRaises(ValueError):
            manager.gpu_command('arbitrary', overlay=True)


if __name__ == '__main__':
    unittest.main()
