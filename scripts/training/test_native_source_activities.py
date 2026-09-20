"""Authored source screens; no copied educational records or provider calls."""
from copy import deepcopy
import unittest

import native_scenarios as native
import native_source_activities as activity
from test_native_scenarios import record, TM_UUID

STAMP = '2026-09-14T00:00:00.000Z'
SCREEN = '[PROBLEM_CHANGE: p1 (start)] The question is "Which is 3 + 4?". Options are A: 6, B: 7, C: 8.'


def fixture(text=SCREEN):
    row = {'provenance': {'conv_id': 'session_' + TM_UUID, 'cut_turn': 2},
           'context': [{'turn_number': 1, 'role': 'tutor', 'text': text},
                       {'turn_number': 2, 'role': 'student', 'text': 'Can I try again?'}],
           'student': {'reference': 'PRIVATE_FUTURE'}, 'answer_key': 'PRIVATE_KEY'}
    source = record('tutormoments', row, 'benchmark')
    scenario = native.make_scenario(source, ('tm-' + TM_UUID, ['tm-' + TM_UUID], 'original-conversation-id'),
                                    {'purpose': 'reference'})
    mapping = {'id': scenario['id'], 'source_sha256': source.sha256, 'status': 'ready',
               'reason': 'Authored complete textual choice screen.', 'source_indices': [0],
               'kind': 'choice', 'prompt_parts': ['Which is 3 + 4?'],
               'choices': [{'id': 'A', 'label': '6'}, {'id': 'B', 'label': '7'}, {'id': 'C', 'label': '8'}]}
    return scenario, mapping


class SourceActivityTests(unittest.TestCase):
    def test_preserves_question_choices_family_and_original_without_keys(self):
        scenario, mapping = fixture()
        adapted = activity.adapt_scenario(scenario, mapping, STAMP, 'authored-test-review')
        self.assertEqual(adapted['family'], scenario['family'])
        self.assertEqual(adapted['evaluation_only']['original'], scenario['evaluation_only']['original'])
        self.assertNotIn('initial_document', scenario)
        self.assertEqual(adapted['initial_document']['nodes'][0]['choices'], mapping['choices'])
        self.assertNotIn('PRIVATE', native.canonical(adapted['initial_document']))
        self.assertNotIn('correctAnswer', native.canonical(adapted['initial_document']))
        self.assertEqual(adapted['evaluation_only']['native_assessment']['outcome'], None)
        self.assertEqual(activity.adapt_scenario(scenario, mapping, STAMP, 'authored-test-review'), adapted)

    def test_rejects_modified_reordered_omitted_or_invented_choices(self):
        for change in ('modified', 'order', 'omitted', 'invented', 'key'):
            with self.subTest(change=change):
                scenario, mapping = fixture()
                if change == 'modified': mapping['choices'][0]['label'] = 'corrected 6'
                if change == 'order': mapping['choices'].reverse()
                if change == 'omitted': mapping['choices'].pop()
                if change == 'invented': mapping['prompt_parts'] = ['What is the capital of France?']
                if change == 'key': mapping['choices'][0]['correct'] = True
                with self.assertRaises(ValueError): activity.adapt_scenario(scenario, mapping, STAMP, 'review')

    def test_rejects_source_identity_future_or_wrong_task(self):
        for change in ('hash', 'future', 'task'):
            scenario, mapping = fixture()
            if change == 'hash': mapping['source_sha256'] = '0' * 64
            if change == 'future': mapping['source_indices'] = [2]
            if change == 'task': scenario['evaluation_only']['cut']['start_index'] = 1
            with self.assertRaises(ValueError): activity.validate_mapping(scenario, mapping)

    def test_tampered_document_cannot_add_gold_or_preset_answers(self):
        scenario, mapping = fixture()
        adapted = activity.adapt_scenario(scenario, mapping, STAMP, 'review')
        for key in ('correctAnswer', 'answer', 'hint', 'rubric', 'explanation'):
            altered = deepcopy(adapted)
            altered['initial_document']['nodes'][0][key] = 'PRIVATE'
            with self.assertRaises(ValueError): native.validate_native_scenario(altered)

    def test_text_entry_requires_original_input_affordance(self):
        for suffix, works in [('An answer box accepts the attempt.', True), ('Written on the board.', False)]:
            scenario, mapping = fixture('[PROBLEM_CHANGE: p1 (start)] Solve 3 + 4? ' + suffix)
            mapping.update(kind='text', prompt_parts=['Solve 3 + 4?'], choices=[])
            if works:
                self.assertEqual(activity.adapt_scenario(scenario, mapping, STAMP, 'review')['initial_document']['nodes'][0]['kind'], 'text')
            else:
                with self.assertRaises(ValueError): activity.adapt_scenario(scenario, mapping, STAMP, 'review')

    def test_reviews_account_for_every_input_without_silent_selection(self):
        scenario, mapping = fixture()
        mapping.update(status='review', kind='text', prompt_parts=[], choices=[], reason='Missing diagram')
        bundle = {'purpose': 'reference', 'registry_sha256': 'a' * 64, 'families': [], 'scenarios': [scenario]}
        result = activity.build_activities(bundle, [mapping], STAMP, 'review')
        self.assertEqual(result['counts'], {'admitted': 1, 'adapted': 0, 'deferred': 1, 'adapted_families': 0})
        with self.assertRaises(ValueError): activity.build_activities(bundle, [], STAMP, 'review')


if __name__ == '__main__':
    unittest.main()
