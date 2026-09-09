import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from run_openui_sft import load_data,sha
from pilot_budget import PilotBudget
class DataBoundaryTests(unittest.TestCase):
 def fixture(self,root):
  prompt=root/'system-prompt.txt';prompt.write_text('Application prompt');tools=[{'type':'function','function':{'name':'grade_quiz'}}];(root/'tool-schemas.json').write_text(json.dumps(tools))
  manifest={'schema_version':2,'base_model':PilotBudget.MODEL,'system_prompt_sha256':sha(prompt.read_bytes()),'tool_schemas_sha256':sha((root/'tool-schemas.json').read_bytes()),'counts':{'train':1,'validation':1},'output_sha256':{}}
  for split in ['train','validation']:
   row={'family':split,'tools':tools,'messages':[{'role':'system','content':'Application prompt'}]+[{'role':'user' if i%2==0 else 'assistant','content':'Example'} for i in range(20)]}
   body=(json.dumps(row)+'\n').encode();(root/f'{split}.jsonl').write_bytes(body);manifest['output_sha256'][f'{split}.jsonl']=sha(body)
  (root/'manifest.json').write_text(json.dumps(manifest));return prompt
 def test_corruption_and_context_changes_are_rejected(self):
  with tempfile.TemporaryDirectory() as directory,patch('run_openui_sft.verified_prompt_revision'):
   root=Path(directory);prompt=self.fixture(root);self.assertEqual(len(load_data(root,prompt)[0]['train']),1)
   (root/'train.jsonl').write_text('tampered')
   with self.assertRaisesRegex(ValueError,'bytes changed'):load_data(root,prompt)
   prompt=self.fixture(root);prompt.write_text('Different prompt')
   with self.assertRaisesRegex(ValueError,'Prompt hash'):load_data(root,prompt)
 def test_a_rehashed_split_cannot_leak_families_or_restore_legacy_creation(self):
  for mutation in ['family','tool']:
   with tempfile.TemporaryDirectory() as directory,patch('run_openui_sft.verified_prompt_revision'):
    root=Path(directory);prompt=self.fixture(root);row=json.loads((root/'validation.jsonl').read_text())
    if mutation=='family':row['family']='train'
    else:row['messages'][-1]['tool_calls']=[{'function':{'name':'deck','arguments':'{}'}}]
    body=(json.dumps(row)+'\n').encode();(root/'validation.jsonl').write_bytes(body);manifest=json.loads((root/'manifest.json').read_text());manifest['output_sha256']['validation.jsonl']=sha(body);(root/'manifest.json').write_text(json.dumps(manifest))
    with self.assertRaises(ValueError):load_data(root,prompt)
if __name__=='__main__':unittest.main()
