import copy
import json
from pathlib import Path
import tempfile
import unittest
from prepare_user_interactions import extract,digest,sid_hash
from user_interaction_sdpo import hindsight_context,encode_interaction,logged_token_loss,load_dataset

def message(role,text,timestamp,**extra):
    return {'role':role,'content':[{'type':'text','text':text}],'timestamp':timestamp,**extra}

def fixture():
    sessions=[];families=[]
    for i in range(3):
        sid=f'session-{i}';messages=[message('user',f'Teach topic {i}',10),message('assistant',f'Explanation {i}',20,stopReason='stop'),message('user',f'Actual reply {i}',30)]
        sessions.append({'data':{'id':sid,'messages':messages}})
        families.append({'familyHash':sid_hash('keating-case-study-subject-family-v1\0'+sid),'sessionHashes':[sid_hash(sid)],'included':True,'subjectId':f'subject-{i}'})
    return {'sessions':sessions},{'families':families},{'validation_families':[families[0]['familyHash']],'train_families':[families[1]['familyHash']]}

class ExtractionTests(unittest.TestCase):
    def test_actual_next_user_is_preserved_and_withheld(self):
        portable,ledger,prior=fixture();rows,_=extract(portable,ledger,prior)
        self.assertEqual(len(rows),3)
        for row in rows:
            sid=row['source']['session_hash'];original=next(s['data'] for s in portable['sessions'] if sid_hash(s['data']['id'])==sid)
            self.assertEqual(row['response']['content'],original['messages'][1]['content'][0]['text'])
            self.assertEqual(row['next_user']['content'],original['messages'][2]['content'][0]['text'])
            self.assertNotIn(row['next_user'],row['history'])
            self.assertIn(row['next_user']['content'],hindsight_context(row))
        self.assertEqual(rows[0]['split'],'validation');self.assertEqual(rows[1]['split'],'train')

    def test_errors_and_noncausal_followups_are_excluded(self):
        p,l,prior=fixture();p['sessions'][1]['data']['messages'][1]['stopReason']='error'
        rows,excluded=extract(p,l,prior);self.assertEqual(len(rows),2);self.assertEqual(excluded['target_not_confirmed_complete'],1)
        p,l,prior=fixture();p['sessions'][1]['data']['messages'][2]['timestamp']=1
        rows,excluded=extract(p,l,prior);self.assertEqual(len(rows),2);self.assertEqual(excluded['noncausal_or_missing_timestamp'],1)

    def test_tool_results_remain_tools_and_reasoning_is_removed(self):
        p,l,prior=fixture();ms=p['sessions'][1]['data']['messages']
        ms[1]['content'].insert(0,{'type':'thinking','thinking':'PRIVATE_REASONING_MARKER'})
        ms[1:1]=[{'role':'assistant','content':[{'type':'toolCall','id':'call1','name':'lookup','arguments':{'q':'topic'}}],'timestamp':12},
            {'role':'toolResult','content':[{'type':'text','text':'Observed tool output'}],'toolCallId':'call1','toolName':'lookup','timestamp':15}]
        rows,_=extract(p,l,prior,context_messages=2);row=next(r for r in rows if r['source']['assistant_index']==3)
        self.assertEqual([m['role'] for m in row['history']],['user','assistant','tool'])
        self.assertEqual(row['history'][2]['tool_call_id'],'call1')
        self.assertNotIn('PRIVATE_REASONING_MARKER',json.dumps(rows))

    def test_copies_do_not_duplicate_training_signal(self):
        p,l,prior=fixture();sid='copy-session';copy_session=copy.deepcopy(p['sessions'][1]);copy_session['data'].update(id=sid,parentSessionId='session-1');p['sessions'].append(copy_session)
        f=l['families'][1];f['sessionHashes'].append(sid_hash(sid));f['familyHash']=sid_hash('keating-case-study-subject-family-v1\0'+'\0'.join(sorted(['session-1',sid])))
        prior['train_families']=[f['familyHash']]
        rows,excluded=extract(p,l,prior);self.assertEqual(len(rows),3);self.assertEqual(excluded['copied_interaction'],1)

    def test_loader_rejects_changed_hint_even_if_file_hash_is_updated(self):
        p,l,prior=fixture();rows,_=extract(p,l,prior)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp);files={}
            for split in ['train','validation']:
                body=[r for r in rows if r['split']==split]
                if split=='train':body[0]['next_user']['content']='Fabricated new reply'
                name=split+'.json';(path/name).write_text(json.dumps(body));files[name]=digest((path/name).read_bytes())
            (path/'manifest.json').write_text(json.dumps({'method':'logged-user-interaction-sdpo-surrogate','synthetic_hints':0,'files':files}))
            with self.assertRaisesRegex(ValueError,'changed interaction'):load_dataset(path)

class GradientTests(unittest.TestCase):
    def test_positive_negative_zero_and_prompt_mask(self):
        import torch
        lp=torch.tensor([-2.,-3.,-1.,-4.,-5.],requires_grad=True)
        loss=logged_token_loss(lp,[2.,-3.,0.],3);loss.backward()
        self.assertTrue(torch.allclose(lp.grad,torch.tensor([0.,0.,-2/3,1.,0.])))
    def test_alignment_and_nonfinite_rejected(self):
        import torch
        for advantages,length in [([1.],0),([float('nan')],2),([1.,2.],2)]:
            with self.assertRaises(ValueError):logged_token_loss(torch.tensor([-1.,-2.]),advantages,length)

class NativeEncodingTests(unittest.TestCase):
    def test_same_observed_tokens_and_teacher_only_future_message(self):
        import os
        os.environ['HF_HUB_OFFLINE']='1'
        from tinker_cookbook import renderers,tokenizer_utils
        model='thinkingmachines/Inkling-Small';r=renderers.get_renderer('tml_v0',tokenizer_utils.get_tokenizer(model),model_name=model)
        p,l,prior=fixture();rows,_=extract(p,l,prior);row=rows[0]
        row['next_user']['content']='UNIQUE_FUTURE_CORRECTION_73'
        encoded=encode_interaction(r,row,'Actual system prompt fixture',[])
        student=r.tokenizer.decode(encoded['student_tokens']);teacher=r.tokenizer.decode(encoded['teacher_tokens'])
        self.assertNotIn(row['next_user']['content'],student);self.assertIn(row['next_user']['content'],teacher)
        self.assertIn(row['response']['content'],r.tokenizer.decode(encoded['completion_tokens']))
        self.assertIn('Actual system prompt fixture',student);self.assertIn('Actual system prompt fixture',teacher)

if __name__=='__main__':unittest.main()
