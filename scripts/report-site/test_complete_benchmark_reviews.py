import copy
import unittest
import complete_benchmark_reviews as c

class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.case={'id':'test','rubric':{'correctness':{'zero':'Wrong','one':'Partial','two':'Correct'}}}
        self.transcript=[{'role':'assistant','content':'Two.'}]
        self.row={'case_id':'test','quality':None,'stop':'final_response','transcript':self.transcript,'review':{'status':'error'}}
        self.data={'cases':[self.case],'models':[{'id':'model','rows':[self.row]}]}
        self.review={'model_id':'model','case_id':'test','status':'reviewed','reviewer_kind':'codex_subagent',
            'transcript_sha256':c.b.digest(c.b.canonical(self.transcript)), 'case_sha256':c.b.digest(c.b.canonical(self.case)),
            'quality':100,'ratings':[{'dimension':'correctness','score':2,'reason':'Correct result.',
            'support':'self_contained_reasoning','uncertainty':None,'evidence':{'kind':'quote','quote':'Two.',
                'transcript_index':0,'observation':'The candidate answers two.'}}]}
        self.registry={'records':[self.review],'assignment_count':1}
    def test_preserves_original_review_and_attributes_supplement(self):
        result=c.apply_reviews(self.data,self.registry)
        row=result['models'][0]['rows'][0]
        self.assertEqual(row['review'],self.row['review']);self.assertIsNone(row['quality_api'])
        self.assertEqual(row['quality_source'],'codex-subagent');self.assertEqual(row['quality'],100)
        self.assertNotIn('quality_api',self.row)
    def test_reapplication_drops_old_derived_supplements(self):
        applied=c.apply_reviews(self.data,self.registry)
        cleared=c.apply_reviews(applied,{'records':[],'assignment_count':0})
        row=cleared['models'][0]['rows'][0]
        self.assertIsNone(row['quality']);self.assertIsNone(row['quality_supplemental'])
        self.assertNotIn('supplemental_review',row)
        self.assertEqual(cleared['review_completion']['combined_scored'],0)

    def test_rejects_forged_score_or_evidence(self):
        self.review['quality']=50
        with self.assertRaises(ValueError):c.apply_reviews(self.data,self.registry)
        self.review['quality']=100;self.review['ratings'][0]['evidence']['quote']='Three.'
        with self.assertRaises(ValueError):c.apply_reviews(self.data,self.registry)
    def test_never_overwrites_accepted_api_reviews_or_fabricates_provider_outputs(self):
        self.row['quality']=50
        with self.assertRaises(ValueError):c.apply_reviews(self.data,self.registry)
        self.row['quality']=None;self.row['stop']='provider_error'
        with self.assertRaises(ValueError):c.apply_reviews(self.data,self.registry)

if __name__=='__main__':unittest.main()
