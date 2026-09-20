"""Measurement export preserves signed features and pins instrumentation changes."""
from copy import deepcopy
import importlib.util
import unittest

import observer_core as core
import observer_experiment as experiment
import observer_experiment_job as worker
import native_feature_rewards_v2 as reward
from test_native_feature_rewards_v2 import fixture


class RewardExportTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec('torch'), 'torch is not installed')
    def test_sparse_tokens_reproduce_pooled_values_and_offsets(self):
        import torch
        spec = core.SAESpec(hidden=4, width=8, top_k=2)
        state = {'W_enc': torch.zeros(8, 4), 'b_enc': -torch.arange(1., 9.),
                 'W_dec': torch.ones(4, 8), 'b_dec': torch.zeros(4)}
        residual = torch.arange(12.).reshape(1, 3, 4)
        selected, offsets = [0, 2], [(0, 2), (2, 4), (4, 6)]
        sparse = worker.sparse_token_measurements(residual, selected, offsets, state, spec)
        pooled = experiment.pool_measurements(residual, selected, offsets, {}, [1, 1, 1],
            state, spec, ['mean_of_unique_selected_tokens'])[0]
        rebuilt = {}
        for token in sparse:
            self.assertEqual(token['character_offsets'], list(offsets[token['token_index']]))
            self.assertTrue(all(value < 0 for value in token['values']))
            for index, value in zip(token['indices'], token['values']):
                rebuilt[str(index)] = rebuilt.get(str(index), 0.) + value / len(selected)
        self.assertEqual([t['token_index'] for t in sparse], selected)
        self.assertEqual(rebuilt, pooled['sae'])

    def test_only_explicit_exporter_pin_can_change(self):
        _, kw = fixture()
        fitted = kw['probe_report']['observer_manifest']
        measured = deepcopy(fitted)
        measured['layer_selection_implementation_sha256'] = 'e' * 64
        with self.assertRaisesRegex(ValueError, 'exporter_not_approved'):
            reward.validate_measurement_basis(measured, fitted, kw['card'])
        kw['card']['measurement_layer_selection_sha256'] = 'e' * 64
        reward.validate_measurement_basis(measured, fitted, kw['card'])
        for field, value in [('sae_sha256', 'f' * 64), ('layer', 13), ('dtype', 'bfloat16')]:
            changed = {**measured, field: value}
            with self.assertRaises(ValueError):
                reward.validate_measurement_basis(changed, fitted, kw['card'])


if __name__ == '__main__':
    unittest.main()
