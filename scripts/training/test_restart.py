import copy
import json
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
from prepare_restart import cases_from_catalog,corrupt,RUBRIC
from run_restart_sdpo import teacher_context,load_inputs,sha

class RestartDataTests(unittest.TestCase):
    def setUp(self):
        self.catalog=json.loads((Path(__file__).parent/'data/openui-conversations.json').read_text())
        self.cases=cases_from_catalog(self.catalog)
    def test_split_and_source_history_are_preserved(self):
        self.assertFalse({r['family'] for r in self.cases['train']}&{r['family'] for r in self.cases['validation']})
        originals={c['id']:c for c in self.catalog['conversations']}
        for r in self.cases['train']:
            self.assertEqual(r['history'],originals[r['source']['conversation']]['messages'][:r['source']['assistant_index']])
            self.assertIn(r['history'][-1]['role'],['user','tool'])
        self.assertEqual([r['kind'] for r in self.cases['train'][:4]],['begin','repair','cards','grade_quiz'])
    def test_teacher_hint_does_not_copy_target_or_claim_human_feedback(self):
        row=self.cases['train'][0]
        hint=teacher_context(row,RUBRIC,{'passed':False,'feedback':'Response is empty'})
        self.assertNotIn(row['reference']['content'],hint)
        self.assertIn('not a human rating',hint)
        self.assertIn('Response is empty',hint)
    def test_preference_mutation_preserves_positive(self):
        for row in self.cases['train']:
            original=copy.deepcopy(row['reference']);negative=corrupt(original)
            self.assertEqual(original,row['reference'])
            if negative is not None:self.assertNotEqual(negative,original)
    def test_direct_help_is_an_evaluation_control(self):
        row=next(r for r in self.cases['validation'] if r['kind']=='direct-help')
        self.assertIn('no quiz or questions yet',row['history'][0]['content'])
        self.assertNotIn(row,self.cases['train'])
    def test_restart_cannot_swap_ledger_or_leak_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            p=Path(temporary);prompt=p/'system-prompt.txt';prompt.write_text('default')
            (p/'tool-schemas.json').write_text('[]')
            budget=p/'budget.json';budget.write_text(json.dumps({'model':'thinkingmachines/Inkling-Small','cap_usd':100,'reserved_usd':89}))
            owner=p/'owner.json';owner.write_text(json.dumps({'model':'thinkingmachines/Inkling-Small','owner_did':'did:web:example.test','budget_file':str(budget)}))
            data=copy.deepcopy(self.cases)
            for split in data:
                for r in data[split]:r.pop('reference',None)
            (p/'cases.json').write_text(json.dumps(data))
            manifest={'files':{'cases.json':sha(p/'cases.json')},'system_prompt_sha256':sha(prompt),'tools_sha256':sha(p/'tool-schemas.json')}
            (p/'manifest.json').write_text(json.dumps(manifest))
            with patch('run_restart_sdpo.verified_prompt_revision'):
                load_inputs(p,prompt,owner,budget,4)
                other=p/'other-budget.json';other.write_text(budget.read_text())
                with self.assertRaisesRegex(ValueError,'Never reset'):load_inputs(p,prompt,owner,other,4)
                data['validation'][0]['family']=data['train'][0]['family']
                (p/'cases.json').write_text(json.dumps(data))
                manifest['files']['cases.json']=sha(p/'cases.json');(p/'manifest.json').write_text(json.dumps(manifest))
                with self.assertRaisesRegex(ValueError,'Family overlap'):load_inputs(p,prompt,owner,budget,4)
                (p/'cases.json').write_text('{}')
                with self.assertRaisesRegex(ValueError,'Dataset hash'):load_inputs(p,prompt,owner,budget,4)

if __name__=='__main__':unittest.main()
