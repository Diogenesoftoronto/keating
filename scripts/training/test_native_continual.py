"""Offline lineage, leakage and retention contracts; no provider or credentials."""
from copy import deepcopy
import unittest

import native_continual as nc
import native_training as nt


def uri(name, sampling=False):
    return 'tinker://11111111-1111-4111-8111-111111111111:train:0/' + ('sampler_weights/' if sampling else 'weights/') + name


def root():
    return {'id': 'initial', 'model': 'authored-model', 'training_checkpoint': uri('initial'),
            'sampler_checkpoint': uri('initial', True)}


def update(name='first', parent='initial', method='sft'):
    parent_weights = uri('initial') if parent == 'initial' else update(parent)['result']['training_checkpoint']
    config = nt.seal({'schema_version': 1, 'method': method,
        'model': {'provider': 'tinker', 'id': 'authored-model', 'revision': parent_weights},
        'tokenizer': {'id': 'authored-model', 'revision': 'fixture-v1', 'chat_template_hash': 'b' * 64},
        'project_id': 'MOCK-project', 'capture_hashes': [nt.native_hash(['authored', name])],
        'allowed_behavior_revisions': [uri('initial', True)], 'learning_rate': 1e-5, 'epsilon': .2,
        'max_abs_log_ratio': 2, 'advantage_cap': 3, 'ttl_seconds': 3600, 'timeout_seconds': 30,
        'rates': {'model_id': 'authored-model', 'source': 'MOCK-not-market-prices', 'verified_on': '2026-09-13',
            'prefill_usd_per_million': '1.00', 'train_usd_per_million': '3.00', 'fixed_usd': '0.10',
            'safety_factor': 5}}, 'config_hash')
    plan = nt.seal({'schema_version': 1, 'consumer': 'native-tinker-update/v1', 'updates': 1,
        'optimizer_state': 'reset_from_pinned_weights', 'export_hash': 'a' * 64,
        'config': config}, 'plan_hash')
    saved_name = 'native-' + plan['plan_hash'][:24] + '-updated'
    result = nt.seal({'schema_version': 1, 'consumer': plan['consumer'], 'plan_hash': plan['plan_hash'],
        'export_hash': plan['export_hash'], 'status': 'complete', 'optimizer_acknowledged': True,
        'last_dispatched': 'save_sampler', 'training_client_id': '11111111-1111-4111-8111-111111111111:train:0',
        'training_checkpoint': uri(saved_name), 'sampler_checkpoint': uri(saved_name, True)}, 'result_hash')
    return {'id': name, 'parent': parent, 'plan': plan, 'result': result}


def lineage():
    return nc.checkpoint_lineage(root(), [update(), update('second', 'first', 'ppo')])


class LineageTests(unittest.TestCase):
    def test_actual_parent_chain_and_sibling_ablations_are_distinct(self):
        value = nc.checkpoint_lineage(root(), [update(), update('negative', method='ppo')])
        self.assertEqual(nc.ancestor_distance(value, uri('initial', True), 'first'), 1)
        self.assertIsNone(nc.ancestor_distance(value, value['nodes']['negative']['sampler_checkpoint'], 'first'))
        self.assertFalse(value['restoration_verified'])

    def test_sdpo_sft_and_ppo_from_same_initial_are_three_siblings(self):
        value = nc.checkpoint_lineage(root(), [update(), update('negative', method='ppo'),
                                              update('hindsight', method='sdpo')])
        self.assertEqual(len(value['nodes']), 4)
        for name in ('first', 'negative', 'hindsight'):
            self.assertEqual(value['nodes'][name]['depth'], 1)
            self.assertEqual(value['nodes'][name]['parent'], 'initial')
        self.assertIsNone(nc.ancestor_distance(value, value['nodes']['hindsight']['sampler_checkpoint'], 'first'))

    def test_unacknowledged_failed_and_partially_saved_updates_are_rejected(self):
        for change in ({'optimizer_acknowledged': False}, {'status': 'failed_unknown'}, {'last_dispatched': 'optimizer'}):
            entry = update(); entry['result'] = nt.seal({**entry['result'], **change}, 'result_hash')
            with self.assertRaisesRegex(ValueError, 'unacknowledged'):
                nc.checkpoint_lineage(root(), [entry])

    def test_duplicate_optimizer_acknowledgment_cannot_create_second_node(self):
        entry = update(); duplicate = deepcopy(entry); duplicate['id'] = 'duplicate'
        with self.assertRaisesRegex(ValueError, 'duplicate_update'):
            nc.checkpoint_lineage(root(), [entry, duplicate])

    def test_wrong_parent_and_tampered_result_fail(self):
        entry = update('second', 'first')
        entry['parent'] = 'initial'
        with self.assertRaisesRegex(ValueError, 'wrong_parent'):
            nc.checkpoint_lineage(root(), [entry])
        entry = update(); entry['result']['status'] = 'failed_unknown'
        with self.assertRaisesRegex(ValueError, 'invalid_result_hash'):
            nc.checkpoint_lineage(root(), [entry])

    def test_resealed_cyclic_input_cannot_hang_ancestor_walk(self):
        value = lineage(); value['nodes']['initial']['parent'] = 'second'
        value = nt.seal(value, 'lineage_hash')
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            nc.ancestor_distance(value, uri('absent', True), 'second')

    def test_resealing_outer_plan_does_not_validate_changed_nested_config(self):
        entry = update()
        entry['plan']['config']['method'] = 'ppo'  # config_hash still binds SFT
        entry['plan'] = nt.seal(entry['plan'], 'plan_hash')
        entry['result']['plan_hash'] = entry['plan']['plan_hash']
        saved = 'native-' + entry['plan']['plan_hash'][:24] + '-updated'
        entry['result'].update(training_checkpoint=uri(saved), sampler_checkpoint=uri(saved, True))
        entry['result'] = nt.seal(entry['result'], 'result_hash')
        with self.assertRaisesRegex(ValueError, 'invalid_config_hash'):
            nc.checkpoint_lineage(root(), [entry])

    def test_valid_nested_hash_still_requires_valid_updater_configuration(self):
        entry = update()
        entry['plan']['config']['epsilon'] = 5
        entry['plan']['config'] = nt.seal(entry['plan']['config'], 'config_hash')
        entry['plan'] = nt.seal(entry['plan'], 'plan_hash')
        entry['result']['plan_hash'] = entry['plan']['plan_hash']
        entry['result'] = nt.seal(entry['result'], 'result_hash')
        with self.assertRaisesRegex(ValueError, 'bounded_update_settings'):
            nc.checkpoint_lineage(root(), [entry])

    def test_sampler_must_match_acknowledged_client_and_plan_save(self):
        for mutation in ('foreign_sampler', 'foreign_pair', 'wrong_save', 'teacher_sampler', 'missing_client'):
            with self.subTest(mutation=mutation):
                entry = update(); result = entry['result']
                if mutation == 'foreign_sampler':
                    result['sampler_checkpoint'] = result['sampler_checkpoint'].replace('11111111', '22222222')
                elif mutation == 'foreign_pair':
                    for key in ('training_checkpoint', 'sampler_checkpoint'):
                        result[key] = result[key].replace('11111111', '22222222')
                elif mutation == 'wrong_save':
                    result['sampler_checkpoint'] = uri('unrelated-step', True)
                elif mutation == 'teacher_sampler':
                    result['sampler_checkpoint'] = result['sampler_checkpoint'].replace('-updated', '-teacher')
                else:
                    result.pop('training_client_id')
                entry['result'] = nt.seal(result, 'result_hash')
                with self.assertRaisesRegex(ValueError, 'lineage_checkpoint_pair_identity'):
                    nc.checkpoint_lineage(root(), [entry])

    def test_reused_client_save_is_not_a_new_update_even_with_valid_plan_binding(self):
        first, second = update(), update('second', 'first', 'ppo')
        second['result']['sampler_checkpoint'] = first['result']['sampler_checkpoint']
        second['result'] = nt.seal(second['result'], 'result_hash')
        with self.assertRaisesRegex(ValueError, 'reused_or_invalid_checkpoint'):
            nc.checkpoint_lineage(root(), [first, second])


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.lineage = lineage()
        self.schedule = nt.seal({'lineage_hash': self.lineage['lineage_hash'], 'measurement': 'authored_fixture',
            'checkpoints': ['initial', 'first', 'second'], 'slices': ['fractions', 'geometry']}, 'schedule_hash')
        scores = [[.5, .3], [.9, .4], [.8, .7]]
        self.rows = [{'checkpoint': c, 'sampler_checkpoint': self.lineage['nodes'][c]['sampler_checkpoint'], 'slice': s,
            'score': scores[i][j], 'assessment_count': 5, 'measurement': 'authored_fixture',
            'assessment_hash': 'b' * 64, 'schedule_hash': self.schedule['schedule_hash']}
            for i, c in enumerate(self.schedule['checkpoints']) for j, s in enumerate(self.schedule['slices'])]

    def test_forgetting_and_plasticity_use_the_declared_cells(self):
        result = nc.retention_report(self.lineage, self.schedule, self.rows)
        self.assertAlmostEqual(result['learning'][0]['plasticity'], .4)
        self.assertIsNone(result['learning'][0]['forgetting'])
        self.assertAlmostEqual(result['learning'][1]['plasticity'], .3)
        self.assertAlmostEqual(result['learning'][1]['forgetting'], .1)
        self.assertEqual(result['observed_cells'], 6)

    def test_absent_old_measurement_is_not_zero_or_imputed(self):
        result = nc.retention_report(self.lineage, self.schedule, self.rows[1:])
        self.assertIsNone(result['matrix'][0][0])
        self.assertIsNone(result['learning'][0]['plasticity'])
        self.assertIsNone(result['learning'][1]['forgetting'])
        self.assertAlmostEqual(result['learning'][1]['plasticity'], .3)

    def test_all_unknown_scores_with_zero_assessments_establish_no_learning(self):
        rows = [{**r, 'score': None, 'assessment_count': 0} for r in self.rows]
        result = nc.retention_report(self.lineage, self.schedule, rows)
        self.assertEqual(result['matrix'], [[None, None]] * 3)
        self.assertEqual(result['assessment_count'], 0)
        self.assertTrue(all(r['forgetting'] is None and r['plasticity'] is None for r in result['learning']))

    def test_fork_is_not_mislabeled_continual_training(self):
        value = nc.checkpoint_lineage(root(), [update(), update('negative', method='ppo')])
        schedule = nt.seal({**self.schedule, 'lineage_hash': value['lineage_hash'],
                            'checkpoints': ['initial', 'first', 'negative']}, 'schedule_hash')
        with self.assertRaisesRegex(ValueError, 'sibling'):
            nc.retention_report(value, schedule, [])

    def test_duplicate_wrong_checkpoint_and_fabricated_denominator_fail(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            nc.retention_report(self.lineage, self.schedule, self.rows + [self.rows[0]])
        for change in ({'sampler_checkpoint': uri('wrong', True)}, {'assessment_count': 0}, {'score': 1.1}):
            rows = deepcopy(self.rows); rows[0].update(change)
            with self.assertRaises(ValueError):
                nc.retention_report(self.lineage, self.schedule, rows)


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.lineage = lineage(); self.identities = ['a' * 64, 'b' * 64, 'c' * 64]
        self.bundle = nt.seal({'schema_version': 1, 'episodes': [{'family': 'family-a'}],
            'sft': [{'family': 'family-a', 'segment': {'capture_hash': h,
                'actor': {'revision': uri('initial', True)}}} for h in self.identities]}, 'export_hash')
        self.manifest = nt.seal({'schema_version': 1, 'export_hash': self.bundle['export_hash'],
            'registry_revision': 'authored-v1', 'approved_by': 'fixture-reviewer', 'episodes': self.bundle['episodes'],
            'families': [{'family': 'family-a', 'split': 'train', 'protected': False,
                'aliases': ['family-a', 'other-alias'], 'sources': [{'dataset': 'authored', 'revision': 'v1',
                    'record_id': 'record-0', 'record_sha256': 'd' * 64, 'original_split': 'train'}]}]}, 'split_hash')
        self.assignment = {h: {'bucket': b, 'rationale': 'Authored bucket fixture', 'evidence_hash': 'e' * 64}
                           for h, b in zip(self.identities, ['recent', 'reservoir', 'hard'])}
        self.quotas = {'recent': 1, 'reservoir': 1, 'hard': 1}

    def select(self, **kwargs):
        return nc.select_replay(self.bundle, self.manifest, self.lineage, 'second', self.assignment, self.quotas, **kwargs)

    def test_selection_is_deterministic_and_preserves_exact_quotas(self):
        selected = self.select()
        self.assertEqual(selected, self.select())
        self.assertEqual({r['capture_hash'] for r in selected['selected']}, set(self.identities))
        self.assertEqual({r['update_distance'] for r in selected['selected']}, {2})
        self.assertFalse(selected['dispatches'])

    def test_revocation_through_alias_and_staleness_never_reallocate(self):
        for kwargs in ({'revoked_aliases': ['other-alias']}, {'max_updates': 1}):
            with self.assertRaisesRegex(ValueError, 'insufficient_eligible'):
                self.select(**kwargs)

    def test_protected_source_cannot_enter_a_replay_batch(self):
        self.manifest['families'][0]['protected'] = True
        self.manifest = nt.seal(self.manifest, 'split_hash')
        with self.assertRaisesRegex(ValueError, 'protected_family'):
            self.select()

    def test_revocation_must_be_a_collection_of_whole_nonblank_aliases(self):
        invalid = ['other-alias', b'other-alias', {'other-alias': True}, {'other-alias'}, None, True, 3,
                   [''], [' '], [' other-alias'], ['other-alias '], [False], [42], [['other-alias']],
                   ['other-alias', 'other-alias'], iter(['other-alias'])]
        for aliases in invalid:
            with self.subTest(aliases=repr(aliases)), self.assertRaisesRegex(ValueError, 'revoked_alias_collection'):
                self.select(revoked_aliases=aliases)
        self.assertEqual(self.select(revoked_aliases=[]), self.select(revoked_aliases=()))
        with self.assertRaisesRegex(ValueError, 'insufficient_eligible'):
            self.select(revoked_aliases=('other-alias',))


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.lineage = lineage()
        pins = {role: {key: self.lineage['nodes'][name][key] for key in ('training_checkpoint', 'sampler_checkpoint')}
                for role, name in (('candidate', 'second'), ('rollback', 'first'))}
        self.protocol = nt.seal({'candidate': 'second', 'rollback': 'first', 'minimum_gain': .02,
            'lineage_hash': self.lineage['lineage_hash'], 'checkpoint_pins': pins,
            'maximum_forgetting': .05, 'measurement': 'model_episode', 'development_authors': ['actor']}, 'protocol_hash')
        self.evidence = {gate: {'candidate': 'second', 'rollback': 'first', 'measurement': 'model_episode',
            'lineage_hash': self.lineage['lineage_hash'], 'checkpoint_pins': deepcopy(pins),
            'protocol_hash': self.protocol['protocol_hash'], 'reviewer': 'independent-fixture-reviewer',
            'independent': True, 'artifact_hash': 'a' * 64, 'passed': True,
            **({'unit': 'source_family', 'interval_95': [.03, .04]} if gate in ('quality', 'retention') else {})}
            for gate in ['quality', 'retention', 'safety_format', 'calibration', 'restore']}

    def test_complete_scoped_evidence_never_deploys(self):
        result = nc.promotion_decision(self.protocol, self.evidence, self.lineage)
        self.assertTrue(result['eligible']); self.assertFalse(result['deployed'])

    def test_missing_restore_and_weak_gain_block_promotion(self):
        del self.evidence['restore']; self.evidence['quality']['interval_95'] = [-.01, .1]
        result = nc.promotion_decision(self.protocol, self.evidence, self.lineage)
        self.assertFalse(result['eligible'])
        self.assertIn('restore_missing', result['reasons'])
        self.assertIn('quality_gain_not_established', result['reasons'])

    def test_nonindependent_or_wrong_measurement_evidence_is_rejected(self):
        for change in ({'reviewer': 'actor'}, {'measurement': 'human_learning'}, {'independent': False}):
            evidence = deepcopy(self.evidence); evidence['quality'].update(change)
            with self.assertRaises(ValueError):
                nc.promotion_decision(self.protocol, evidence, self.lineage)

    def test_existing_approval_cannot_promote_different_weights_under_same_names(self):
        # Build a second VALID lineage through the public acknowledgment API;
        # changing friendly names is unnecessary to replace actual saved weights.
        entries = [update(), update('second', 'first', 'ppo')]
        for i, entry in enumerate(entries):
            if i:
                entry['plan']['config']['model']['revision'] = entries[i - 1]['result']['training_checkpoint']
                entry['plan']['config'] = nt.seal(entry['plan']['config'], 'config_hash')
                entry['plan'] = nt.seal(entry['plan'], 'plan_hash')
            client = '22222222-2222-4222-8222-222222222222:train:' + str(i)
            saved = 'native-' + entry['plan']['plan_hash'][:24] + '-updated'
            entry['result'].update(plan_hash=entry['plan']['plan_hash'], training_client_id=client,
                training_checkpoint=f'tinker://{client}/weights/{saved}',
                sampler_checkpoint=f'tinker://{client}/sampler_weights/{saved}')
            entry['result'] = nt.seal(entry['result'], 'result_hash')
        other = nc.checkpoint_lineage(root(), entries)
        self.assertNotEqual(other['nodes']['second']['training_checkpoint'], self.lineage['nodes']['second']['training_checkpoint'])
        with self.assertRaisesRegex(ValueError, 'promotion_lineage_pin'):
            nc.promotion_decision(self.protocol, self.evidence, other)

    def test_old_protocol_without_new_pins_is_not_silently_migrated(self):
        for key, code in (('lineage_hash', 'promotion_lineage_pin'), ('checkpoint_pins', 'promotion_checkpoint_pin')):
            protocol = deepcopy(self.protocol); protocol.pop(key)
            with self.assertRaisesRegex(ValueError, code):
                nc.promotion_decision(nt.seal(protocol, 'protocol_hash'), self.evidence, self.lineage)

    def test_rebinding_lineage_hash_alone_cannot_replace_checkpoint_pins(self):
        for role in ('candidate', 'rollback'):
            for key in ('training_checkpoint', 'sampler_checkpoint'):
                other = deepcopy(self.lineage)
                other['nodes'][self.protocol[role]][key] = uri('replacement', key == 'sampler_checkpoint')
                other = nt.seal(other, 'lineage_hash')
                protocol = nt.seal({**self.protocol, 'lineage_hash': other['lineage_hash']}, 'protocol_hash')
                with self.subTest(role=role, key=key), self.assertRaisesRegex(ValueError, 'promotion_checkpoint_pin'):
                    nc.promotion_decision(protocol, self.evidence, other)

    def test_every_gate_attestation_must_bind_the_exact_checkpoint_pair(self):
        for gate in self.evidence:
            for change in ({'lineage_hash': '0' * 64}, {'checkpoint_pins': {}}):
                evidence = deepcopy(self.evidence); evidence[gate].update(change)
                with self.subTest(gate=gate, change=change), self.assertRaisesRegex(ValueError, 'promotion_evidence_pin'):
                    nc.promotion_decision(self.protocol, evidence, self.lineage)

    def test_explicit_failed_quality_denies_despite_favorable_interval(self):
        self.evidence['quality']['passed'] = False
        result = nc.promotion_decision(self.protocol, self.evidence, self.lineage)
        self.assertFalse(result['eligible'])
        self.assertIn('quality_not_passed', result['reasons'])

    def test_explicit_failure_or_absent_pass_in_every_gate_denies(self):
        for gate in self.evidence:
            for absent in (False, True):
                evidence = deepcopy(self.evidence)
                if absent:
                    evidence[gate].pop('passed')
                else:
                    evidence[gate]['passed'] = False
                result = nc.promotion_decision(self.protocol, evidence, self.lineage)
                self.assertFalse(result['eligible'], (gate, absent))
                self.assertIn(gate + '_not_passed', result['reasons'])

    def test_truthy_strings_and_unknown_fields_do_not_pass_gate_schema(self):
        for change in ({'passed': 'true'}, {'passed': 1}, {'failure': True}, {'pased': True}):
            evidence = deepcopy(self.evidence); evidence['quality'].update(change)
            with self.assertRaisesRegex(ValueError, 'promotion_gate_fields|promotion_passed_boolean'):
                nc.promotion_decision(self.protocol, evidence, self.lineage)


if __name__ == '__main__':
    unittest.main()
