import json
import unittest
import tempfile
import threading
from pathlib import Path
from benchmark_v3_review import compact_packet, review_model, review_one, validate_response, usage_receipt


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.case = {'rubric':[{'dimension':'teaching','evidence_steps':[0]}]}
        self.result = {'measurement':'model_episode','status':'completed','steps':[{
            'kind':'message','status':'completed','message_start_index':1,
            'messages':[{'role':'user','content':'scripted learner'},
                        {'role':'assistant','content':[{'type':'thinking','thinking':'private'},
                                                     {'type':'text','text':'Try explaining why.'}]}]}]}

    def raw(self, rating):
        return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'ratings':[rating]})}}]}

    def test_quote_indices_and_no_fabrication(self):
        rating = {'dimension':'teaching','score':2,'reason':'Asks for reasoning',
                  'evidence':{'kind':'quote','step_index':0,'message_index':1,'quote':'explaining why'}}
        receipt,score = validate_response(self.case,self.result,self.raw(rating),'kimi-k3')
        self.assertEqual(score,100)
        self.assertEqual(receipt['reviewer_kind'],'model_api')
        rating['evidence']['quote'] = 'invented quote'
        with self.assertRaisesRegex(ValueError,'Quote absent'):
            validate_response(self.case,self.result,self.raw(rating),'kimi-k3')
        rating['evidence'].update(message_index=0,quote='scripted learner')
        with self.assertRaisesRegex(ValueError,'new message'):
            validate_response(self.case,self.result,self.raw(rating),'kimi-k3')

    def test_abstention_and_full_coverage(self):
        rating = {'dimension':'teaching','score':None,'reason':'No readable reply','uncertainty':'Missing evidence'}
        self.assertIsNone(validate_response(self.case,self.result,self.raw(rating),'kimi-k3')[1])
        del rating['uncertainty']
        with self.assertRaisesRegex(ValueError,'uncertainty'):
            validate_response(self.case,self.result,self.raw(rating),'kimi-k3')
        rating['dimension'] = 'wrong'
        with self.assertRaisesRegex(ValueError,'coverage'):
            validate_response(self.case,self.result,self.raw(rating),'kimi-k3')

    def test_packet_keeps_original_indices_and_omits_thinking(self):
        packet = compact_packet(self.case,self.result,{})
        self.assertEqual(packet['steps'][0]['messages'][0]['message_index'],1)
        self.assertNotIn('private',json.dumps(packet))
        self.assertEqual(review_model('kimi-k3'),'deepseek-v4-flash')
        self.assertEqual(review_model('qwen3.6-35b'),'kimi-k3')

    def test_cost_cache_unknown_is_not_zero(self):
        metadata={'metadata':{'pricing':{'input_per_million':3,'output_per_million':15,'cached_input_per_million':0.3}}}
        raw={'usage':{'prompt_tokens':1000,'completion_tokens':100}}
        self.assertIsNone(usage_receipt(raw,metadata)['estimated_cost_usd'])
        raw['usage']['prompt_tokens_details']={'cached_tokens':500}
        self.assertAlmostEqual(usage_receipt(raw,metadata)['estimated_cost_usd'],0.00315)

    def test_capacity_stop_leaves_unstarted_case_available(self):
        stop = threading.Event()
        stop.set()
        with tempfile.TemporaryDirectory() as tmp:
            result = review_one(Path(tmp),{'id':'pending'},'https://unused.invalid','unused',{},stop)
            self.assertEqual(result['status'],'deferred_capacity')
            self.assertFalse((Path(tmp)/'api-reviews').exists())

    def test_malformed_rating_is_rejected_without_repair(self):
        with self.assertRaisesRegex(ValueError,'entries must be objects'):
            validate_response(self.case,self.result,self.raw('not a rating'),'kimi-k3')


if __name__ == '__main__': unittest.main()
