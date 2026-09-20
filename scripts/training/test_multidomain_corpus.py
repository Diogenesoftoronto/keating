"""Admission, visibility, supervision and interrupted-generation invariants."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import agy_multidomain as queue
import multidomain_corpus as data
import agy_contextual_data as legacy_queue


def fixture():
    source_text = 'An argument offers reasons in support of a conclusion.'
    packet = {'version': data.VERSION, 'batch_id': 'philosophy-00', 'domain': 'philosophy',
        'source': {'id': 'arguments', 'text': source_text, 'text_sha256': hashlib.sha256(source_text.encode()).hexdigest(),
                   'url': 'https://example.org/fixture', 'license': 'authored-test-fixture', 'attribution': 'authored test', 'usage_lane': 'fixture'},
        'families': [{'id': 'md-philosophy-00-f01', 'profile_ids': ['md-philosophy-00-f01-p1', 'md-philosophy-00-f01-p2']}]}
    example = {'slot': 1, 'prefix': [{'role': 'assistant', 'content': 'Earlier mistaken assistance.'},
                                  {'role': 'user', 'content': 'The reason is the claim about the sample.'}],
        'response': 'That identifies the premise. What does it support?', 'fit': 'appropriate', 'need': 'diagnosis',
        'substantive': True, 'correct': True, 'grade': 2, 'rationale': 'Test example only.',
        'spans': [{'text': 'That identifies the premise.', 'move': 'feedback', 'fit': 'appropriate', 'correct': True, 'reason': 'Acknowledges identification.'},
                  {'text': 'What does it support?', 'move': 'question', 'fit': 'appropriate', 'correct': True, 'reason': 'Asks for the conclusion.'}]}
    examples = []
    for slot in range(1, 11):
        row = deepcopy(example); row['slot'] = slot
        if slot == 1: row.update(substantive=False, grade=1, need='space')
        if slot == 2: row['need'] = 'explanation'
        if slot in (3, 4): row.update(fit='overhelp' if slot == 3 else 'underhelp', grade=0)
        examples.append(row)
    family = {'id': packet['families'][0]['id'], 'status': 'ready', 'reason': 'Authored plumbing fixture.',
        'task': {'title': 'Find the premise', 'material': 'All members of set A are B. This item belongs to A.',
                 'questions': [{'id': 'conclusion', 'kind': 'choice', 'prompt': 'Which conclusion follows?',
                                'choices': [{'id': 'a', 'label': 'This item is B.'}, {'id': 'b', 'label': 'Every B is A.'}]},
                               {'id': 'reason', 'kind': 'text', 'prompt': 'Explain the inference.'}]},
        'grounding': [{'claim': 'Reasons and conclusions have different roles.', 'quote': source_text}],
        'strategy': ['Inspect the argument structure.'],
        'assessment': {'criteria': ['PRIVATE_RUBRIC_SENTINEL'], 'acceptable_answers': ['PRIVATE_ANSWER_SENTINEL'], 'pitfalls': ['Converse error.']},
        'profiles': [{'id': identity, 'goal': 'Recognize conclusions.',
                      'prior_evidence': [{'text': 'I can identify a reason.', 'visibility': 'actor'}, {'text': 'PRIVATE_PROFILE_SENTINEL', 'visibility': 'learner'}],
                      'assumptions': ['Authored tendency to ask one clarification.'], 'opening': 'I think the order matters.', 'examples': deepcopy(examples)}
                     for identity in packet['families'][0]['profile_ids']]}
    draft = {'version': data.VERSION, 'batch_id': packet['batch_id'], 'families': [family]}
    review = {'version': data.VERSION, 'model': data.MODEL, 'batch_id': packet['batch_id'],
              'draft_sha256': data.digest(draft), 'source_sha256': packet['source']['text_sha256'],
              'families': [{'id': family['id'], 'approved': True, 'reason': 'Authored structural fixture, not model-reviewed evidence.',
                            'checks': {key: True for key in 'grounded domain_correct pedagogy natural_learner profiles public_private openui localization'.split()},
                            'examples': [{'id': f"{p['id']}-c{e['slot']:02}", 'approved': True, 'reason': 'Fixture'} for p in family['profiles'] for e in p['examples']]}]}
    return packet, draft, review


def prepare_fixture(directory, split='train'):
    packet, draft, review = fixture(); family = draft['families'][0]
    batch = packet['batch_id']
    manifest = {'version': data.VERSION, 'batches': {batch: data.digest(packet)}, 'protected_pins': {},
                'target': {'contrasts': 20}, 'families': {family['id']: {'split': split,
                'source_group': 'arguments', 'profile_ids': packet['families'][0]['profile_ids']}}}
    manifest['manifest_sha256'] = data.digest(manifest)
    data.write(directory / 'manifest.json', manifest)
    data.write(directory / f'{batch}.input.json', packet)
    return packet, draft, review


class MultidomainTests(unittest.TestCase):
    def test_changed_grounding_is_rejected(self):
        packet, draft, _ = fixture()
        data.validate_multidomain_draft(draft, packet)
        draft['families'][0]['grounding'][0]['quote'] = 'Invented citation'
        with self.assertRaisesRegex(ValueError, 'Invented source'):
            data.validate_multidomain_draft(draft, packet)

    def test_private_review_and_undisclosed_profile_never_enter_actor(self):
        packet, draft, _ = fixture(); family = draft['families'][0]
        scenario = data.native_scenario(family, family['profiles'][0], packet, {'source_group': 'arguments', 'split': 'test'})
        actor_input = json.dumps([scenario['actor'], scenario['initial_document']])
        learner_input = json.dumps(scenario['learner'])
        self.assertNotIn('PRIVATE_', actor_input)
        self.assertIn('PRIVATE_PROFILE_SENTINEL', learner_input)
        self.assertNotIn('PRIVATE_ANSWER_SENTINEL', learner_input)
        self.assertNotIn('PRIVATE_RUBRIC_SENTINEL', learner_input)

    def test_native_choice_and_text_validate_with_production_contract(self):
        _, draft, _ = fixture()
        document = data.question_document(draft['families'][0]['task'], 'fixture-activity')
        result = data.validate_native_documents([document])
        self.assertEqual(result['documents'], 1)
        self.assertFalse(result['runtimeExecuted'])
        document['nodes'][0]['answer_key'] = 'a'
        with self.assertRaisesRegex(ValueError, 'Production OpenUI'):
            data.validate_native_documents([document])

    def test_hidden_answer_field_fails_even_if_empty(self):
        _, draft, _ = fixture(); task = draft['families'][0]['task']
        task['questions'][0]['answer_key'] = ''
        with self.assertRaisesRegex(ValueError, 'Unexpected fields'):
            data.question_document(task, 'fixture')

    def test_review_binds_exact_draft_and_all_checks(self):
        packet, draft, review = fixture()
        data.validate_multidomain_review(review, draft, packet)
        review['families'][0]['checks']['domain_correct'] = False
        with self.assertRaisesRegex(ValueError, 'Approved despite failure'):
            data.validate_multidomain_review(review, draft, packet)
        review['families'][0]['checks']['domain_correct'] = True
        draft['families'][0]['profiles'][0]['opening'] = 'Changed after review'
        with self.assertRaisesRegex(ValueError, 'Review binding'):
            data.validate_multidomain_review(review, draft, packet)

    def test_restraint_is_positive_and_previous_assistant_turn_is_masked(self):
        packet, draft, _ = fixture(); profile = draft['families'][0]['profiles'][0]
        row = {'id': 'example', 'family': 'family', 'split': 'train', 'review': {'hash': 'fixture'}, 'example': profile['examples'][0]}
        source = {'source': packet['source'], 'opening_message': profile['opening']}
        candidate = data.contextual.sft_candidate(row, source)
        self.assertEqual(candidate['supervision']['message_weights'], [0, 0, 0, 1])
        self.assertEqual(candidate['teaching']['grade'], 1)
        row['split'] = 'test'
        self.assertIsNone(data.contextual.sft_candidate(row, source))

    def test_failed_receipt_does_not_make_output_eligible(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); packet, _, _ = prepare_fixture(directory); batch = packet['batch_id']
            data.write(directory / f'{batch}.draft.001.receipt.json', {'exit_code': 1, 'validated': True, 'output_digest': 'hash'})
            with self.assertRaisesRegex(ValueError, 'Missing successful'):
                data.accepted_receipt(tmp, batch, 'draft', 'hash')

    def test_compile_preserves_test_split_and_masks_private_annotations(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); packet, draft, review = prepare_fixture(directory, split='test'); batch = packet['batch_id']
            for phase, value in [('draft', draft), ('review', review)]:
                data.write(directory / f'{batch}.{phase}.json', value)
                # Authored fixture receipts, confined to this temporary test directory.
                data.write(directory / f'{batch}.{phase}.fixture.receipt.json', {
                    'exit_code': 0, 'validated': True, 'model': data.MODEL,
                    'input_digest': data.digest(packet), 'output_digest': data.digest(value)})
            output = directory / 'compiled'
            report = data.compile_multidomain(directory, output)
            self.assertEqual(report['sft_candidates'], 0)
            self.assertEqual(len(data.read(output / 'benchmark-scenarios.json')), 2)
            records = data.read(output / 'observer-records.json')['records']
            for record in records:
                view = data.contextual.observer.boundary_view(record)
                self.assertNotIn('PRIVATE_', json.dumps(view))
                self.assertNotIn('annotation_spans', view)
                self.assertEqual(record['group_ids'], ['arguments'])
            delivered = next(r for r in records if r['boundary'] == 'delivered')
            self.assertIn('fit', delivered['annotation_spans'][0])

    def test_quota_interrupted_output_is_archived_and_not_resumable(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); packet, draft, _ = prepare_fixture(directory); batch = packet['batch_id']
            class FailedProcess:
                def __init__(self, *args, **kwargs):
                    data.write(directory / f'{batch}.draft.json', draft)
                    kwargs['stdout'].write('Individual quota reached. Resets in 1m.')
                def wait(self, **kwargs): return 1
            with patch.object(queue.subprocess, 'Popen', FailedProcess):
                result = queue.execute_job(directory, batch, 'draft')
            self.assertEqual(result['status'], 'quota')
            self.assertFalse((directory / f'{batch}.draft.json').exists())
            self.assertEqual(len(list(directory.glob('*.unaccepted.json'))), 1)
            with self.assertRaisesRegex(ValueError, 'Missing successful'):
                data.accepted_receipt(directory, batch, 'draft', data.digest(draft))

    def test_quota_uses_reset_and_never_assumes_unknown_reset(self):
        self.assertEqual(queue.quota_delay('Individual quota reached. Resets in 1h51m10s.'), 6700)
        self.assertEqual(queue.quota_delay('Individual quota reached.'), -1)
        self.assertIsNone(queue.quota_delay('Completed successfully'))

    def test_legacy_revision_runner_requires_completion_receipt_on_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); packet = {'sources': []}
            data.write(directory / 'manifest.json', {'batch_hashes': {'batch.input.json': legacy_queue.data.native.digest(packet)}})
            data.write(directory / 'batch.input.json', packet)
            data.write(directory / 'batch.draft.json', [])
            with self.assertRaisesRegex(ValueError, 'no matching successful agy receipt'):
                legacy_queue.run_batch(directory, 'batch', 'draft', 1)

    def test_approved_spans_keep_their_own_labels(self):
        packet, draft, _ = fixture(); row = draft['families'][0]['profiles'][0]['examples'][0]
        row['spans'][1]['fit'] = 'overhelp'
        # A useful first clause does not force another span to be appropriate.
        data.validate_contrast(row)
        self.assertNotEqual(row['spans'][0]['fit'], row['spans'][1]['fit'])


if __name__ == '__main__':
    unittest.main()
