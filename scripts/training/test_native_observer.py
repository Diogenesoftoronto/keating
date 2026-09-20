import copy
import unittest

from native_observer import project_feature
from observer_core import boundary_view


class NativeObserverTests(unittest.TestCase):
    def feature(self, boundary):
        inputs = [{'event_id': 'initial', 'kind': 'learner_initial_message', 'payload': {'text': 'I added the denominators.'}}]
        if boundary != 'pre_action':
            inputs.append({'event_id': 'delivered', 'kind': 'delivered_observation', 'payload': {
                'visibleText': 'Are these pieces the same size?',
                'documents': [{'heading': 'Explain your next step', 'body': ['My notes', '']}]}})
        if boundary == 'retrospective':
            inputs += [{'event_id': 'reply', 'kind': 'learner_intent', 'payload': {
                'intent': {'kind': 'message', 'text': 'No, thirds and fourths differ.'}}},
                {'event_id': 'receipt', 'kind': 'learner_delivery_evidence', 'payload': {'status': 'delivered'}}]
        return {'episode_id': 'authored', 'branch_id': 'branch', 'event_id': 'step',
                'boundary': boundary, 'input_events': inputs, 'delivery_event_id': 'delivered',
                'latest_allowed_event_id': inputs[-1]['event_id'], 'latest_allowed_event_hash': 'a'*64,
                'feature_hash': 'b'*64, 'private_rubric': 'DO_NOT_EXPOSE'}

    def test_each_boundary_has_only_available_semantic_evidence(self):
        records = {b: project_feature(self.feature(b), 'family', 'authored')
                   for b in ('pre_action', 'delivered', 'retrospective')}
        texts = {b: boundary_view(r)['text'] for b, r in records.items()}
        self.assertNotIn('same size', texts['pre_action'])
        self.assertNotIn('thirds and fourths differ', texts['delivered'])
        self.assertIn('thirds and fourths differ', texts['retrospective'])
        for text in texts.values():
            self.assertNotIn('DO_NOT_EXPOSE', text)
            self.assertNotIn('"status"', text)
        self.assertEqual(records['retrospective']['native_latest_allowed_event_id'], 'receipt')

    def test_pool_only_the_requested_phase_and_link_artifact_receipt(self):
        record = project_feature(self.feature('delivered'), 'family', 'authored')
        artifacts = [e for e in record['events'] if e['kind'] == 'delivered_artifact']
        self.assertEqual(artifacts[0]['receipt_id'], 'delivered')
        selected = {s['event_id'] for s in record['spans']}
        self.assertNotIn('initial', selected)
        self.assertTrue(all(e['phase'] == 'delivered' for e in record['events'] if e['event_id'] in selected))

    def test_projection_is_detached_from_source(self):
        feature = self.feature('retrospective')
        before = copy.deepcopy(feature)
        record = project_feature(feature, 'family', 'authored')
        record['events'].clear()
        self.assertEqual(feature, before)

    def test_raw_runtime_or_private_events_are_not_a_supported_projection(self):
        feature = self.feature('pre_action')
        feature['input_events'].append({'event_id': 'private', 'kind': 'runtime_step', 'payload': {'answer': 'secret'}})
        with self.assertRaisesRegex(ValueError, 'Unsupported public native event'):
            project_feature(feature, 'family', 'authored')


if __name__ == '__main__':
    unittest.main()
