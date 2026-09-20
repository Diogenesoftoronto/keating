"""Synthetic arithmetic tests plus a read-only check of the actual saved response."""
import copy
import math
import unittest
from unittest.mock import patch

import probe_spans as p
from observer_core import boundary_view, digest
from native_training import seal


class SpanTests(unittest.TestCase):
    def setUp(self):
        # Only the full Qwen model-manifest schema is replaced for this tiny fixture.
        # All source, token, pooling, card and arithmetic checks run unchanged.
        self.manifest_check = patch.object(p, 'validate_manifest')
        self.manifest_check.start()
        self.addCleanup(self.manifest_check.stop)
        record = {'record_id': 'fixture', 'family_id': 'synthetic', 'boundary': 'delivered',
                  'latest_allowed_event_id': 'a', 'events': [{'event_id': 'a', 'kind': 'actor_message',
                  'phase': 'delivered', 'visibility': 'public', 'text': '<script>&'}],
                  'spans': [{'event_id': 'a', 'start': 0, 'end': 9}]}
        self.projection = {'schema_version': 1, 'records': [record]}
        view = boundary_view(record)
        start = view['spans'][0]['start']
        manifest = {'dimensions': {'width': 3, 'hidden': 2, 'top_k': 2}, 'max_tokens': 100,
                    'pooling': 'mean_of_unique_selected_tokens', 'layer': 12, 'module': 'language_model.layers.12'}
        row = {'record_id': 'fixture', 'family_id': 'synthetic', 'boundary': 'delivered',
               'record_sha256': digest(record), 'observer_manifest_sha256': digest(manifest),
               'text': view['text'], 'view': view, 'pooling': manifest['pooling'], 'sae_width': 3,
               'raw': [0, 0], 'input_token_ids': [20, 21], 'selected_token_indices': [0, 1],
               'sparse_tokens': [{'token_index': 0, 'character_offsets': [start, start+8], 'indices': [0, 1], 'values': [-2, 4]},
                                 {'token_index': 1, 'character_offsets': [start+8, start+9], 'indices': [0, 1], 'values': [2, 0]}],
               'sae': {'0': 0, '1': 2}}
        self.artifact = {'manifest': manifest, 'manifest_sha256': digest(manifest), 'input_sha256': digest(self.projection), 'rows': [row]}
        model = {'preprocessing': {'scale': [2, 4, 1], 'mean': None}, 'coefficients': [3, -2, 0],
                 'intercept': 1, 'classes': [0, 1], 'calibration_coefficient': 2, 'calibration_intercept': -.25}
        card = {'observer_manifest_sha256': digest(manifest), 'target': 'fixture', 'boundary': 'delivered',
                **{k: manifest[k] for k in ('layer', 'module', 'pooling')}}
        self.report = {'target': 'fixture', 'boundary': 'delivered', 'observer_manifest': manifest,
                       'baselines': {'sae': {'model': model, 'feature_card': card}}}
        self.repin()

    def repin(self):
        b = self.report['baselines']['sae']
        self.card = seal({'probe': {'mode': 'sae', 'report_sha256': digest(self.report), 'model_sha256': digest(b['model']),
                                   'feature_card_sha256': digest(b['feature_card']),
                                   'observer_manifest_sha256': digest(self.report['observer_manifest'])}}, 'card_hash')

    def inspect(self):
        return p.inspect(self.artifact, self.report, self.card, self.projection, self.card['card_hash'])

    def test_conservation_signed_values_and_single_pooled_probability(self):
        result = self.inspect()
        self.assertEqual([t['contribution'] for t in result['tokens']], [-5, 3])
        self.assertEqual(result['bias'], 1.75)
        self.assertEqual(result['pooled_logit'], -.25)
        self.assertEqual(result['conservation_error'], 0)
        self.assertAlmostEqual(result['pooled_probability'], 1 / (1 + math.exp(.25)))
        self.assertTrue(all('probability' not in t for t in result['tokens']))

    def test_forged_pooled_vector_rejected_even_on_unused_coordinate(self):
        for changed in ({'0': 1, '1': 2}, {'0': 0, '1': 2, '2': 9}):
            self.artifact['rows'][0]['sae'] = changed
            with self.assertRaisesRegex(ValueError, 'Pooled sparse'): self.inspect()

    def test_missing_or_wrong_offsets_are_not_approximated(self):
        token = self.artifact['rows'][0]['sparse_tokens'][0]
        original = copy.deepcopy(token)
        for offsets in (None, [0, 1], [-1, 3], [True, 2]):
            token.clear()
            token.update(original)
            if offsets is None: token.pop('character_offsets')
            else: token['character_offsets'] = offsets
            with self.subTest(offsets=offsets), self.assertRaises(ValueError): self.inspect()

    def test_duplicate_indices_and_coordinate_corruption_rejected(self):
        row = self.artifact['rows'][0]
        row['selected_token_indices'] = [0, 0]
        with self.assertRaisesRegex(ValueError, 'indices'): self.inspect()
        row['selected_token_indices'] = [0, 1]
        row['sparse_tokens'][0]['indices'] = [0, 0]
        with self.assertRaisesRegex(ValueError, 'coordinate'): self.inspect()

    def test_changed_source_text_hash_and_card_are_rejected(self):
        self.artifact['rows'][0]['text'] += 'forged'
        with self.assertRaisesRegex(ValueError, 'text'): self.inspect()
        self.artifact['rows'][0]['text'] = self.artifact['rows'][0]['view']['text']
        self.projection['records'][0]['events'][0]['text'] = 'new source'
        with self.assertRaisesRegex(ValueError, 'projection hash'): self.inspect()
        self.card['probe']['model_sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'Card hash'): self.inspect()

    def test_probe_and_observer_compatibility_cannot_be_waived(self):
        self.report['baselines']['sae']['model']['coefficients'][0] = 4
        with self.assertRaisesRegex(ValueError, 'Probe/card hash'): self.inspect()
        self.repin()
        self.artifact['manifest'] = {**self.artifact['manifest'], 'layer_selection_implementation_sha256': 'unapproved'}
        with self.assertRaisesRegex(ValueError, 'Exporter revision'): self.inspect()
        self.artifact['manifest'] = {**self.report['observer_manifest'], 'sae_sha256': 'different-basis'}
        with self.assertRaisesRegex(ValueError, 'Observer basis'): self.inspect()

    def test_centering_invalid_scale_and_nonfinite_coefficients_rejected(self):
        model = self.report['baselines']['sae']['model']
        for key, bad in [('mean', [0, 0, 0]), ('scale', [2, 0, 1])]:
            original = model['preprocessing'][key]
            model['preprocessing'][key] = bad
            self.repin()
            with self.assertRaises(ValueError): self.inspect()
            model['preprocessing'][key] = original
        model['coefficients'][0] = float('inf')
        with self.assertRaises(ValueError): self.repin()

    def test_html_escapes_source_and_metadata_and_includes_numeric_alternative(self):
        result = self.inspect()
        result['record_id'] = '<img src=x onerror=alert(1)>'
        rendered = p.render(result)
        self.assertNotIn('<script>', rendered)
        self.assertNotIn('<img ', rendered)
        self.assertIn('&lt;script&gt;', rendered)
        self.assertIn('&lt;img ', rendered)
        self.assertIn('-5.00000000', rendered)
        self.assertIn('not token probabilities or causal localization', rendered)


@unittest.skipUnless((p.MEASURED / 'features.local.json').exists(), 'Optional saved measurement not present')
class SavedMeasurementTests(unittest.TestCase):
    def test_actual_saved_prediction_and_exact_source_view(self):
        load = lambda path: p.read_json(p.read_file(path))
        artifact = load(p.MEASURED / 'features.local.json')
        report = load(p.ROOT / '.keating/native-learning/premature-answer-execution-v1/probe-report.json')
        card, plan = load(p.HANDOFF / 'reward-card.json'), load(p.HANDOFF / 'measurement-plan.json')
        audit = load(p.MEASURED / 'reward-audit.json')
        result = p.inspect(artifact, report, card, plan['projection'], audit['card_hash'])
        prediction = next(a['probability'] for a in audit['actions'] if a['record_id'] == result['record_id'])
        self.assertAlmostEqual(result['pooled_probability'], prediction, places=14)
        self.assertLessEqual(abs(result['conservation_error']), 1e-12)
        self.assertEqual(result['selected_tokens'], len(artifact['rows'][0]['selected_token_indices']))


if __name__ == '__main__':
    unittest.main()
