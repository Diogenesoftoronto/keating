import copy
import unittest
import benchmark_v3 as v

class V3Tests(unittest.TestCase):
    def test_reviewer_reference_never_reaches_tutor(self):
        case={'id':'test','steps':[{'kind':'message','text':'Explain.'}], 'rubric':['secret'], 'reference':{'facts':['answer key']},'state_checks':[]}
        request=v.request_for(case,{'kind':'tape','responses':[]})
        self.assertNotIn('rubric',request); self.assertNotIn('reference',request)
        self.assertEqual(request['steps'],case['steps'])

    def test_session_history_is_not_double_counted_and_cost_unknown(self):
        result={'status':'completed','measurement':'model_episode','requests':[{},{}],'steps':[
            {'state':{'sessionId':'one'},'messages':[{'role':'assistant','usage':{'output':5}}]},
            {'state':{'sessionId':'one'},'messages':[{'role':'assistant','usage':{'output':5}},{'role':'assistant','usage':{'output':7}}]},
            {'state':{'sessionId':'two'},'messages':[{'role':'assistant','usage':{'output':3}}]}]}
        row=v.summarize({'id':'test','category':'test'},result,1)
        self.assertEqual(row['output_tokens'],15); self.assertIsNone(row['quality']); self.assertIsNone(row['cost_usd'])

    def test_missing_step_is_unknown_not_failed_teaching(self):
        case={'id':'test','category':'test','state_checks':[{'after_step':1,'path':'.keating/state/goals.json','contains':'goal'}]}
        row=v.summarize(case,{'status':'failed'},1)
        self.assertIsNone(row['state_checks'][0]['passed']); self.assertIsNone(row['quality'])
        self.assertIsNone(row['output_tokens'])

    def test_reviews_cannot_score_tapes_or_quote_scripted_learner(self):
        case={'rubric':[{'dimension':'diagnosis','evidence_steps':[0]}]}
        result={'status':'completed','measurement':'model_episode','steps':[{'status':'completed','message_start_index':0,'messages':[{'role':'user','content':'I learned it.'}]}]}
        review={'reviewer_kind':'codex_subagent','reviewer_id':'test','case_sha256':v.b.digest(v.b.canonical(case)),
                'result_sha256':v.b.digest(v.b.canonical(result)), 'ratings':[{'dimension':'diagnosis','score':2,'reason':'Test',
                    'evidence':{'kind':'quote','step_index':0,'message_index':0,'quote':'I learned it.'}}]}
        with self.assertRaisesRegex(ValueError,'Learner script'):v.validate_review(case,result,review)
        result['measurement']='offline_integration'
        with self.assertRaisesRegex(ValueError,'Only completed model'):v.validate_review(case,result,review)

    def test_error_usage_zero_is_unknown(self):
        result={'status':'failed','steps':[{'state':{'sessionId':'one'},'messages':[{'role':'assistant','stopReason':'error','usage':{'output':0}}]}]}
        self.assertIsNone(v.summarize({'id':'test','category':'test'},result,1)['output_tokens'])

    def test_prior_turn_quote_cannot_support_later_turn_rating(self):
        case={'rubric':[{'dimension':'diagnosis','evidence_steps':[0]}]}
        result={'status':'completed','measurement':'model_episode','steps':[{'status':'completed','message_start_index':1,
            'messages':[{'role':'assistant','content':'A worked example.'},{'role':'assistant','content':'What do you think?'}]}]}
        review={'reviewer_kind':'codex_subagent','reviewer_id':'test','case_sha256':v.b.digest(v.b.canonical(case)),
                'result_sha256':v.b.digest(v.b.canonical(result)), 'ratings':[{'dimension':'diagnosis','score':2,'reason':'Test',
                    'evidence':{'kind':'quote','step_index':0,'message_index':0,'quote':'A worked example.'}}]}
        with self.assertRaisesRegex(ValueError,'new message'):v.validate_review(case,result,review)

    def test_custom_provider_registration_has_only_environment_reference(self):
        transport=v.provider_transport('neuralwatt','fixture','https://api.neuralwatt.com/v1','NEURALWATT_API_KEY',32768,4096)
        self.assertEqual(transport['apiKeyEnv'],'NEURALWATT_API_KEY')
        with self.assertRaises(ValueError):v.provider_transport('fixture','fixture','https://api.openai.com/v1','KEY',32768,4096)
        with self.assertRaises(ValueError):v.provider_transport('fixture','fixture','https://user:secret@example.com','KEY',32768,4096)

    def test_matched_context_conditions_stay_out_of_tutor_input(self):
        cases=v.load_cases()
        pairs={}
        for case in cases:
            if 'pair_id' not in case:continue
            pairs.setdefault(case['pair_id'],[]).append(case)
            request=v.request_for(case,{'kind':'tape','responses':[]})
            self.assertNotIn('pair_id',request);self.assertNotIn('contrast_condition',request)
            self.assertNotIn('reference',request)
        self.assertEqual(len(pairs),4)
        for pair in pairs.values():
            self.assertEqual(len(pair),2)
            self.assertEqual(pair[0]['steps'][-1],pair[1]['steps'][-1])
            if pair[0].get('learner_profile'):
                self.assertNotEqual(pair[0]['learner_profile'],pair[1]['learner_profile'])
                self.assertEqual(pair[0]['steps'],pair[1]['steps'])
            else:
                self.assertNotEqual(pair[0]['steps'][:-1],pair[1]['steps'][:-1])

    def test_static_suite_has_distinct_families_and_multi_turn_rubrics(self):
        cases=v.load_cases()
        self.assertEqual(len(cases),23)
        self.assertEqual(len({c['family'] for c in cases}),23)
        for case in cases:
            self.assertTrue(all(r['evidence_steps'] for r in case['rubric']))

if __name__=='__main__':unittest.main()
