# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.8.0+cpu", "transformers==5.3.0", "numpy==2.2.6"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Authored local fixtures; no published model, provider or behavioral validation."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import observer_core as core
import observer_experiment as exp


def bundle(layers=(3,), seeds=(7,)):
    records = []
    for split in ('train', 'calibration', 'test'):
        records.append({'record_id': split, 'family_id': 'family-' + split,
            'group_ids': ['person-' + split], 'split': split, 'boundary': 'delivered',
            'latest_allowed_event_id': 'answer', 'labels': {'concept': 1},
            'events': [{'event_id': 'question', 'phase': 'pre_action', 'kind': 'learner_message',
                        'visibility': 'public', 'text': 'Hint please.'},
                       {'event_id': 'private', 'phase': 'pre_action', 'kind': 'assessment',
                        'visibility': 'private', 'text': 'SECRET_LABEL'},
                       {'event_id': 'answer', 'phase': 'delivered', 'kind': 'actor_message',
                        'visibility': 'public', 'text': 'ab cd'},
                       {'event_id': 'future', 'phase': 'retrospective', 'kind': 'learner_message',
                        'visibility': 'public', 'text': 'SECRET_FUTURE'}],
            'spans': [{'event_id': 'answer', 'start': 0, 'end': 2}, {'event_id': 'answer', 'start': 3, 'end': 5}]})
    observer = {'model': exp.extract.MODEL, 'model_revision': 'a' * 40,
        'tokenizer_revision': 'a' * 40, 'sae_model': exp.extract.DICTIONARY, 'sae_revision': 'b' * 40,
        'dtype': 'float32', 'device': 'cpu', 'max_tokens': 512,
        'layers': [{'layer': n, 'module': f'language_model.layers.{n}', 'sae_sha256': 'c' * 64,
                    'feature': 0, 'unrelated_feature': 1} for n in layers]}
    config = {'schema_version': 1, 'mode': 'intervention', 'observer': observer, 'poolings': list(exp.POOLINGS),
              'epsilons': [-.05, 0, .05], 'seeds': list(seeds), 'calibration_seed': 13,
              'calibration_record_ids': ['calibration'], 'evaluation_record_ids': ['train', 'test']}
    source_hash = 'd' * 64
    splits = {'schema_version': 1, 'source_manifest_sha256': source_hash,
              'families': {r['family_id']: {'split': r['split'], 'group_ids': r['group_ids']} for r in records}}
    binding = {k: observer[k] for k in ('model', 'model_revision', 'tokenizer_revision', 'sae_model', 'sae_revision')}
    binding['layer_sha256'] = {str(n): 'c' * 64 for n in layers}
    card = {'schema_version': 1, 'target': 'authored-concept', 'definition': 'An authored mechanism fixture.',
            'boundary': 'delivered', 'observer_binding': binding,
            'source_review': {'status': 'approved', 'reviewer': 'AUTHORED TEST REVIEWER', 'review_id': 'fixture-review',
                              'evidence_sha256': 'e' * 64, 'source_manifest_sha256': source_hash},
            'feature_reviews': {str(n): {'feature': 0, 'unrelated_feature': 1,
                'evidence_sha256': 'f' * 64, 'selection_split': 'train',
                'unrelated_rationale': 'Orthogonal authored fixture axis; not a pedagogical claim.'} for n in layers}}
    return config, records, card, splits


class DeclarationTests(unittest.TestCase):
    def test_prepare_is_pure_repeatable_and_strips_private_future_fields(self):
        args = bundle(layers=(3, 9), seeds=(7, 8))
        original = deepcopy(args)
        with patch.object(exp.extract, 'load_observer', side_effect=AssertionError('no weights')):
            first = exp.prepare(*args)
            second = exp.prepare(*args)
        self.assertEqual(first, second)
        self.assertEqual(args, original)
        self.assertEqual(first['trial_count'], 72)
        self.assertNotIn('SECRET', json.dumps(first))
        self.assertNotIn('labels', first['records'][0])
        self.assertEqual(first['source_record_sha256']['train'], core.digest(args[1][0]))
        self.assertEqual(core.boundary_view(first['records'][0]), core.boundary_view(args[1][0]))
        for trial in first['trials']:
            self.assertEqual(trial['poolings'], list(exp.POOLINGS))
        self.assertTrue(all(v is None for v in first['claims'].values()))

    def test_import_and_prepare_do_not_import_torch(self):
        script = ('import sys; sys.path.insert(0, "scripts/training"); '
                  'import observer_experiment; from test_observer_experiment import bundle; '
                  'observer_experiment.prepare(*bundle()); assert "torch" not in sys.modules')
        result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_bad_pins_controls_review_and_seed_settings_reject(self):
        changes = [lambda c, r, card, s: c['observer'].update(model_revision='main'),
            lambda c, r, card, s: c['observer']['layers'][0].update(module='arbitrary.code'),
            lambda c, r, card, s: c['observer'].update(allow_download=True),
            lambda c, r, card, s: c.update(seeds=[True]),
            lambda c, r, card, s: c.update(epsilons=[0, .1, .2]),
            lambda c, r, card, s: c.update(poolings=['entire_transcript_mean']),
            lambda c, r, card, s: card['source_review'].update(status='pending'),
            lambda c, r, card, s: card['source_review'].update(source_manifest_sha256='0' * 64),
            lambda c, r, card, s: card['observer_binding'].update(sae_revision='0' * 40),
            lambda c, r, card, s: card['feature_reviews']['3'].update(selection_split='test'),
            lambda c, r, card, s: c['observer']['layers'][0].update(unrelated_feature=0)]
        for change in changes:
            args = bundle(); change(*args)
            with self.assertRaises(ValueError): exp.prepare(*args)

    def test_full_source_group_split_and_calibration_membership_are_fixed(self):
        args = bundle()
        args[3]['families']['unselected-relative'] = {'split': 'test', 'group_ids': ['person-calibration']}
        with self.assertRaisesRegex(ValueError, 'cross partitions'): exp.prepare(*args)
        args = bundle(); args[0]['calibration_record_ids'] = ['test']; args[0]['evaluation_record_ids'] = ['train', 'calibration']
        with self.assertRaisesRegex(ValueError, 'calibration records only'): exp.prepare(*args)
        args = bundle(); args[1][0]['group_ids'] = []
        with self.assertRaisesRegex(ValueError, 'family split'): exp.prepare(*args)

    def test_temporal_and_span_violations_fail_before_runtime(self):
        args = bundle(); args[1][0]['spans'][0]['event_id'] = 'future'
        with self.assertRaisesRegex(ValueError, 'future'): exp.prepare(*args)
        args = bundle(); args[1][0]['events'][2]['kind'] = 'delivered_artifact'
        with self.assertRaisesRegex(ValueError, 'receipt'): exp.prepare(*args)

    def test_tampered_plan_matrix_never_loads(self):
        plan = exp.prepare(*bundle()); plan['trials'][0]['epsilon'] = .9
        with patch.object(exp.extract, 'load_observer', side_effect=AssertionError('must not load')):
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): exp.execute(plan)
            unsigned = deepcopy(plan); unsigned.pop('plan_sha256'); plan['plan_sha256'] = core.digest(unsigned)
            with self.assertRaisesRegex(ValueError, 'matrix mismatch'): exp.execute(plan)

    def test_cli_prepare_private_output_and_existing_path_guard(self):
        root = Path(__file__).resolve().parents[2] / '.keating/outputs'
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as directory:
            p = Path(directory); source = p / 'declaration.json'; output = p / 'plan.json'
            source.write_text(json.dumps(dict(zip(('config', 'records', 'concept_card', 'split_manifest'), bundle()))))
            exp.main(['prepare', str(source), str(output)])
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with patch.object(exp, 'execute', side_effect=AssertionError('must not execute')):
                with self.assertRaises(FileExistsError): exp.main(['execute', str(output), str(output)])
        with self.assertRaises(ValueError): exp.output_path('docs/should-not-exist.json')


@unittest.skipUnless(importlib.util.find_spec('torch'), 'Use this test file PEP-723 CPU environment')
class ExecutionTests(unittest.TestCase):
    def setUp(self):
        import torch
        self.torch = torch
        self.spec = core.SAESpec(hidden=4, width=8, top_k=2)
        self.state = {'W_enc': torch.arange(32).reshape(8, 4).float() / 32,
                      'b_enc': torch.zeros(8), 'W_dec': torch.cat([torch.eye(4), torch.eye(4)], dim=1),
                      'b_dec': torch.zeros(4)}
        self.loaded = []

    def model(self, tuple_output=False, fail=False, repeat=False):
        torch = self.torch
        class Block(torch.nn.Module):
            def __init__(self):
                super().__init__(); self.marker = object()
            def forward(self, x):
                return (x * 2, self.marker) if tuple_output else x * 2
        class Model(torch.nn.Module):
            def __init__(self):
                super().__init__(); self.emb = torch.nn.Embedding(256, 4); self.block = Block()
                with torch.no_grad(): self.emb.weight.fill_(1)
            def forward(self, input_ids, attention_mask, use_cache):
                assert use_cache is False
                out = self.block(self.emb(input_ids))
                if repeat: self.block(self.emb(input_ids))
                if fail: raise RuntimeError('deliberate model failure')
                if tuple_output:
                    assert out[1] is self.block.marker
                    out = out[0]
                return {'last_hidden_state': out * 3}
        return Model()

    def loader(self, args):
        torch = self.torch
        class Tokenizer:
            def __call__(self, text, **kwargs):
                assert kwargs['truncation'] is False and kwargs['add_special_tokens'] is False
                return {'input_ids': torch.tensor([[ord(c) for c in text]]),
                        'attention_mask': torch.ones(1, len(text), dtype=torch.long),
                        'offset_mapping': torch.tensor([[(i, i + 1) for i in range(len(text))]])}
        self.assertFalse(args.allow_download)
        model = self.model(tuple_output=True)
        model.train(); model.emb.eval()
        manifest = {'evidence': 'authored_toy_not_qwen', 'observer_model': exp.extract.MODEL,
            'observer_revision': args.model_revision, 'tokenizer_revision': args.tokenizer_revision,
            'sae_model': exp.extract.DICTIONARY, 'sae_revision': args.sae_revision, 'sae_sha256': args.sae_sha256,
            'layer': args.layer, 'module': args.module, 'hook': 'residual_post_block',
            'dtype': args.dtype, 'device': args.device, 'dimensions': {'hidden': 4, 'width': 8, 'top_k': 2}}
        self.loaded.append(model)
        return model, Tokenizer(), model.block, self.state, manifest

    def test_actual_tensor_and_tuple_patch_preserves_batch_and_rng(self):
        torch = self.torch
        for as_tuple in (False, True):
            model = self.model(tuple_output=as_tuple); model.train(); model.emb.eval()
            batch = {'input_ids': torch.tensor([[1, 2, 3], [4, 5, 6]]), 'attention_mask': torch.ones(2, 3, dtype=torch.long)}
            mask = torch.tensor([[True, False, False], [False, True, False]])
            rng = torch.random.get_rng_state().clone()
            before, after, downstream = exp.forward_intervention(model, model.block, batch, torch.tensor([3., 0., 0., 0.]),
                epsilon=-.05, scale=4, token_mask=mask, seed=7)
            self.assertEqual(tuple(after.shape), (2, 3, 4))
            expected = before.clone(); expected[mask] += torch.tensor([-.2, 0, 0, 0])
            torch.testing.assert_close(after, expected)
            self.assertEqual(downstream, exp.tensor_hash(after * 3))
            torch.testing.assert_close(torch.random.get_rng_state(), rng)
            self.assertTrue(model.training); self.assertFalse(model.emb.training)
            self.assertFalse(model.block._forward_hooks)

    def test_failure_repeated_call_and_bad_mask_cleanup(self):
        torch = self.torch
        for failure, repeat in ((True, False), (False, True)):
            model = self.model(fail=failure, repeat=repeat)
            batch = {'input_ids': torch.tensor([[1, 2]]), 'attention_mask': torch.ones(1, 2, dtype=torch.long)}
            with self.assertRaises((RuntimeError, ValueError)):
                exp.forward_intervention(model, model.block, batch, torch.ones(4), epsilon=.1, scale=1,
                                         token_mask=torch.ones(1, 2, dtype=torch.bool), seed=2)
            self.assertFalse(model.block._forward_hooks); self.assertTrue(model.training)
        model = self.model()
        batch['attention_mask'][0, 1] = 0
        with self.assertRaisesRegex(ValueError, 'padding'):
            exp.forward_intervention(model, model.block, batch, torch.ones(4), epsilon=.1, scale=1,
                                     token_mask=torch.ones(1, 2, dtype=torch.bool), seed=2)
        self.assertFalse(model.block._forward_hooks)
        batch['attention_mask'].fill_(1)
        with self.assertRaisesRegex(ValueError, 'width'):
            exp.forward_intervention(model, model.block, batch, torch.ones(5), epsilon=.1, scale=1,
                                     token_mask=torch.ones(1, 2, dtype=torch.bool), seed=2)
        self.assertFalse(model.block._forward_hooks)

    def test_end_to_end_matrix_calibration_controls_and_unknown_outcomes(self):
        plan = exp.prepare(*bundle(layers=(3, 9)))
        with patch('socket.create_connection', side_effect=AssertionError('network forbidden')):
            result = exp.execute(plan, loader=self.loader, spec=self.spec)
        self.assertEqual(result['completed_trials'], 36)
        self.assertEqual(result['evidence'], 'injected_local_runtime_not_published_model')
        self.assertEqual([m['layer'] for m in result['observer_manifests']], [3, 9])
        for cal in result['calibrations']:
            self.assertEqual(cal['scale'], 4.)
            self.assertEqual(cal['seed'], 13)
            self.assertEqual([r['record_id'] for r in cal['records']], ['calibration'])
        for row in result['rows']:
            self.assertEqual(row['settings']['seed'], row['seed'])
            self.assertEqual(row['unselected_delta_norm_max'], 0)
            self.assertAlmostEqual(row['actual_selected_delta_norm']['mean'], row['requested_delta_norm'], places=6)
            self.assertEqual(len(row['measurements']), 4)
            self.assertEqual(row['independent_behavior_review']['status'], 'unknown')
            self.assertIsNone(row['causal_behavior_effect']); self.assertIsNone(row['readout_quality'])
            self.assertAlmostEqual(self.torch.tensor(row['direction']['unit_vector']).norm().item(), 1, places=6)
            self.assertNotIn('SECRET', json.dumps(row))
        chosen = [r for r in result['rows'] if r['record_id'] == 'test' and r['layer'] == 3]
        by_condition = {(r['control'], r['epsilon']): r for r in chosen}
        self.assertEqual(by_condition['feature', -.05]['residual_after'], by_condition['opposite', .05]['residual_after'])
        self.assertEqual(by_condition['baseline', 0]['residual_before'], by_condition['baseline', 0]['residual_after'])
        self.assertNotEqual(by_condition['feature', .05]['downstream_tensor'], by_condition['baseline', 0]['downstream_tensor'])
        for model in self.loaded:
            self.assertTrue(model.training); self.assertFalse(model.emb.training); self.assertFalse(model.block._forward_hooks)

    def test_repeated_execution_random_direction_and_measurements_are_identical(self):
        plan = exp.prepare(*bundle(seeds=(7, 8)))
        a = exp.execute(plan, loader=self.loader, spec=self.spec)
        b = exp.execute(plan, loader=self.loader, spec=self.spec)
        self.assertEqual(a, b)
        random = [r for r in a['rows'] if r['control'] == 'random' and r['record_id'] == 'train' and r['epsilon'] > 0]
        self.assertNotEqual(random[0]['direction']['sha256'], random[1]['direction']['sha256'])

    def test_pooling_selects_unique_last_and_each_span_not_full_context(self):
        torch = self.torch
        h = torch.arange(24).reshape(1, 6, 4).float()
        view = {'text': 'abcdef', 'spans': [{'start': 1, 'end': 3}, {'start': 2, 'end': 5}]}
        offsets = [[i, i+1] for i in range(6)]
        rows = exp.pool_measurements(h, [1, 2, 3, 4], offsets, view, [1]*6, self.state, self.spec, list(exp.POOLINGS))
        expected = [h[0, [1, 2, 3, 4]].mean(0), h[0, 4], h[0, [1, 2]].mean(0), h[0, [2, 3, 4]].mean(0)]
        for row, vector in zip(rows, expected): torch.testing.assert_close(torch.tensor(row['raw']), vector)

    def test_runtime_binding_and_overlong_inputs_fail_without_partial_result(self):
        plan = exp.prepare(*bundle())
        def wrong(args):
            runtime = self.loader(args); runtime[-1]['sae_sha256'] = '0' * 64
            return runtime
        with self.assertRaisesRegex(ValueError, 'Loaded observer'): exp.execute(plan, loader=wrong, spec=self.spec)
        args = bundle(); args[0]['observer']['max_tokens'] = 1
        with self.assertRaisesRegex(ValueError, 'untruncated'):
            exp.execute(exp.prepare(*args), loader=self.loader, spec=self.spec)
        for model in self.loaded: self.assertFalse(model.block._forward_hooks)

    def test_default_real_loader_is_local_only(self):
        plan = exp.prepare(*bundle())
        def cached_only(args):
            self.assertFalse(args.allow_download)
            self.assertEqual(args.module, 'language_model.layers.3')
            raise RuntimeError('No cached weights: do not download')
        with patch.object(exp.extract, 'load_observer', side_effect=cached_only) as load:
            with self.assertRaisesRegex(RuntimeError, 'No cached weights'): exp.execute(plan)
            self.assertEqual(load.call_count, 1)

    def test_readout_sweep_precedes_direction_selection_and_covers_all_splits(self):
        args = bundle(layers=(3, 9))
        args[0].update(mode='readout', epsilons=[0], calibration_record_ids=[],
                       evaluation_record_ids=['train', 'calibration', 'test'])
        args[0].pop('calibration_seed')
        args[2].pop('feature_reviews')
        for layer in args[0]['observer']['layers']:
            layer.pop('feature'); layer.pop('unrelated_feature')
        plan = exp.prepare(*args)
        result = exp.execute(plan, loader=self.loader, spec=self.spec)
        self.assertEqual(result['completed_trials'], 6)
        self.assertEqual(result['calibrations'], [])
        self.assertEqual({r['split'] for r in result['rows']}, set(exp.PARTITIONS))
        for row in result['rows']:
            self.assertIsNone(row['scale']); self.assertIsNone(row['direction'])
            self.assertIsNone(row['calibration_sha256'])
            self.assertEqual(row['residual_before'], row['residual_after'])
            self.assertEqual(len(row['measurements']), 4)
        args[0]['epsilons'] = [-.05, 0, .05]
        with self.assertRaisesRegex(ValueError, 'no nonzero interventions'): exp.prepare(*args)


if __name__ == '__main__':
    unittest.main()
