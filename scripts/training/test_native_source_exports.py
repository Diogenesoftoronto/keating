"""Authored ledger fixtures: source delivery is context, never a policy target."""
from copy import deepcopy
import unittest

import native_training as nt
import native_observer as no
from test_native_training import fixture_episode, reseal_episode


def source_episode():
    episode = fixture_episode()
    doc = {'id': 'authored-choice', 'revision': 0, 'lifecycle': 'ready', 'title': 'Compare',
           'nodes': [{'type': 'question', 'id': 'q', 'kind': 'choice', 'prompt': 'Which is larger?',
                      'choices': [{'id': 'a', 'label': '1/3'}, {'id': 'b', 'label': '1/4'}]}]}
    core = {'document': doc, 'opening_message': 'INITIAL_LEARNER', 'surface': 'interactive'}
    details = {'origin': 'environment', 'fingerprint': nt.native_hash(core), **core}
    custom = {'role': 'custom', 'customType': 'keating-benchmark-source-document-v1', 'display': True,
              'content': 'Learner opening:\nINITIAL_LEARNER\n\nSource activity:\nCompare\nWhich is larger?\n(a) 1/3\n(b) 1/4',
              'details': details}
    entry = {'type': 'custom_message', 'id': 'authored-entry', **{k: v for k, v in custom.items() if k != 'role'}}
    episode['runtime']['receipts'] = [{'kind': 'source_document_delivered', 'data': {'entry': entry}}]
    ledger = episode['ledger']
    step = next(e for e in ledger if e['kind'] == 'runtime_step')
    step['payload'].update(kind='source_document', messages=[custom])
    ledger[:] = [e for e in ledger if not (e['kind'] in {'actor_message', 'tool_call', 'tool_result'} and e['payload']['step'] == 0)]
    observed = next(e for e in ledger if e['kind'] == 'delivered_observation')
    observed['kind'] = 'source_observation'
    observed['payload'] = nt.seal({'schema_version': 1, 'step': 0, 'visibleText': custom['content'],
        'documents': [{'id': doc['id'], 'revision': 0, 'heading': 'Compare', 'body': ['Which is larger?', 'a: 1/3', 'b: 1/4']}],
        'availableActions': []}, 'observationHash')
    next(e for e in ledger if e['kind'] == 'learner_intent')['payload']['observation_hash'] = observed['payload']['observationHash']
    later = [e for e in ledger if e['kind'] == 'runtime_step'][1]
    later['payload']['messages'] = [deepcopy(custom), *later['payload']['messages'][-2:]]
    later['payload']['message_start_index'] = 1
    reseal_episode(episode)
    return episode


class SourceExportTests(unittest.TestCase):
    def test_only_actual_tutor_action_is_projected(self):
        episode = nt.validate_episode(source_episode())
        features = nt.feature_inputs(episode)
        self.assertEqual({f['event_id'] for f in features}, {episode.steps[1]['event_id']})
        self.assertEqual({f['boundary'] for f in features}, {'pre_action', 'delivered'})
        for record in no.project_episode(episode.value):
            source = [e for e in record['events'] if 'Which is larger?' in e['text']]
            self.assertTrue(source)
            self.assertTrue(all(e['kind'] == 'delivered_artifact' and e['phase'] == 'pre_action' and e['receipt_id'] for e in source))
            self.assertNotIn('GOLD_PRIVATE_FUTURE', str(record))

    def test_resigned_missing_or_changed_receipt_rejected(self):
        for change in ('missing', 'content', 'opening', 'origin', 'role'):
            with self.subTest(change=change):
                value = source_episode()
                if change == 'missing':
                    value['runtime']['receipts'] = []
                elif change == 'content':
                    value['runtime']['receipts'][0]['data']['entry']['content'] = 'invented'
                else:
                    step = next(e for e in value['ledger'] if e['kind'] == 'runtime_step')
                    message = step['payload']['messages'][0]
                    if change == 'opening': message['details']['opening_message'] = 'different learner'
                    if change == 'origin': message['details']['origin'] = 'actor'
                    if change == 'role': message['role'] = 'assistant'
                reseal_episode(value)
                with self.assertRaises(nt.ExportError): nt.validate_episode(value)

    def test_source_cannot_be_relabeled_as_actor_delivery(self):
        value = source_episode()
        next(e for e in value['ledger'] if e['kind'] == 'source_observation')['kind'] = 'delivered_observation'
        reseal_episode(value)
        with self.assertRaisesRegex(nt.ExportError, 'source_observation_role_mismatch'):
            nt.validate_episode(value)


if __name__ == '__main__':
    unittest.main()
