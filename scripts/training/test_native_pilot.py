"""Authored offline fixtures. Ratings below test arithmetic, not tutor performance."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import native_pilot as pilot
import native_scenarios as native
from test_native_scenarios import bridge, record


def fixture_configuration():
    policy = {'model': 'authored-offline-policy', 'revision': 'fixture-v1',
              'prompt_sha256': pilot.digest('authored prompt'),
              'sampler': {'temperature': 1, 'top_p': 1, 'max_tokens': 128}}
    return {'authors': ['fixture-author'], 'seed': 7, 'actor': deepcopy(policy), 'learner': deepcopy(policy),
            'runtime': {'revision': 'a' * 40},
            'rubric': {'revision': 'fixture-v1', 'sha256': pilot.digest('authored test rubric'),
                       'metrics': [{'id': 'fixture_check', 'definition': 'Authored arithmetic test only',
                                    'unit': 'fixture units', 'minimum': 0, 'maximum': 1}]},
            'limits': {'max_decisions': 6, 'max_sessions': 2, 'max_provider_calls': 12,
                       'max_tool_calls': 16, 'max_repairs': 1, 'turn_timeout_ms': 20000,
                       'learner_timeout_ms': 20000},
            'conditions': {c: {'surface': c, 'tool_schema_sha256': pilot.digest(c),
                               'learner_actions': [] if c == 'chat' else ['submit-answer', 'choose-option', 'update-notes']}
                           for c in pilot.CONDITIONS}}


def fixture_records():
    rows = []
    for index in range(30):
        value = bridge(f'{500 + index}_1')
        value['c_h'][0]['text'] = f'A crate contains {20 + index} blue balls and 4 red balls. How many balls are there?'
        value['c_h'][1]['text'] = f'I subtracted four and got {16 + index}. Is this the right operation?'
        rows.append(record('bridge', value, index=index))
    return rows


def approved_reviews(plan):
    result = pilot.review_template(plan)
    for situation in result['situations']:
        for review in [situation['source_context'], *situation['formats'].values()]:
            for field in review:
                if field not in ('reviewer', 'evidence'):
                    review[field] = True
            review.update(reviewer='authored-independent-reviewer',
                          evidence={'uri': 'authored:test-review', 'sha256': pilot.digest('fixture review')})
    return result


class NativePilotTests(unittest.TestCase):
    def setUp(self):
        self.records = fixture_records()
        self.registry = native.load_registry()
        self.bundle = native.build_native_scenarios(self.records, self.registry)
        self.configuration = fixture_configuration()
        self.plan = pilot.build_pilot(self.bundle, self.configuration)
        self.reviews = approved_reviews(self.plan)
        self.dispatch = pilot.prepare_dispatch(self.plan, self.reviews)

    def slot(self, situation=0, replicate=0, condition='chat'):
        identity = self.plan['situations'][situation]['id']
        return next(s for s in self.plan['slots'] if (s['situation_id'], s['replicate'], s['condition']) == (identity, replicate, condition))

    def attempt(self, slot, status='complete'):
        return {'slot_id': slot['id'], 'plan_sha256': self.plan['plan_sha256'],
                'dispatch_sha256': self.dispatch['dispatch_sha256'],
                **{k: deepcopy(slot[k]) for k in ('manifest_hashes', 'scenario_sha256', 'initial_evidence_sha256')},
                'status': status, 'receipt': None if status == 'started' else
                {'uri': 'authored:runtime-receipt', 'sha256': pilot.digest('receipt')}}

    def outcome(self, slot, value):
        return {'slot_id': slot['id'], 'metric': 'fixture_check', 'value': value,
                'assessor': 'authored-independent-assessor', 'independent': True,
                'evidence': {'uri': 'authored:assessment', 'sha256': pilot.digest('assessment')},
                'rubric_sha256': self.plan['manifest_hashes']['rubric']}

    def report(self, attempts=(), outcomes=()):
        return pilot.report_pilot(self.plan, list(attempts), list(outcomes), self.dispatch, samples=100, seed=3)

    def test_design_preserves_exact_initial_evidence_and_paired_seed(self):
        self.assertEqual(len(self.plan['slots']), 180)
        self.assertEqual(len({s['id'] for s in self.plan['slots']}), 180)
        for index, situation in enumerate(self.plan['situations']):
            self.assertEqual(situation['scenario'], next(s for s in self.bundle['scenarios'] if s['id'] == situation['id']))
            for replicate in range(3):
                a, b = [self.slot(index, replicate, c) for c in pilot.CONDITIONS]
                for field in ('paired_seed', 'scenario_sha256', 'initial_evidence_sha256', 'manifest_hashes'):
                    self.assertEqual(a[field], b[field])
                self.assertNotEqual(a['id'], b['id'])
        public = native.canonical(native.public_views(self.plan['situations'][0]['scenario']))
        self.assertNotIn('PRIVATE_', public)

    def test_selection_order_does_not_change_plan(self):
        ids = [s['id'] for s in self.plan['situations']]
        self.assertEqual(self.plan, pilot.build_pilot(self.bundle, self.configuration, list(reversed(ids))))
        self.assertEqual(self.plan, pilot.validate_pilot(deepcopy(self.plan), self.bundle))

    def test_plan_owns_copies_and_tampering_is_detected(self):
        before = deepcopy(self.plan)
        self.configuration['actor']['sampler']['temperature'] = 0
        self.bundle['scenarios'][0]['actor']['opening_message'] = 'changed'
        self.assertEqual(self.plan, before)
        broken = deepcopy(self.plan)
        broken['slots'][0]['paired_seed'] += 1
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            pilot.validate_pilot(broken, self.bundle)

    def test_resealed_slot_or_private_source_change_fails_reconstruction(self):
        for change in ('slot', 'source'):
            broken = deepcopy(self.plan)
            if change == 'slot':
                broken['slots'][0]['initial_evidence_sha256'] = 'f' * 64
            else:
                broken['situations'][0]['scenario']['evaluation_only']['original']['c_r'] = []
            broken.pop('plan_sha256')
            broken = pilot.sealed(broken, 'plan_sha256')
            with self.assertRaises(ValueError):
                pilot.validate_pilot(broken, self.bundle)

    def test_reference_and_test_family_are_rejected(self):
        for case in ('reference', 'test_sibling'):
            broken = deepcopy(self.bundle)
            if case == 'reference':
                broken['purpose'] = 'reference'
            else:
                broken['families'][0]['members'].append({'original_split': 'test'})
            with self.assertRaises(ValueError):
                pilot.build_pilot(broken, self.configuration)

    def test_insufficient_or_aliased_situations_do_not_fill_thirty(self):
        broken = deepcopy(self.bundle)
        broken['scenarios'][-1]['actor'] = deepcopy(broken['scenarios'][0]['actor'])
        with self.assertRaisesRegex(ValueError, 'Fewer than 30'):
            pilot.build_pilot(broken, self.configuration)
        with self.assertRaises(ValueError):
            pilot.build_pilot(self.bundle, self.configuration, [self.plan['situations'][0]['id']] * 30)

    def test_admission_replay_rejects_modified_public_view(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'scenarios.json'
            path.write_text(native.canonical(self.bundle))
            with patch.object(native, 'load_source_records', return_value=self.records), \
                 patch.object(native, 'load_registry', return_value=self.registry), \
                 patch.object(native, 'read_exposure_ledger', return_value={'families': {}}):
                self.assertEqual(pilot.load_admitted_bundle(path), self.bundle)
                value = deepcopy(self.bundle)
                value['scenarios'][0]['actor']['opening_message'] += ' injected answer'
                path.write_text(native.canonical(value))
                with self.assertRaisesRegex(ValueError, 'replay mismatch'):
                    pilot.load_admitted_bundle(path)

    def test_all_reviews_required_and_authors_cannot_self_approve(self):
        variants = [pilot.review_template(self.plan), deepcopy(self.reviews), deepcopy(self.reviews), deepcopy(self.reviews)]
        variants[1]['situations'][0]['formats']['interactive']['format_suitable'] = False
        variants[2]['situations'][0]['source_context']['reviewer'] = 'fixture-author'
        variants[3]['situations'].pop()
        for reviews in variants:
            with self.assertRaises(ValueError):
                pilot.prepare_dispatch(self.plan, reviews)
        self.assertFalse(self.dispatch['executes'])

    def test_reviews_cannot_follow_changed_experiment(self):
        config = deepcopy(self.configuration)
        config['limits']['max_decisions'] = 5
        changed = pilot.build_pilot(self.bundle, config)
        with self.assertRaisesRegex(ValueError, 'Review/plan'):
            pilot.prepare_dispatch(changed, self.reviews)

    def test_empty_report_has_unknown_outcomes_no_happy_defaults(self):
        report = pilot.report_pilot(self.plan, [], [], samples=100)
        self.assertEqual((report['planned'], report['attempted'], report['unattempted']), (180, 0, 180))
        metric = report['metrics']['fixture_check']
        self.assertIsNone(metric['full_pilot_effect'])
        self.assertIsNone(metric['available_pairs']['situation_weighted'])
        self.assertEqual(metric['outcomes']['chat']['unknown'], 90)

    def test_failed_and_unfinished_attempts_preserve_denominator(self):
        attempts = [self.attempt(self.slot(), 'delivery_failure'), self.attempt(self.slot(condition='interactive'), 'started')]
        report = self.report(attempts)
        self.assertEqual(report['attempted'], 2)
        rows = {r['condition']: r for r in report['denominators'] if r['dataset'] == 'all'}
        self.assertEqual(rows['chat']['failures'], 1)
        self.assertEqual(rows['interactive']['unresolved'], 1)
        self.assertEqual(report['metrics']['fixture_check']['paired_replicates'], 0)
        with self.assertRaises(ValueError):
            self.report(attempts, [self.outcome(self.slot(condition='interactive'), 1)])

    def test_unmatched_replicates_cannot_be_compared(self):
        a, b = self.slot(replicate=0), self.slot(replicate=1, condition='interactive')
        metric = self.report([self.attempt(a), self.attempt(b)], [self.outcome(a, 0), self.outcome(b, 1)])['metrics']['fixture_check']
        self.assertEqual(metric['paired_replicates'], 0)
        self.assertEqual(metric['outcomes']['chat']['known'], 1)
        self.assertEqual(metric['outcomes']['interactive']['known'], 1)
        self.assertIsNone(metric['available_pairs']['situation_weighted'])

    def test_zero_is_known_and_null_is_unknown(self):
        a, b = self.slot(), self.slot(condition='interactive')
        metric = self.report([self.attempt(a), self.attempt(b)], [self.outcome(a, 0), self.outcome(b, None)])['metrics']['fixture_check']
        self.assertEqual(metric['outcomes']['chat']['known'], 1)
        self.assertEqual(metric['outcomes']['interactive']['known'], 0)
        self.assertIsNone(metric['full_pilot_effect'])

    def test_pairing_averages_within_situation_before_across_situations(self):
        attempts, outcomes = [], []
        for situation, replicas, delta in ((0, 1, 1), (1, 3, 0)):
            for replicate in range(replicas):
                for condition in pilot.CONDITIONS:
                    slot = self.slot(situation, replicate, condition)
                    attempts.append(self.attempt(slot))
                    outcomes.append(self.outcome(slot, delta if condition == 'interactive' else 0))
        metric = self.report(attempts, outcomes)['metrics']['fixture_check']
        self.assertEqual(metric['paired_replicates'], 4)
        self.assertEqual(metric['available_pairs']['situation_weighted'], .5)
        self.assertIsNone(metric['full_pilot_effect'])

    def test_family_blocks_keep_unequal_clusters_together(self):
        rows = [{'cluster': 'family-a', 'delta': 0} for _ in range(3)] + [{'cluster': 'family-b', 'delta': 1}]
        result = pilot.paired_bootstrap(rows, 100, 7)
        self.assertEqual(result['families'], 2)
        self.assertEqual(result['situation_weighted'], .25)
        self.assertEqual(result['family_weighted'], .5)
        self.assertEqual(result, pilot.paired_bootstrap(list(reversed(rows)), 100, 7))
        one_family = pilot.paired_bootstrap([{'cluster': 'same-origin', 'delta': v} for v in (0, 1, 1)], 100)
        self.assertIsNone(one_family['ci95_situation_weighted'])
        self.assertEqual(one_family['families'], 1)

    def test_unselected_family_can_connect_selected_aliases(self):
        bundle = deepcopy(self.bundle)
        first, second = bundle['families'][:2]
        bundle['families'].append({'family': 'unselected-bridge',
                                   'aliases': [first['family'], second['family']], 'members': [], 'decision': 'not_selected'})
        result = pilot.build_pilot(bundle, self.configuration)
        selected = [s for s in result['situations'] if s['family'] in (first['family'], second['family'])]
        self.assertEqual(len({s['cluster'] for s in selected}), 1)

    def test_attempts_require_reviewed_dispatch_and_exact_frozen_bindings(self):
        attempt = self.attempt(self.slot())
        with self.assertRaises(ValueError):
            pilot.report_pilot(self.plan, [attempt], [], samples=100)
        for key in ('manifest_hashes', 'initial_evidence_sha256', 'scenario_sha256', 'dispatch_sha256'):
            wrong = deepcopy(attempt)
            wrong[key] = 'wrong'
            with self.assertRaises(ValueError):
                self.report([wrong])
        with self.assertRaises(ValueError):
            self.report([attempt, attempt])

    def test_assessment_requires_evidence_independence_range_and_attempt(self):
        slot = self.slot()
        with self.assertRaises(ValueError):
            self.report([], [self.outcome(slot, 1)])
        for field, bad in (('evidence', None), ('independent', False), ('value', True),
                           ('value', float('nan')), ('value', 2), ('rubric_sha256', 'a' * 64)):
            outcome = self.outcome(slot, .5)
            outcome[field] = bad
            with self.assertRaises(ValueError):
                self.report([self.attempt(slot)], [outcome])

    def test_no_restricted_output_in_tracked_or_external_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                pilot.write_outputs(Path(directory) / 'report', {'report.json': {}})
            self.assertFalse((Path(directory) / 'report').exists())
        with self.assertRaises(ValueError):
            pilot.write_outputs(native.ROOT / 'docs' / 'should-not-exist-native-pilot', {'report.json': {}})

    def test_candidate_artifact_contains_no_raw_data_pins_reviews_or_ratings(self):
        result = pilot.candidate_selection(self.bundle)
        self.assertEqual(len(result['selected_ids']), 30)
        self.assertEqual(len(result['source_family_groups']), 30)
        self.assertEqual(result['status'], 'candidates_only')
        payload = native.canonical(result)
        for forbidden in ('PRIVATE_', 'opening_message', 'prompt_sha256', 'approved', 'fixture_check'):
            self.assertNotIn(forbidden, payload)

    def test_reports_preserve_every_selected_family_even_with_zero_observations(self):
        a, b = self.slot(), self.slot(condition='interactive')
        result = self.report([self.attempt(a), self.attempt(b)], [self.outcome(a, 0), self.outcome(b, 1)])
        groups = result['metrics']['fixture_check']['source_family_groups']
        self.assertEqual({g['source_family'] for g in groups}, {s['cluster'] for s in self.plan['situations']})
        self.assertEqual(len(groups), 30)
        self.assertEqual(sum(g['planned_slots'] for g in groups), 180)
        self.assertEqual(sum(g['attempted_slots'] for g in groups), 2)
        untouched = [g for g in groups if g['attempted_slots'] == 0]
        self.assertEqual(len(untouched), 29)
        self.assertTrue(all(g['available_pair_effect'] is None and g['full_family_effect'] is None for g in untouched))
        self.assertTrue(all(g['unknown_outcomes'] == 6 for g in untouched))

    def test_full_pilot_effect_requires_all_ninety_pairs(self):
        attempts = [self.attempt(s) for s in self.plan['slots']]
        outcomes = [self.outcome(s, 0 if s['condition'] == 'chat' else .25) for s in self.plan['slots']]
        full = self.report(attempts, outcomes)['metrics']['fixture_check']
        self.assertEqual(full['full_pilot_effect'], .25)
        self.assertEqual(full['paired_replicates'], 90)
        self.assertEqual(full['complete_situations'], 30)
        partial = self.report(attempts, outcomes[:-1])['metrics']['fixture_check']
        self.assertIsNone(partial['full_pilot_effect'])
        self.assertEqual(partial['paired_replicates'], 89)


if __name__ == '__main__':
    unittest.main()
