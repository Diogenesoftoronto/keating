"""Authored review fixtures only: no real generations, tokenizer downloads or providers."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import observer_generation_job as generation
import observer_generation_review as review


class Tokens:
    """Reversible authored characters, with deliberately visible special output tokens."""
    def __init__(self):
        self.decoded = []

    def __call__(self, text, **kwargs):
        assert kwargs == {'return_offsets_mapping': True, 'add_special_tokens': False, 'truncation': False}
        return {'input_ids': list(map(ord, text)), 'attention_mask': [1] * len(text)}

    def decode(self, ids, **kwargs):
        assert kwargs == {'skip_special_tokens': False, 'clean_up_tokenization_spaces': False}
        self.decoded.append(list(ids))
        return ' \n' + ''.join({201: 'Fixture  ', 202: 'text', 203: 'change', 204: 'longer', 0: '<eos>'}[i] for i in ids)


def fixture():
    job = {'job_sha256': 'a' * 64, 'experiment': {'records': []},
           'generation_spec': {'generation_record_ids': []},
           'inventory': {'assets': [{'roles': ['tokenizer'], 'filename': 'tokenizer.json', 'sha256': 'b' * 64}]}}
    join = {'join_sha256': 'c' * 64, 'records': {}}
    protocol = {'schema_version': 1, 'job_sha256': job['job_sha256'], 'outputs_inspected': False,
                'conditions': list(review.CONDITIONS), 'cases': []}
    imported = {'complete': True, 'validated_completed_trials': 8,
                'local_join': {'local_joined_sha256': 'd' * 64},
                'result': {'result_sha256': 'e' * 64, 'rows': []}}
    for n in range(1, 9):
        rid, cid = f'record-opaque-{n}', f'fh{n:02}'
        text = f'  Authored learner {n}: café.\nLeave this whitespace. '
        case = {'id': cid, 'category': 'hint' if n <= 4 else 'worked' if n <= 6 else 'retention',
                'family_id': f'family-{n}', 'opening_message': text,
                'criteria': [{'id': key, 'description': 'Frozen ' + key + ' criterion.'} for key in review.CRITERIA],
                'reference': 'PRIVATE GOLD', 'evaluation_only': {'secret': 'PRIVATE FUTURE'}}
        protocol['cases'].append(case)
        record = {'record_id': rid, 'family_id': f'uploaded-family-{n}', 'boundary': 'pre_action',
                  'latest_allowed_event_id': 'learner',
                  'events': [{'event_id': 'learner', 'phase': 'pre_action', 'kind': 'learner_message',
                              'visibility': 'public', 'text': text}],
                  'spans': [{'event_id': 'learner', 'start': 0, 'end': len(text)}]}
        job['experiment']['records'].append(record)
        job['generation_spec']['generation_record_ids'].append(rid)
        join['records'][rid] = {'record_id': 'gen-' + cid, 'family_id': 'fresh-' + case['family_id'], 'split': 'test'}
        prompt = list(map(ord, generation.prompt_view(record)['text']))
        conditions = {}
        sequences = [[201, 202, 0], [201, 203, 0], [201, 202, 0], [201, 202, 204], [201, 0]]
        for condition, ids in zip(review.CONDITIONS, sequences):
            conditions[condition] = {'input_ids': [prompt], 'attention_mask': [[1] * len(prompt)],
                'rows': [{'prompt_ids': prompt, 'used_prompt_ids': prompt, 'dropped_prompt_ids': [],
                          'generated_ids': ids, 'sequence_ids': prompt + ids,
                          'stop_reason': 'eos' if ids[-1] == 0 else 'max_new_tokens'}]}
        imported['result']['rows'].append({'record_id': rid, 'controls': {'conditions': conditions}})
    return job, join, protocol, imported


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.job, self.join, self.protocol, self.imported = fixture()
        for name, value in [('job', self.job), ('join', self.join), ('protocol', self.protocol)]:
            (self.root / (name + '.json')).write_text(json.dumps(value))
        self.body = b'authored archive contract double; never live generation'
        (self.root / 'outputs.tar').write_bytes(self.body)
        self.imported['archive_sha256'] = hashlib.sha256(self.body).hexdigest()
        self.tokens = Tokens()
        self.reader = patch.object(generation, 'import_outputs', return_value=self.imported).start()
        self.loader = patch.object(generation, 'cached_tokenizer', return_value=self.tokens).start()
        self.addCleanup(patch.stopall)

    def prepare(self, name='bundle', **kwargs):
        return review.prepare(self.root / 'job.json', self.root / 'join.json', self.root / 'protocol.json',
                              self.root / 'outputs.tar', self.root / name, cache_dir=self.root / 'cache', **kwargs)

    def data(self, relative):
        return json.loads((self.root / relative).read_text())

    def save(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def reviews(self):
        packet = self.data('bundle/blind-packet.json')
        return [{'reviewer': name, 'rows': [{'id': r['id'], 'criteria': {
            key: {'verdict': 'pass', 'reason': name + ' exact original reason ' + key}
            for key in review.CRITERIA}} for r in packet['rows']]} for name in ('A', 'B')]

    def summarize(self, a, b, name='summary'):
        self.save('a.json', a)
        self.save('b.json', b)
        return review.summarize(self.root / 'bundle', self.root / 'a.json', self.root / 'b.json', self.root / name)

    def test_blinding_exact_identity_and_determinism(self):
        self.prepare()
        self.reader.assert_called_once_with(self.job, self.join, self.body)
        self.loader.assert_called_once_with(self.job, None, self.root / 'cache')
        packet = self.data('bundle/blind-packet.json')
        decoded = self.data('bundle/private/decoded-results.json')['rows']
        self.assertEqual(set(packet), {'rows'})
        self.assertEqual(len(packet['rows']), 40)
        self.assertEqual(len({r['id'] for r in decoded}), 40)
        original_order = [(f'fh{n:02}', condition) for n in range(1, 9) for condition in review.CONDITIONS]
        self.assertNotEqual([(r['case_id'], r['condition']) for r in decoded], original_order)
        for blind, full in zip(packet['rows'], decoded):
            self.assertEqual(set(blind), {'id', 'learner_prompt', 'criteria', 'raw_output'})
            self.assertRegex(blind['id'], r'^r-[0-9a-f]{32}$')
            self.assertEqual(blind['raw_output'], full['raw_output'])
            case = next(c for c in self.protocol['cases'] if c['id'] == full['case_id'])
            self.assertEqual(blind['learner_prompt'], case['opening_message'])
            self.assertEqual(blind['criteria'], {r['id']: r['description'] for r in case['criteria']})
            self.assertEqual(''.join(map(chr, full['prompt_ids'])), full['serialized_prompt'])
            self.assertEqual(full['generated_token_count'], len(full['generated_ids']))
            self.assertTrue(full['raw_output'].startswith(' \nFixture  '))
            if full['stop_reason'] == 'eos':
                self.assertTrue(full['raw_output'].endswith('<eos>'))
            self.assertEqual(full['identical_to_baseline'], full['condition'] in ('baseline', 'selected_negative'))
            self.assertEqual(full['first_divergent_position'], {
                'baseline': None, 'selected_negative': None, 'selected_positive': 1, 'random': 2, 'unrelated': 1}[full['condition']])
        serialized = json.dumps(packet)
        for secret in ('PRIVATE GOLD', 'PRIVATE FUTURE', 'selected_positive', 'record-opaque', 'gen-fh', 'job_sha256'):
            self.assertNotIn(secret, serialized)
        self.prepare('again')
        for file in review.BUNDLE_FILES:
            self.assertEqual((self.root / 'bundle' / file).read_bytes(), (self.root / 'again' / file).read_bytes())
        (self.root / 'outputs.tar').write_bytes(self.body + b' another job')
        self.imported['archive_sha256'] = hashlib.sha256(self.body + b' another job').hexdigest()
        self.prepare('different')
        self.assertTrue({r['id'] for r in packet['rows']}.isdisjoint({r['id'] for r in self.data('different/blind-packet.json')['rows']}))

    def test_strict_prefix_divergence(self):
        self.assertEqual(review._first_divergence([1, 2, 3], [1, 2]), 2)
        self.assertEqual(review._first_divergence([1, 2], [1, 2, 3]), 2)
        self.assertEqual(review._first_divergence([1], [9]), 0)
        self.assertIsNone(review._first_divergence([1, 2], [1, 2]))

    def test_invalid_or_incomplete_archive_never_loads_tokenizer_or_writes(self):
        for changes in ({'complete': False}, {'validated_completed_trials': 7}, {'result': None}):
            with self.subTest(changes=changes), patch.object(generation, 'import_outputs', return_value={**self.imported, **changes}):
                with self.assertRaisesRegex(ValueError, 'COMPLETE'):
                    self.prepare()
        self.reader.side_effect = ValueError('worker rejects corrupted archive')
        with self.assertRaisesRegex(ValueError, 'corrupted'):
            self.prepare()
        self.loader.assert_not_called()
        self.assertEqual(self.tokens.decoded, [])
        self.assertFalse((self.root / 'bundle').exists())

    def test_unmapped_records_or_frozen_prompt_change_reject_before_decode(self):
        rid = self.job['generation_spec']['generation_record_ids'][0]
        for local in ({**self.join['records'][rid], 'record_id': 'gen-fh99'},
                      {**self.join['records'][rid], 'family_id': 'another-family'}):
            bad = deepcopy(self.join)
            bad['records'][rid] = local
            self.save('join.json', bad)
            with self.assertRaises(ValueError):
                self.prepare()
        self.save('join.json', self.join)
        self.protocol['cases'][0]['opening_message'] += ' CHANGED'
        self.save('protocol.json', self.protocol)
        with self.assertRaisesRegex(ValueError, 'Exact learner prompt'):
            self.prepare()
        self.loader.assert_not_called()

    def test_last_row_prompt_mismatch_blocks_all_decoding(self):
        out = self.imported['result']['rows'][-1]['controls']['conditions']['unrelated']['rows'][0]
        out['used_prompt_ids'] = [123]
        with self.assertRaisesRegex(ValueError, 'pinned tokenizer prompt'):
            self.prepare()
        self.assertEqual(self.tokens.decoded, [])
        self.assertFalse((self.root / 'bundle').exists())

    def test_missing_duplicate_extra_conditions_reject(self):
        original = deepcopy(self.imported['result']['rows'])
        mutations = [lambda rows: rows.pop(), lambda rows: rows.__setitem__(-1, deepcopy(rows[0])),
                     lambda rows: rows[-1]['controls']['conditions'].pop('random'),
                     lambda rows: rows[-1]['controls']['conditions'].update(unexpected={})]
        for mutate in mutations:
            self.imported['result']['rows'] = deepcopy(original)
            mutate(self.imported['result']['rows'])
            with self.assertRaises(ValueError):
                self.prepare()
        self.assertEqual(self.tokens.decoded, [])

    def test_reviews_require_exact_ids_criteria_and_unique_reviewers(self):
        self.prepare()
        a, b = self.reviews()
        mutations = [lambda x: x['rows'].pop(), lambda x: x['rows'].append(deepcopy(x['rows'][0])),
                     lambda x: x['rows'].__setitem__(-1, deepcopy(x['rows'][0])),
                     lambda x: x['rows'][0].update(id='unmapped'),
                     lambda x: x['rows'][0]['criteria'].pop('correctness'),
                     lambda x: x['rows'][0]['criteria'].update(extra={'verdict': 'pass', 'reason': 'bad'}),
                     lambda x: x['rows'][0]['criteria']['correctness'].update(verdict='maybe'),
                     lambda x: x['rows'][0]['criteria']['correctness'].update(reason='  '),
                     lambda x: x.update(reviewer='A')]
        for mutate in mutations:
            bad = deepcopy(b)
            mutate(bad)
            with self.assertRaises(ValueError):
                self.summarize(a, bad)
        self.assertFalse((self.root / 'summary').exists())

    def test_disagreement_stays_unknown_with_reasons_and_full_denominators(self):
        self.prepare()
        a, b = self.reviews()
        decoded = self.data('bundle/private/decoded-results.json')['rows']
        target = next(r['id'] for r in decoded if r['case_id'] == 'fh01' and r['condition'] == 'baseline')
        rating = next(r for r in b['rows'] if r['id'] == target)['criteria']['request_match']
        rating.update(verdict='fail', reason='B: original failure reason retained verbatim.')
        b['rows'].reverse()  # Identity join, never positional pairing.
        result = self.summarize(a, b)['summary']
        row = next(r for r in result['rows'] if r['id'] == target)
        self.assertEqual(row['criteria']['request_match']['consensus']['verdict'], 'unknown')
        self.assertTrue(row['criteria']['request_match']['disagreement'])
        self.assertEqual(row['criteria']['request_match']['reviews'][1]['reason'], rating['reason'])
        self.assertEqual(row['all_three']['consensus']['verdict'], 'unknown')
        counts = next(t for t in result['primary']['counts'] if t['reviewer'] == 'consensus' and t['condition'] == 'baseline')
        self.assertEqual({k: counts[k] for k in ('numerator', 'denominator', 'fail', 'unknown', 'known_denominator')},
                         {'numerator': 3, 'denominator': 4, 'fail': 0, 'unknown': 1, 'known_denominator': 3})
        self.assertEqual(len(result['totals']), 3 * 5 * 4 * 4)
        for t in result['totals']:
            self.assertEqual(t['numerator'] + t['fail'] + t['unknown'], t['denominator'])
        self.assertEqual(len(result['primary']['counts']), 15)

    def test_both_unknown_is_agreement_not_failure(self):
        self.prepare()
        a, b = self.reviews()
        for value in (a, b):
            value['rows'][0]['criteria']['correctness']['verdict'] = 'unknown'
        row = self.summarize(a, b)['summary']['rows'][0]
        self.assertFalse(row['criteria']['correctness']['disagreement'])
        self.assertEqual(row['criteria']['correctness']['consensus']['verdict'], 'unknown')
        self.assertEqual(row['all_three']['consensus']['verdict'], 'unknown')

    def test_refuses_overwrite_and_modified_bundle(self):
        self.prepare()
        original = (self.root / 'bundle/private/audit.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            self.prepare()
        self.assertEqual((self.root / 'bundle/private/audit.json').read_bytes(), original)
        a, b = self.reviews()
        self.summarize(a, b)
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            self.summarize(a, b)
        with (self.root / 'bundle/blind-packet.json').open('ab') as stream:
            stream.write(b' ')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.summarize(a, b, 'changed')

    def test_duplicate_json_keys_reject(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            review._parse(b'{"reviewer":"A","reviewer":"B","rows":[]}')

    def test_partial_requires_opt_in_and_exports_only_verified_groups(self):
        self.imported.update(complete=False, validated_completed_trials=3)
        self.imported['result']['rows'] = self.imported['result']['rows'][:3]
        with self.assertRaisesRegex(ValueError, 'COMPLETE'):
            self.prepare()
        self.loader.assert_not_called()
        audit = self.prepare(allow_partial=True)
        self.reader.assert_called_with(self.job, self.join, self.body)
        self.assertFalse(audit['complete'])
        self.assertTrue(audit['bundle_complete'])
        self.assertTrue(audit['allow_partial'])
        self.assertEqual((audit['case_count'], audit['row_count']), (3, 15))
        packet = self.data('bundle/blind-packet.json')['rows']
        decoded = self.data('bundle/private/decoded-results.json')
        coverage = decoded['coverage']
        self.assertEqual(len(packet), 15)
        self.assertEqual(len(self.tokens.decoded), 15)
        self.assertEqual(coverage['completed_case_ids'], ['fh01', 'fh02', 'fh03'])
        self.assertEqual(coverage['missing_case_ids'], ['fh04', 'fh05', 'fh06', 'fh07', 'fh08'])
        self.assertEqual((coverage['planned_family_count'], coverage['planned_response_count']), (8, 40))
        self.assertEqual((coverage['completed_family_count'], coverage['observed_response_count']), (3, 15))
        self.assertEqual((coverage['missing_family_count'], coverage['missing_response_count']), (5, 25))
        self.assertIsNone(coverage['attempted_family_count'])
        self.assertIsNone(coverage['attempted_response_count'])
        self.assertEqual((coverage['attempted_family_lower_bound'], coverage['attempted_response_lower_bound']), (3, 15))
        for cid in coverage['completed_case_ids']:
            self.assertEqual({r['condition'] for r in decoded['rows'] if r['case_id'] == cid}, set(review.CONDITIONS))
        for row in packet:
            self.assertEqual(set(row), {'id', 'learner_prompt', 'criteria', 'raw_output'})
            self.assertNotIn('missing', row)

    def test_partial_summaries_have_no_phantom_rows_or_unknown_verdicts(self):
        self.imported.update(complete=False, validated_completed_trials=1)
        self.imported['result']['rows'] = self.imported['result']['rows'][:1]
        self.prepare(allow_partial=True)
        a, b = self.reviews()
        result = self.summarize(a, b)
        summary = result['summary']
        self.assertEqual(len(summary['rows']), 5)
        self.assertEqual({r['case_id'] for r in summary['rows']}, {'fh01'})
        self.assertEqual(summary['primary']['task_count'], 4)
        self.assertEqual(summary['primary']['planned_denominator'], 4)
        self.assertEqual(summary['primary']['observed_denominator'], 1)
        self.assertFalse(summary['coverage']['execution_complete'])
        self.assertFalse(result['audit']['complete'])
        self.assertFalse(any(k.endswith('_case_ids') for k in summary['coverage']))
        self.assertEqual(result['audit']['coverage']['missing_case_ids'], [f'fh{n:02}' for n in range(2, 9)])
        for t in summary['totals']:
            expected_observed = 1 if t['category'] in ('all', 'hint') else 0
            expected_planned = {'all': 8, 'hint': 4, 'worked': 2, 'retention': 2}[t['category']]
            self.assertEqual((t['numerator'], t['denominator']), (expected_observed, expected_observed))
            self.assertEqual(t['planned_denominator'], expected_planned)
            self.assertEqual(t['missing'], expected_planned - expected_observed)
            self.assertEqual((t['fail'], t['unknown']), (0, 0))
        # No invented review ID can be added even to represent missing execution.
        b['rows'].append({'id': 'phantom', 'criteria': deepcopy(b['rows'][0]['criteria'])})
        with self.assertRaises(ValueError):
            self.summarize(a, b, 'phantom-summary')

    def test_partial_opt_in_still_rejects_diagnostic_empty_invalid_and_cut_groups(self):
        original = deepcopy(self.imported)
        for changes in ({'complete': False, 'diagnostic_only': True},
                        {'complete': False, 'validated_completed_trials': 0},
                        {'complete': False, 'result': None},
                        {'complete': False, 'local_join': None},
                        {'complete': True, 'validated_completed_trials': 7},
                        {'complete': 0}):
            with patch.object(generation, 'import_outputs', return_value={**original, **changes}):
                with self.assertRaises(ValueError):
                    self.prepare(allow_partial=True)
        for mutate in (lambda x: x['result']['rows'][0]['controls']['conditions'].pop('random'),
                       lambda x: x['result']['rows'][0]['controls']['conditions']['random'].update(rows=[]),
                       lambda x: x['result']['rows'].reverse(),
                       lambda x: x['result']['rows'][0].update(record_id='unmapped'),
                       lambda x: x.update(validated_completed_trials=3)):
            bad = deepcopy(original)
            bad.update(complete=False, validated_completed_trials=2)
            bad['result']['rows'] = bad['result']['rows'][:2]
            mutate(bad)
            with patch.object(generation, 'import_outputs', return_value=bad):
                with self.assertRaises(ValueError):
                    self.prepare(allow_partial=True)
        self.reader.side_effect = ValueError('worker rejects tampered partial archive')
        with self.assertRaisesRegex(ValueError, 'tampered'):
            self.prepare(allow_partial=True)
        self.assertEqual(self.tokens.decoded, [])
        self.assertFalse((self.root / 'bundle').exists())

    def test_complete_with_partial_flag_preserves_blind_rows_and_full_denominators(self):
        self.prepare()
        self.prepare('opt-in', allow_partial=True)
        self.assertEqual(self.data('bundle/blind-packet.json'), self.data('opt-in/blind-packet.json'))
        a, b = self.reviews()
        summary = self.summarize(a, b)['summary']
        self.assertEqual(len(summary['rows']), 40)
        self.assertEqual(summary['primary']['observed_denominator'], 4)
        self.assertEqual(summary['coverage']['attempted_family_count'], 8)
        self.assertEqual(summary['coverage']['attempted_response_count'], 40)
        self.assertTrue(all(t['missing'] == 0 and t['denominator'] == t['planned_denominator'] for t in summary['totals']))

    def test_legacy_complete_bundle_still_summarizes(self):
        audit = self.prepare()
        values = {name: self.data('bundle/' + name) for name in review.BUNDLE_FILES}
        for name in ('private/mapping.json', 'private/decoded-results.json'):
            values[name].pop('coverage')
        for key in ('coverage', 'bundle_complete', 'allow_partial', 'audit_sha256', 'files_sha256'):
            audit.pop(key)
        review._write_bundle(self.root / 'legacy', values, audit)
        a, b = self.reviews()
        self.save('a.json', a)
        self.save('b.json', b)
        summary = review.summarize(self.root / 'legacy', self.root / 'a.json', self.root / 'b.json', self.root / 'legacy-summary')['summary']
        self.assertEqual(len(summary['rows']), 40)
        self.assertEqual(summary['coverage']['observed_response_count'], 40)

    def test_partial_cli_flag_is_explicit_and_defaults_false(self):
        command = ['prepare', 'job', 'join', 'protocol', 'archive', 'output', '--cache-dir', 'cache']
        with patch.object(review, 'prepare', return_value={'audit_sha256': 'fixture'}) as prepare, patch('builtins.print'):
            review.main(command)
            self.assertIs(prepare.call_args.kwargs['allow_partial'], False)
            review.main([*command, '--allow-partial'])
            self.assertIs(prepare.call_args.kwargs['allow_partial'], True)

    def test_import_is_stdlib_only_and_offline_settings_restore(self):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        code = "import sys; import observer_generation_review; assert not ({'torch','transformers','huggingface_hub','observer_generation_job','research_access','observer_runpod'} & set(sys.modules))"
        subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).parent, env=env, check=True, capture_output=True)
        before = dict(os.environ)
        with review._offline(self.root / 'cache'):
            self.assertEqual(os.environ['HF_HUB_OFFLINE'], '1')
            self.assertEqual(os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'], '1')
        self.assertEqual(dict(os.environ), before)


if __name__ == '__main__':
    unittest.main()
