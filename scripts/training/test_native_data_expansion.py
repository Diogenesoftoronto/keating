"""Authored data contracts: no external inference or source data."""
from copy import deepcopy
import unittest
import native_data_expansion as data

def fixture():
    packet={'sources':[{'scenario_id':'authored-1','opening_message':'A basket has 9 blue and 4 red balls. How many balls?'}]}
    rows=[]
    for slot in range(1,11):
        fit='overhelp' if slot==1 else 'appropriate'
        response='Nine plus four gives thirteen.'
        rows.append({'slot':slot,'prefix':[{'role':'user','content':'I am adding the colors together.' if slot==1 else 'I subtracted again and still got five.'}],
            'response':response,'fit':fit,'need':'space' if slot==1 else 'explanation','substantive':True,'correct':True,
            'grade':0 if slot==1 else 2,'spans':[{'text':response,'move':'explanation'}],'rationale':'Authored structural fixture.'})
    draft=[{'scenario_id':'authored-1','status':'ready','reason':'Complete authored word problem.','topic':'addition',
        'practice_prompt':packet['sources'][0]['opening_message'],'examples':rows}]
    return packet,draft

class DataExpansionTests(unittest.TestCase):
    def test_exact_response_is_conditioned_on_different_evidence(self):
        packet,draft=fixture();data.validate_draft(draft,packet)
        draft[0]['examples'][1]['response']='A different answer.'
        draft[0]['examples'][1]['spans']=[{'text':'A different answer.','move':'answer'}]
        with self.assertRaisesRegex(ValueError,'Context flip'):data.validate_draft(draft,packet)

    def test_missing_source_duplicate_slot_and_private_prompt_rejected(self):
        for mode in ['missing','duplicate','private']:
            packet,draft=fixture()
            if mode=='missing':draft=[]
            if mode=='duplicate':draft[0]['examples'][-1]['slot']=1
            if mode=='private':draft[0]['practice_prompt']='PRIVATE_ANSWER_KEY'
            with self.assertRaises(ValueError):data.validate_draft(draft,packet)

    def test_unknown_stays_missing_and_cannot_be_positive(self):
        packet,draft=fixture();e=draft[0]['examples'][8]
        e.update(fit='unknown',need='unknown',grade=None)
        data.validate_draft(draft,packet)
        member={'family':'authored-family','aliases':['same-problem'],'split':'test'}
        records=data.projections(e,packet['sources'][0],member)
        self.assertTrue(all(not r['labels'] for r in records))
        e['grade']=2
        with self.assertRaisesRegex(ValueError,'Grade'):data.validate_draft(draft,packet)

    def test_need_view_has_no_response_or_action_labels(self):
        packet,draft=fixture();e=draft[0]['examples'][1]
        e['response']='RESPONSE_ONLY_SENTINEL'
        e['spans']=[{'text':e['response'],'move':'explanation'}]
        member={'family':'authored-family','aliases':['same-problem'],'split':'calibration'}
        need,action=data.projections(e,packet['sources'][0],member)
        self.assertNotIn(e['response'],data.observer.boundary_view(need)['text'])
        self.assertIn(e['response'],data.observer.boundary_view(action)['text'])
        self.assertTrue(all(k.startswith('need.') for k in need['labels']))
        self.assertNotIn('rationale',data.observer.boundary_view(action)['text'])
        self.assertEqual(action['split'],'calibration')
        self.assertEqual(action['group_ids'],['same-problem'])
        self.assertFalse(any('receipt_id' in event for event in action['events']))

    def test_bad_or_ambiguous_localization_fails(self):
        packet,draft=fixture()
        draft[0]['examples'][2]['spans'][0]['text']='not in response'
        with self.assertRaisesRegex(ValueError,'Span'):data.validate_draft(draft,packet)

    def test_deferred_source_is_not_silently_completed(self):
        packet,draft=fixture();draft[0].update(status='deferred',practice_prompt='',examples=[])
        data.validate_draft(draft,packet)
        draft[0]['practice_prompt']='A basket'
        with self.assertRaisesRegex(ValueError,'Deferred'):data.validate_draft(draft,packet)


class TeachingExportTests(unittest.TestCase):
    def test_appropriate_restraint_is_positive_without_claiming_substance(self):
        packet,draft=fixture();example=draft[0]['examples'][7]
        example.update(need='space',substantive=False,grade=1,response='That sum is set up correctly; carry on.',
            spans=[{'text':'That sum is set up correctly','move':'feedback'}])
        source={**packet['sources'][0],'source':{'dataset':'authored'}}
        row={'id':'authored-8','family':'authored-family','split':'train','example':example,
            'review':{'hash':'reviewed'}}
        candidate=data.sft_candidate(row,source)
        self.assertIsNotNone(candidate)
        self.assertFalse(candidate['teaching']['substantive'])
        _,action=data.projections(example,source,{'family':'authored-family','aliases':[],'split':'train'})
        self.assertEqual(action['labels']['fit.appropriate'],1)
        self.assertEqual(action['labels']['help.substantive_appropriate'],0)
        self.assertEqual(action['labels']['help.substantive'],0)
        self.assertNotIn('help.appropriate',action['labels'])

    def test_earlier_assistant_failures_never_become_sft_targets(self):
        packet,draft=fixture();example=draft[0]['examples'][1]
        example['prefix']=[{'role':'assistant','content':'EARLIER_UNAPPROVED'},
            {'role':'user','content':'That did not help me.'}]
        row={'id':'authored-2','family':'authored-family','split':'train','example':example,
            'review':{'hash':'reviewed'}}
        candidate=data.sft_candidate(row,{**packet['sources'][0],'source':{'dataset':'authored'}})
        weights=candidate['supervision']['message_weights']
        self.assertEqual([m['content'] for m,w in zip(candidate['messages'],weights) if w], [example['response']])
        self.assertEqual(weights,[0,0,0,1])
        self.assertEqual(candidate['supervision']['target_message_index'],3)
        self.assertEqual(candidate['supervision']['tokenization_status'],'not_prepared')

    def test_holdouts_unknown_and_mismatched_help_are_not_sft(self):
        packet,draft=fixture()
        for split,slot in [('test',1),('calibration',1),('train',0),('train',8)]:
            example=deepcopy(draft[0]['examples'][slot])
            if slot==8:example.update(fit='unknown',need='unknown',grade=None)
            row={'id':'authored','family':'family','split':split,'example':example,'review':{'hash':'reviewed'}}
            self.assertIsNone(data.sft_candidate(row,{**packet['sources'][0],'source':{}}))

    def test_localization_targets_survive_without_leaking_into_observer_input(self):
        packet,draft=fixture();example=draft[0]['examples'][6]
        example.update(response='9 + 4 = 13. You have mastered all mathematics.',fit='misdirected',correct=False,grade=0,
            spans=[{'text':'9 + 4 = 13.','move':'feedback'},
                {'text':'You have mastered all mathematics.','move':'claim'}])
        need,action=data.projections(example,packet['sources'][0],{'family':'authored','aliases':[],'split':'test'})
        self.assertEqual(need['annotation_spans'],[])
        self.assertEqual(len(action['annotation_spans']),2)
        for span in action['annotation_spans']:
            self.assertEqual(example['response'][span['start']:span['end']],span['text'])
        # Targets must not select the hidden gold location during extraction.
        self.assertEqual(action['spans'][0]['end'],len(example['response']))
        original_view=data.observer.boundary_view(action)
        action['annotation_spans'][1]['move']='other'
        self.assertEqual(data.observer.boundary_view(action),original_view)


class MembershipTests(unittest.TestCase):
    def fixture(self):
        parents = {identity: {'id':identity, 'family':'family-'+identity,
            'source':{'sha256':'source-'+identity},
            'actor':{'opening_message':'Visible task '+identity},
            'evaluation_only':{'origin':{'aliases':['alias-'+identity]},
                'admission':{'protected':False}}} for identity in ['a','b']}
        packets = [{'sources':[{'scenario_id':p['id'], 'source':p['source'],
            'family':p['family'], 'opening_message':p['actor']['opening_message']}
            for p in parents.values()]}]
        manifest = {'families':{identity:{'family':p['family'], 'source':p['source'],
            'aliases':sorted(data.aliases(p)), 'split':'train' if identity=='a' else 'test'}
            for identity,p in parents.items()}, 'excluded_aliases':[],
            'partition_groups':{'train':1,'test':1}}
        return manifest, parents, packets

    def test_disjoint_source_bound_packets_pass(self):
        data.validate_membership(*self.fixture())

    def test_connected_family_cannot_cross_partitions(self):
        manifest, parents, packets = self.fixture()
        parents['b']['evaluation_only']['origin']['aliases'].append('alias-a')
        all_names = sorted(data.aliases(parents['a']) | data.aliases(parents['b']))
        for member in manifest['families'].values():
            member['aliases'] = all_names
        with self.assertRaisesRegex(ValueError, 'selected more than once'):
            data.validate_membership(manifest, parents, packets)

    def test_exclusion_applies_through_alias(self):
        manifest, parents, packets = self.fixture()
        manifest['excluded_aliases'] = ['alias-a']
        with self.assertRaisesRegex(ValueError, 'previously measured'):
            data.validate_membership(manifest, parents, packets)

    def test_public_packet_cannot_replace_source_or_include_private_fields(self):
        for mode in ['changed', 'private']:
            manifest, parents, packets = self.fixture()
            source = packets[0]['sources'][0]
            if mode == 'changed': source['opening_message'] = 'Substituted task'
            else: source['answer_key'] = 'PRIVATE'
            with self.assertRaisesRegex(ValueError, 'differs from admitted source'):
                data.validate_membership(manifest, parents, packets)

if __name__=='__main__':unittest.main()
