"""Unit tests for native_practice_activities pure practice-surface adapter.

Entirely authored using test_native_scenarios helper record and native.make_scenario.
Tests all pre-dispatch validation and documents pending coordinator dispatch integration.
"""
from copy import deepcopy
import unittest
from unittest.mock import patch

import native_practice_activities as activity
import native_scenarios as native
from test_native_scenarios import (
    ATTEMPT,
    FUTURE,
    LABEL,
    PROFILE,
    QUESTION,
    SECRET,
    bridge,
    mathdial,
    record,
)

STAMP = '2026-09-14T00:00:00.000Z'


def fixture(dataset='mathdial'):
    if dataset == 'mathdial':
        row = mathdial(qid=71)
        src = record('mathdial', row, split='train')
        origin = ('mathdial-qid-71', ['mathdial-qid-71'], 'mathdial-original-qid')
        decision = {
            'purpose': 'development',
            'exposure': 'development-exposed',
            'source_splits': ['mathdial:train'],
            'protected': False,
        }
        scenario = native.make_scenario(src, origin, decision)
        mapping = {
            'id': scenario['id'],
            'source_sha256': src.sha256,
            'status': 'ready',
            'reason': 'Authored practice surface for mathdial word problem.',
            'prompt': QUESTION,
        }
        return scenario, mapping
    elif dataset == 'bridge':
        row = bridge(identity='451_12')
        src = record('bridge', row, split='train')
        origin = ('bridge-conversation-451', ['bridge-conversation-451'], 'bridge-conversation-id')
        decision = {
            'purpose': 'development',
            'exposure': 'development-exposed',
            'source_splits': ['bridge:train'],
            'protected': False,
        }
        scenario = native.make_scenario(src, origin, decision)
        mapping = {
            'id': scenario['id'],
            'source_sha256': src.sha256,
            'status': 'ready',
            'reason': 'Authored practice surface for bridge conversation.',
            'prompt': QUESTION,
        }
        return scenario, mapping
    raise ValueError(f'Unknown dataset fixture: {dataset}')


def build_adapted(scenario, mapping, created_at=STAMP, reviewer='authored-practice-review'):
    """Builds an adapted scenario matching adapt_practice output before parent dispatch."""
    result = deepcopy(scenario)
    result['initial_document'] = activity.make_document(mapping, created_at)
    result['source']['transformations'].append(activity.VERSION)
    result['evaluation_only']['activity_adaptation'] = {
        'version': activity.VERSION,
        'mapping': deepcopy(mapping),
        'mapping_sha256': activity.digest(mapping),
        'reviewer': reviewer,
        'created_at': created_at,
        'initial_document_sha256': activity.digest(result['initial_document']),
        'actor_sha256': activity.digest(result['actor']),
        'provenance': 'authored-practice-surface; new-canonical-text-input-not-source-asserted',
        'affordance': 'new-text-input-for-public-task; no-invented-multiple-choice-distractors',
        'state_policy': 'fresh-unanswered-attempt; historical-actions-remain-prefix-evidence',
        'assessment': 'unavailable; no-source-answer-key-in-document',
    }
    return result


class NativePracticeActivityTests(unittest.TestCase):
    def test_make_document_canonical_openui_shape_and_no_presets(self):
        _, mapping = fixture()
        doc = activity.make_document(mapping, STAMP)
        self.assertEqual(doc['schemaVersion'], 1)
        self.assertEqual(doc['revision'], 0)
        self.assertEqual(doc['lifecycle'], 'ready')
        self.assertEqual(doc['retention'], 'ephemeral')
        self.assertEqual(doc['supportedSurfaces'], ['web', 'desktop', 'mobile', 'terminal'])
        self.assertEqual(len(doc['nodes']), 1)
        node = doc['nodes'][0]
        self.assertEqual(node, {
            'type': 'question',
            'id': 'source-question',
            'kind': 'text',
            'prompt': QUESTION,
        })
        self.assertEqual(doc['createdAt'], STAMP)
        self.assertEqual(doc['updatedAt'], STAMP)

        # Check no preset answers, keys or sentinels in document serialization
        doc_json = activity.canonical(doc)
        for forbidden in ('choices', 'allowText', 'correctAnswer', 'answer', 'hint', 'rubric', 'explanation', 'solution'):
            self.assertNotIn(forbidden, doc_json)
        for secret in (SECRET, FUTURE, LABEL, PROFILE):
            self.assertNotIn(secret, doc_json)

    def test_preserves_source_family_original_and_public_context(self):
        scenario, mapping = fixture('mathdial')
        adapted = build_adapted(scenario, mapping)
        activity.validate_practice(adapted)

        # Preserves scenario envelope identity
        self.assertEqual(adapted['id'], scenario['id'])
        self.assertEqual(adapted['family'], scenario['family'])

        # Preserves source hashes and original context
        self.assertEqual(adapted['source']['dataset'], scenario['source']['dataset'])
        self.assertEqual(adapted['source']['sha256'], scenario['source']['sha256'])
        self.assertEqual(adapted['evaluation_only']['original'], scenario['evaluation_only']['original'])

        # Preserves public context views
        self.assertEqual(adapted['actor'], scenario['actor'])
        self.assertEqual(adapted['learner'], scenario['learner'])

        # Assessment stays unassessed
        self.assertEqual(adapted['evaluation_only']['native_assessment'], {'status': 'unassessed', 'outcome': None})

    def test_rejects_source_or_private_injection(self):
        scenario, mapping = fixture()

        # Injected private gold solution
        with self.assertRaises(ValueError):
            bad = deepcopy(mapping)
            bad['prompt'] = SECRET
            activity.validate_mapping(scenario, bad)

        # Injected future conversation turn
        with self.assertRaises(ValueError):
            bad = deepcopy(mapping)
            bad['prompt'] = FUTURE
            activity.validate_mapping(scenario, bad)

        # Injected invented prompt (not a substring of actor opening message)
        with self.assertRaises(ValueError):
            bad = deepcopy(mapping)
            bad['prompt'] = 'What is the square root of 144?'
            activity.validate_mapping(scenario, bad)

        # Injected multiple-choice distractor options
        with self.assertRaises(ValueError):
            bad = deepcopy(mapping)
            bad['choices'] = [{'id': 'A', 'label': '13'}]
            activity.validate_mapping(scenario, bad)

        # Injected wrong source sha256 or wrong id
        with self.assertRaises(ValueError):
            bad = deepcopy(mapping)
            bad['source_sha256'] = '0' * 64
            activity.validate_mapping(scenario, bad)

        with self.assertRaises(ValueError):
            bad = deepcopy(mapping)
            bad['id'] = 'mathdial-invented-wrong-id'
            activity.validate_mapping(scenario, bad)

    def test_deferred_mapping_cannot_carry_prompt(self):
        scenario, mapping = fixture()

        # Deferred mapping with prompt must be rejected
        mapping['status'] = 'deferred'
        mapping['prompt'] = QUESTION
        with self.assertRaises(ValueError):
            activity.validate_mapping(scenario, mapping)

        # Deferred mapping without prompt (None or empty) is accepted
        mapping['prompt'] = None
        activity.validate_mapping(scenario, mapping)

        mapping['prompt'] = ''
        activity.validate_mapping(scenario, mapping)

        # Only ready mappings can adapt
        with self.assertRaises(ValueError):
            activity.adapt_practice(scenario, mapping, STAMP, 'reviewer')

        # Deferred mapping accounts in build_activities without adapting
        bundle = {
            'purpose': 'development',
            'registry_sha256': 'a' * 64,
            'families': [],
            'scenarios': [scenario],
        }
        result = activity.build_activities(bundle, [mapping], STAMP, 'reviewer')
        self.assertEqual(result['counts'], {
            'admitted': 1, 'adapted': 0, 'deferred': 1, 'adapted_families': 0,
        })
        self.assertEqual(result['deferred'][0]['id'], scenario['id'])
        self.assertEqual(result['deferred'][0]['reason'], mapping['reason'])

    def test_rejects_protected_and_reference_admission(self):
        row = mathdial(qid=71)
        src = record('mathdial', row, split='test')
        origin = ('mathdial-qid-71', ['mathdial-qid-71'], 'mathdial-original-qid')
        decision = {
            'purpose': 'reference',
            'exposure': 'reference-materialized-not-sealed-holdout',
            'source_splits': ['mathdial:test'],
            'protected': True,
        }
        scenario = native.make_scenario(src, origin, decision)
        mapping = {
            'id': scenario['id'],
            'source_sha256': src.sha256,
            'status': 'ready',
            'reason': 'Authored practice surface.',
            'prompt': QUESTION,
        }

        # adapt_practice must reject reference/protected scenarios
        with self.assertRaises(ValueError):
            activity.adapt_practice(scenario, mapping, STAMP, 'reviewer')

        # validate_practice must reject reference/protected scenarios
        adapted = build_adapted(scenario, mapping)
        with self.assertRaises(ValueError):
            activity.validate_practice(adapted)

    def test_rejects_already_adapted_scenario(self):
        scenario, mapping = fixture()

        # Already has initial_document
        adapted = build_adapted(scenario, mapping)
        with self.assertRaises(ValueError):
            activity.adapt_practice(adapted, mapping, STAMP, 'reviewer')

        # Already has activity_adaptation in evaluation_only
        scenario_with_review = deepcopy(scenario)
        scenario_with_review['evaluation_only']['activity_adaptation'] = adapted['evaluation_only']['activity_adaptation']
        with self.assertRaises(ValueError):
            activity.adapt_practice(scenario_with_review, mapping, STAMP, 'reviewer')

        # Already has practice transformation
        scenario_with_trans = deepcopy(scenario)
        scenario_with_trans['source']['transformations'].append(activity.VERSION)
        with self.assertRaises(ValueError):
            activity.adapt_practice(scenario_with_trans, mapping, STAMP, 'reviewer')

    def test_rejects_tampering_across_document_mapping_hashes_and_source_binding(self):
        scenario, mapping = fixture('bridge')
        adapted = build_adapted(scenario, mapping)
        activity.validate_practice(adapted)

        # 1. Tampered document prompt
        bad = deepcopy(adapted)
        bad['initial_document']['nodes'][0]['prompt'] = 'Tampered prompt'
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 2. Tampered document id / revision
        bad = deepcopy(adapted)
        bad['initial_document']['revision'] = 1
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 3. Tampered initial_document_sha256 in review
        bad = deepcopy(adapted)
        bad['evaluation_only']['activity_adaptation']['initial_document_sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 4. Tampered mapping_sha256 in review
        bad = deepcopy(adapted)
        bad['evaluation_only']['activity_adaptation']['mapping_sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 5. Tampered actor opening message (breaks unchanged source-view binding)
        bad = deepcopy(adapted)
        bad['actor']['opening_message'] += '\nInjected text after review.'
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 6. Tampered original source record (breaks digest(original) == source.sha256)
        bad = deepcopy(adapted)
        bad['evaluation_only']['original']['tampered_key'] = 'injected'
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 7. Tampered transformations list (missing VERSION)
        bad = deepcopy(adapted)
        bad['source']['transformations'].remove(activity.VERSION)
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 8. Tampered adaptation version
        bad = deepcopy(adapted)
        bad['evaluation_only']['activity_adaptation']['version'] = 'source-screen-openui-v1'
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 9. Missing reviewer
        bad = deepcopy(adapted)
        bad['evaluation_only']['activity_adaptation']['reviewer'] = '  '
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

        # 10. Missing provenance
        bad = deepcopy(adapted)
        bad['evaluation_only']['activity_adaptation']['provenance'] = ''
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

    def test_native_result_stays_unknown(self):
        scenario, mapping = fixture()
        adapted = build_adapted(scenario, mapping)
        self.assertEqual(adapted['evaluation_only']['native_assessment'], {
            'status': 'unassessed', 'outcome': None,
        })

        # Tampering with native assessment outcome must be rejected
        bad = deepcopy(adapted)
        bad['evaluation_only']['native_assessment'] = {'status': 'assessed', 'outcome': 'correct'}
        with self.assertRaises(ValueError):
            activity.validate_practice(bad)

    def test_document_no_preset_answers_forbidden_keys(self):
        scenario, mapping = fixture()
        adapted = build_adapted(scenario, mapping)

        for key in ('correctAnswer', 'answer', 'hint', 'rubric', 'explanation', 'solution', 'choices', 'allowText'):
            with self.subTest(key=key):
                bad = deepcopy(adapted)
                bad['initial_document']['nodes'][0][key] = 'GOLD'
                with self.assertRaises(ValueError):
                    activity.validate_practice(bad)

    def test_deterministic_replay_and_call_to_parent_after_coordinator_dispatch(self):
        scenario, mapping = fixture()
        adapted1 = activity.adapt_practice(scenario, mapping, STAMP, 'reviewer-alpha')
        adapted2 = activity.adapt_practice(scenario, mapping, STAMP, 'reviewer-alpha')

        # Deterministic replay producing identical output
        self.assertEqual(adapted1, adapted2)
        self.assertEqual(activity.digest(adapted1), activity.digest(adapted2))

        # Parent validator must succeed after coordinator dispatch
        self.assertIsNotNone(native.validate_native_scenario(adapted1))

    def test_deterministic_replay_with_simulated_coordinator_dispatch(self):
        """Verify deterministic replay and parent dispatch before coordinator edits native_scenarios.py."""
        scenario, mapping = fixture()

        # Simulate coordinator's dispatch hook in native_scenarios.py
        orig_validate = native.validate_native_scenario

        def simulated_validate_native_scenario(sc):
            if 'initial_document' in sc:
                version = sc.get('evaluation_only', {}).get('activity_adaptation', {}).get('version')
                if version == activity.VERSION:
                    activity.validate_practice(sc)
                    return sc
            return orig_validate(sc)

        with patch('native_scenarios.validate_native_scenario', side_effect=simulated_validate_native_scenario):
            adapted1 = activity.adapt_practice(scenario, mapping, STAMP, 'reviewer-simulated')
            adapted2 = activity.adapt_practice(scenario, mapping, STAMP, 'reviewer-simulated')

            self.assertEqual(adapted1, adapted2)
            self.assertEqual(activity.digest(adapted1), activity.digest(adapted2))
            self.assertIn(activity.VERSION, adapted1['source']['transformations'])
            self.assertEqual(adapted1['initial_document']['nodes'][0]['prompt'], mapping['prompt'])


if __name__ == '__main__':
    unittest.main()
