"""Offline adversarial contracts. All mutated sources and receipts stay in memory."""
import copy
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import benchmark_v4 as v

try:
    import benchmark_v3 as v3
except ImportError:
    v3 = None


class FrozenSuiteTests(unittest.TestCase):
    def setUp(self):
        self.suite = v.load_suite()
        self.files = {name: (v.SUITE / name).read_bytes() for name in ('cases.json', 'README.md', 'manifest.json')}

    def load_mutation(self, change, *, rehash=True):
        files = dict(self.files)
        doc, manifest = v.parse_json(files['cases.json']), v.parse_json(files['manifest.json'])
        change(doc, manifest, files)
        files['cases.json'] = v.canonical(doc).encode()
        if rehash:
            manifest['files']['cases.json'] = v.digest(files['cases.json'])
        files['manifest.json'] = v.canonical(manifest).encode()

        def read(path):
            if path.name not in files:
                raise FileNotFoundError(str(path))
            return files[path.name]

        with patch.object(Path, 'read_bytes', read), patch.object(Path, 'is_symlink', return_value=False):
            return v.load_suite(Path('/virtual-frozen-suite'))

    def test_frozen_sources_have_independent_arithmetic_and_complete_turns(self):
        for case in self.suite['cases']:
            with self.subTest(case=case['id']):
                self.assertGreaterEqual(sum(s['kind'] == 'message' for s in case['steps']), 4)
                self.assertEqual(case['training_policy'], 'exclude-entire-family')
                for check in case['reference']['math_checks']:
                    v.validate_math(check)
        values = {m['id']: m['expected'] for c in self.suite['cases'] for m in c['reference']['math_checks']}
        self.assertEqual(values['trip-average'], '4')
        self.assertEqual(values['corrected-equal'], '1/4')
        self.assertEqual(values['accuracy'], '24/25')

    def test_required_sources_and_manifest_cannot_disappear(self):
        for missing in self.files:
            with self.subTest(missing=missing):
                original = Path.read_bytes

                def read(path):
                    if path.name == missing:
                        raise FileNotFoundError(str(path))
                    return original(path)

                with patch.object(Path, 'read_bytes', read), self.assertRaisesRegex(ValueError, 'Missing or unreadable'):
                    v.load_suite()

    def test_modified_case_and_readme_are_rejected_without_new_hashes(self):
        def change_case(doc, manifest, files):
            doc['cases'][0]['steps'][0]['text'] += ' changed'
        with self.assertRaisesRegex(ValueError, 'Source hash mismatch'):
            self.load_mutation(change_case, rehash=False)
        with self.assertRaisesRegex(ValueError, 'Source hash mismatch: README'):
            self.load_mutation(lambda d, m, f: f.update({'README.md': b'changed'}))

    def test_hash_inventory_and_manifest_identity_are_strict(self):
        changes = [lambda d,m,f: m['files'].pop('README.md'),
                   lambda d,m,f: m['files'].update({'../elsewhere': 'a'*64}),
                   lambda d,m,f: m.update(status='untouched-holdout'),
                   lambda d,m,f: d.update(version='4.0.1'),
                   lambda d,m,f: m['files'].update({'README.md': 'not-a-hash'})]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.load_mutation(change)

    def test_duplicate_json_and_nonfinite_values_fail_closed(self):
        for raw in ('{"score":0,"score":2}', '{"value":NaN}', '{"value":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                v.parse_json(raw)

    def test_malformed_cases_fail_even_with_recomputed_source_hash(self):
        changes = [lambda c: c['rubric'][0]['criteria'].pop('1'),
                   lambda c: c['rubric'][0].update(evidence_steps=[]),
                   lambda c: c['rubric'][0].update(evidence_steps=[True]),
                   lambda c: c['rubric'][0].update(evidence_steps=[999]),
                   lambda c: c['rubric'][0].update(evidence_steps=[2,2]),
                   lambda c: c['steps'][0].update(text='/dangerous-command'),
                   lambda c: c['steps'][0].update(kind='ui_action'),
                   lambda c: c.update(seed_files={'fixtures/../config.txt': 'unsafe'}),
                   lambda c: c['reference']['math_checks'][0].update(expected='6'),
                   lambda c: c['reference']['facts'][0].update(available_from_step=-1),
                   lambda c: c.update(training_policy='train-on-this')]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.load_mutation(lambda d,m,f: change(d['cases'][0]))

    def test_pairs_share_family_and_cannot_be_split_by_condition(self):
        with self.assertRaisesRegex(ValueError, 'share one family'):
            self.load_mutation(lambda d,m,f: d['cases'][1].update(family='different-family'))
        with self.assertRaisesRegex(ValueError, 'Duplicate case ID'):
            self.load_mutation(lambda d,m,f: d['cases'][1].update(id=d['cases'][0]['id']))
        pairs = [c for c in self.suite['cases'] if c.get('pair_id') == 'affine-help-pair']
        self.assertEqual({c['id'] for c in pairs}, {'help-hint-then-flip', 'help-worked-then-flip'})
        self.assertEqual(pairs[0]['steps'][2], pairs[1]['steps'][2])
        self.assertEqual(pairs[0]['steps'][-1], pairs[1]['steps'][-1])
        self.assertNotEqual(pairs[0]['steps'][0], pairs[1]['steps'][0])

    def test_transfer_requires_interference_then_fresh_session_then_near_and_far(self):
        original = next(c for c in self.suite['cases'] if 'transfer' in c)
        for key, value in [('near_step', 0), ('far_step', 5), ('session_step', 2), ('interference_steps', []),
                           ('interference_steps', [6]), ('delay', 'one-week-proven')]:
            case = copy.deepcopy(original)
            case['transfer'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                v.validate_case(case)

    def test_reference_arithmetic_rejects_zero_division_negative_weights_and_false_results(self):
        check = dict(id='check', available_from_step=0, operation='quotient', operands=['1','0'], expected='0')
        with self.assertRaises(ValueError): v.validate_math(check)
        check.update(operation='weighted_mean', operands=['3','-1','6','2'])
        with self.assertRaises(ValueError): v.validate_math(check)
        check.update(operation='sum', operands=['1/3','1/6'], expected='2/9')
        with self.assertRaisesRegex(ValueError, 'Incorrect reference math'): v.validate_math(check)

    def test_plan_is_unbound_and_balances_roles_without_inventing_a_sampling_seed(self):
        plan = v.make_plan(self.suite)
        self.assertTrue(all(value['checkpoint'] is None for value in plan['roles'].values()))
        self.assertEqual(plan['checkpoint_status'], 'unbound-no-weights-supplied')
        for row in plan['schedule']:
            self.assertEqual(set(row['role_order']), set(v.ROLES))
        self.assertFalse(plan['claims']['untouched_holdout'])
        self.assertIsNone(plan['claims']['human_learning'])
        self.assertEqual(len(plan['excluded_training_families']), 10)

    def test_checkpoint_provenance_must_be_complete_and_same_base(self):
        cp = {role: dict(checkpoint_id='base' if role == 'initial' else role, weights_sha256='a'*64,
                         base_checkpoint_id='base', training_manifest_sha256=None if role == 'initial' else 'b'*64)
              for role in v.ROLES}
        self.assertEqual(v.make_plan(self.suite, cp)['roles']['F']['checkpoint']['checkpoint_id'], 'F')
        cp['F']['base_checkpoint_id'] = 'different-base'
        with self.assertRaisesRegex(ValueError, 'share the initial base'): v.make_plan(self.suite, cp)
        cp.pop('S')
        with self.assertRaises(ValueError): v.make_plan(self.suite, cp)

    def test_validate_and_plan_never_dispatch_models_or_write_outputs(self):
        for command in ('validate', 'plan'):
            with self.subTest(command=command), patch.object(v, 'legacy', side_effect=AssertionError('model/legacy access')), \
                    patch.object(Path, 'write_text', side_effect=AssertionError('write')), redirect_stdout(io.StringIO()) as output:
                v.main([command])
                self.assertEqual(json.loads(output.getvalue())['version'], v.VERSION)


@unittest.skipIf(v3 is None, 'Existing v3 dependency typer unavailable; native seam not verified in this environment')
class NativeSeamTests(unittest.TestCase):
    def setUp(self):
        self.cases = v.load_cases()

    def test_all_frozen_cases_load_through_unchanged_v3_and_references_stay_out(self):
        self.assertEqual(v3.load_cases(v.SUITE / 'cases.json'), self.cases)
        for case in self.cases:
            request = v.request_for(case, {'kind':'tape','responses':[]})
            self.assertEqual(request['steps'], case['steps'])
            self.assertEqual(request['seed_files'], case.get('seed_files', {}))
            self.assertTrue(set(request) <= {'id','transport','steps','seed_files','limits','profile_name','learner_profile'})
            self.assertEqual(request['limits']['max_provider_calls'], 12)
            self.assertEqual(request['limits']['max_output_tokens'], 1024)

    def test_exact_limits_survive_projection_and_unsupported_controls_fail(self):
        transport = {'kind':'provider','provider':'fixture','model':'checkpoint-fixture'}
        request = v.request_for(self.cases[0], transport, max_provider_calls=9, max_output_tokens=700, max_tool_calls=5)
        self.assertEqual(request['limits'], {'max_provider_calls':9,'max_output_tokens':700,'max_tool_calls':5,'turn_timeout_ms':120000})
        for kwargs in ({'seed':0}, {'temperature':1}, {'max_provider_calls':False}, {'max_output_tokens':0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError): v.request_for(self.cases[0], transport, **kwargs)
        for bad in ({'kind':'unsupported'}, {**transport, 'temperature':1}, {**transport, 'apiKey':'not-allowed'}):
            with self.assertRaises(ValueError): v.request_for(self.cases[0], bad)

    def test_summary_keeps_unobserved_assessment_unknown(self):
        summary = v.summarize(self.cases[0], {'status':'failed','steps':[]}, 0)
        self.assertIsNone(summary['quality'])
        self.assertIsNone(summary['output_tokens'])
        self.assertIsNone(summary['cost_usd'])
        self.assertTrue(all(value is None for value in summary['assessment'].values()))

    def test_legacy_execution_is_delegated_without_running_or_writing(self):
        with patch.object(v3, 'run') as runner, patch.object(v3.b, 'write_json') as write:
            v.run(Path('/parent-owned-output'), tape_directory=Path('/parent-owned-tapes'), case_id=self.cases[0]['id'])
            self.assertEqual(runner.call_args.kwargs['case_id'], self.cases[0]['id'])
            self.assertEqual(runner.call_args.kwargs['suite'], v.SUITE)
            self.assertEqual(write.call_args.args[1]['measurement'], 'offline_integration')


@unittest.skipIf(v3 is None, 'Existing v3 review dependency unavailable')
class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.case = next(c for c in v.load_cases() if c['id'] == 'memory-evidence-correction-forget')
        self.result = {'id':self.case['id'], 'status':'completed', 'measurement':'model_episode', 'steps':[]}
        for i, step in enumerate(self.case['steps']):
            content = '{"fixture":"active-state-only"}'
            self.result['steps'].append({'index':i, 'kind':step['kind'], 'status':'completed', 'message_start_index':1,
                'messages':[{'role':'assistant','content':'Old response'}, {'role':'user','content':'Learner fixture'},
                            {'role':'assistant','content':'Visible response fixture.', 'stopReason':'stop'}],
                'files':[{'path':'.keating/profiles/learner.json','content':content,'sha256':v.digest(content)}]})
        self.review = {'reviewer_kind':'human','reviewer_id':'validator-fixture-not-a-real-review','ratings':[]}
        for rule in self.case['rubric']:
            evidence = [{'kind':'quote','step_index':i,'message_index':2,'quote':'Visible response'} for i in rule['evidence_steps']]
            rating = {'dimension':rule['dimension'],'score':2,'reason':'Protocol fixture only, not a semantic evaluation.',
                      'evidence':evidence[0], 'additional_evidence':evidence[1:]}
            if rule['evidence_type'] == 'persisted_state':
                rating['state_evidence'] = [{'step_index':i,'path':'.keating/profiles/learner.json',
                    'sha256':self.result['steps'][i]['files'][0]['sha256'],'observation':'Fixture state binding, not semantic truth.'}
                    for i in rule['evidence_steps']]
            self.review['ratings'].append(rating)
        self.bind()

    def bind(self):
        self.review.update(case_sha256=v.digest(v.canonical(self.case)), result_sha256=v.digest(v.canonical(self.result)))

    def validate(self):
        return v.validate_review(self.case, self.result, self.review)

    def test_complete_protocol_and_explicit_abstention(self):
        self.assertIsInstance(self.validate(), (int,float))
        self.review['ratings'][0] = {'dimension':self.case['rubric'][0]['dimension'],'score':None,
                                    'reason':'Evidence unavailable','uncertainty':'Fixture unavailable'}
        self.assertIsNone(self.validate())
        self.review['ratings'][0].pop('uncertainty')
        with self.assertRaisesRegex(ValueError, 'uncertainty'): self.validate()

    def test_missing_malformed_duplicate_out_of_range_scores(self):
        original = copy.deepcopy(self.review)
        for value in (-1,3,True,1.5,'2'):
            self.review = copy.deepcopy(original)
            self.review['ratings'][0]['score'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'Invalid rubric score'): self.validate()
        self.review = copy.deepcopy(original)
        self.review['ratings'].pop()
        with self.assertRaisesRegex(ValueError, 'coverage'): self.validate()
        self.review = copy.deepcopy(original)
        self.review['ratings'][1] = self.review['ratings'][0]
        with self.assertRaisesRegex(ValueError, 'coverage'): self.validate()
        self.review = copy.deepcopy(original)
        self.review['ratings'][0] = 'not-an-object'
        with self.assertRaisesRegex(ValueError, 'Malformed'): self.validate()
        self.review = copy.deepcopy(original)
        self.review['ratings'][0].pop('score')
        with self.assertRaisesRegex(ValueError, 'Missing fields'): self.validate()

    def test_review_result_and_case_hashes_are_bound(self):
        self.result['steps'][0]['messages'][2]['content'] += ' Changed'
        with self.assertRaisesRegex(ValueError, 'hash binding'): self.validate()
        self.bind()
        self.case['title'] += ' Changed'
        with self.assertRaisesRegex(ValueError, 'hash binding'): self.validate()

    def test_reviews_cannot_use_future_prior_or_learner_text(self):
        original = copy.deepcopy(self.review)
        for change in ({'step_index':9}, {'message_index':0,'quote':'Old response'},
                       {'message_index':1,'quote':'Learner fixture'}, {'message_index':999}, {'quote':'invented text'}):
            self.review = copy.deepcopy(original)
            self.review['ratings'][0]['evidence'].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError): self.validate()

    def test_every_scoped_turn_required_not_just_best_later_reply(self):
        self.review['ratings'][0]['additional_evidence'] = []
        with self.assertRaisesRegex(ValueError, 'every scoped step'): self.validate()

    def test_temporal_receipts_and_missing_steps_rejected(self):
        self.result['steps'][0]['index'] = 1
        self.bind()
        with self.assertRaisesRegex(ValueError, 'temporal ordering'): self.validate()
        self.result['steps'].pop()
        self.bind()
        with self.assertRaisesRegex(ValueError, 'Missing result steps'): self.validate()

    def test_tapes_and_failed_episodes_cannot_receive_quality(self):
        for field, value in [('measurement','offline_integration'), ('status','failed')]:
            previous = self.result[field]
            self.result[field] = value
            self.bind()
            with self.assertRaisesRegex(ValueError, 'Only completed model'): self.validate()
            self.result[field] = previous

    def test_clipping_empty_or_thinking_only_is_unknown_not_missing_behavior(self):
        original = copy.deepcopy(self.result)
        for message in ({'role':'assistant','content':'Visible response fixture.','stopReason':'length'},
                        {'role':'assistant','content':''},
                        {'role':'assistant','content':[{'type':'thinking','text':'Visible response fixture.'}]}):
            self.result = copy.deepcopy(original)
            self.result['steps'][0]['messages'][2] = message
            self.bind()
            self.review['ratings'][0]['evidence'] = {'kind':'missing_behavior','step_index':0,'observation':'No usable reply'}
            with self.subTest(message=message), self.assertRaises(ValueError): self.validate()

    def test_persistence_needs_real_state_not_prose_or_fake_hash(self):
        rating = next(r for r in self.review['ratings'] if 'state_evidence' in r)
        state = rating.pop('state_evidence')
        with self.assertRaisesRegex(ValueError, 'actual state evidence'): self.validate()
        rating['state_evidence'] = state
        state[0]['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'State evidence hash'): self.validate()
        state[0]['sha256'] = self.result['steps'][3]['files'][0]['sha256']
        self.result['steps'][3]['files'] = []
        self.bind()
        with self.assertRaisesRegex(ValueError, 'Missing actual state'): self.validate()

    def test_missing_review_stays_unknown(self):
        suite = v.load_suite()
        files = {'v4-binding.json': {'manifest_sha256':suite['manifest_sha256'], 'source_hashes':suite['manifest']['files']},
                 'plan.json': {'cases_sha256':suite['manifest']['files']['cases.json'], 'cases':[self.case]}}
        with patch.object(v, 'read_json', side_effect=lambda path: files[path.name]), patch.object(Path, 'exists', return_value=False):
            row = v.review_run(Path('/run'), Path('/reviews'))['rows'][0]
            self.assertEqual(row['status'], 'missing_review')
            self.assertIsNone(row['quality'])


if __name__ == '__main__':
    unittest.main()
