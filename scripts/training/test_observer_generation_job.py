# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.8.0+cpu", "transformers==5.3.0", "numpy==2.2.6"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Authored CPU toys, no downloaded checkpoints, GPU, provider or credentials."""
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch
from safetensors.torch import save, save_file
import observer_generation_job as worker
import observer_experiment_job as base
from test_observer_experiment_job import fixture, authored_overlay, environment_fixture, materialization, Tokens


class Tokenizer(Tokens):
    pad_token_id = 0
    eos_token_id = 255


def spec_for(job):
    roles = {r['split']:r['record_id'] for r in job['experiment']['records']}
    review = {'status':'reviewed','review_id':'candidate','reviewer':'authored fixture', 'evidence_sha256':'f'*64}
    return {'schema_version':1,'layer':12,'selected_feature':31497,'unrelated_feature':4962,
        'selected_review':review,'unrelated_review':{**review,'review_id':'comparator'},
        'control_semantic_status':'unverified_low_association_comparator','selected_semantic_status':'candidate_from_probe','epsilon':.05,'seed':101,'max_new_tokens':2,
        'calibration_record_ids':[roles['calibration']], 'generation_record_ids':[roles['test']]}


def make_job(profile):
    b,j,*rest = fixture()
    b['dependency_profile'] = profile; b.pop('job_sha256'); base.seal(b,'job_sha256')
    job,join = worker.prepare_job(b,j,spec_for(b))
    return job,join,materialization(b,rest[-1]),environment_fixture(b)


def reseal(value, key):
    value.pop(key,None); return base.seal(value,key)


def tar_files(files):
    buf=io.BytesIO()
    with tarfile.open(fileobj=buf,mode='w') as arc:
        for n,b in files.items():
            item=tarfile.TarInfo(n); item.size=len(b); arc.addfile(item,io.BytesIO(b))
    return buf.getvalue()


def mutate_archive(body, mutate):
    with tarfile.open(fileobj=io.BytesIO(body),mode='r:') as arc:
        files={m.name:arc.extractfile(m).read() for m in arc}
    mutate(files)
    receipt=json.loads(files['receipt.json'])
    receipt['files']={n:hashlib.sha256(b).hexdigest() for n,b in files.items() if n!='receipt.json'}
    files['receipt.json']=json.dumps(receipt).encode()
    return tar_files(files)


class Block(torch.nn.Module):
    def forward(self,h): return h + .25


class Toy(torch.nn.Module):
    def __init__(self):
        super().__init__(); self.weight=torch.nn.Parameter(torch.zeros(1,dtype=torch.bfloat16)); self.block=Block()
        self.config=SimpleNamespace(model_type='qwen3_5_text',hidden_size=4096,vocab_size=256)
        self.seen=[]
    def forward(self,input_ids,attention_mask,use_cache,position_ids=None,return_dict=True):
        assert use_cache is False
        self.seen.append(input_ids.tolist())
        h=input_ids.to(torch.bfloat16).unsqueeze(-1).expand(-1,-1,4096)/256
        return SimpleNamespace(last_hidden_state=self.block(h))


class Decoder:
    def __getitem__(self,key):
        d=torch.zeros(4096); d[0 if key[1]==31497 else 1]=1
        return d


class Tests(unittest.TestCase):
    def setUp(self):
        self.stack=ExitStack(); self.addCleanup(self.stack.close)
        profile=self.stack.enter_context(authored_overlay())
        self.job,self.join,self.mat,self.env=make_job(profile)
        self.flight=worker.preflight(self.job,Tokenizer())

    def test_sealed_schema_and_unchanged_base(self):
        worker.validate_job(self.job,check_code=True)
        self.assertEqual(worker.SOURCE_NAMES,(*base.SOURCE_NAMES,'observer_generation.py','observer_generation_job.py'))
        self.assertEqual(worker.ARTIFACTS,base.ARTIFACTS)
        self.assertEqual(self.job['forward_passes'],11)
        self.assertEqual(self.job['base_job']['mode'],'readout')
        self.assertEqual(self.job['dependency_profile'],self.job['base_job']['dependency_profile'])
        again,join=worker.prepare_job(self.job['base_job'],self.join,self.job['generation_spec'])
        self.assertEqual((again,join),(self.job,self.join))

    def test_extended_source_corruption_rejects_even_resealed(self):
        bad=deepcopy(self.job); bad['source_files_sha256']['observer_generation.py']='0'*64; reseal(bad,'job_sha256')
        with self.assertRaisesRegex(ValueError,'source changed'): worker.validate_job(bad,check_code=True)
        bad=deepcopy(self.job); bad['source_files_sha256']['extra.py']='0'*64; reseal(bad,'job_sha256')
        with self.assertRaises(ValueError): worker.validate_job(bad)

    def test_roles_unknown_keys_semantic_claims_and_boolean_numbers_reject(self):
        for change in [lambda s:s.update(epsilon=True),lambda s:s.update(max_new_tokens=513),
            lambda s:s.update(seed=-1),lambda s:s.update(hidden_labels={}),
            lambda s:s.update(control_semantic_status='verified'),
            lambda s:s.update(unrelated_feature=31497),
            lambda s:s.update(generation_record_ids=s['calibration_record_ids'])]:
            s=deepcopy(self.job['generation_spec']); change(s)
            with self.assertRaises(ValueError): worker.prepare_job(self.job['base_job'],self.join,s)

    def test_generation_has_prefix_only_no_gold_labels_future(self):
        records={r['record_id']:r for r in self.job['experiment']['records']}
        view=worker.prompt_view(records[self.job['generation_spec']['generation_record_ids'][0]])
        self.assertEqual(view['text'],'[learner_message]\nHint please.\n[actor_message]\n')
        self.assertNotIn('ab cd',view['text']); self.assertNotIn('SECRET',view['text'])
        self.assertEqual(''.join(chr(i) for i in self.flight['records'][1]['input_token_ids']),view['text'])
        self.assertTrue(self.flight['records'][0]['selected_token_indices'])
        self.assertEqual(self.flight['records'][1]['selected_token_indices'],[])

    def test_no_mixed_role_prefix(self):
        r=deepcopy(self.job['experiment']['records'][0]); r['events'][0]['kind']='actor_message'
        with self.assertRaisesRegex(ValueError,'public learner'): worker.prompt_view(r)

    def test_preflight_counts_full_prefix_and_calibration(self):
        cal,gen=self.flight['records']; n=2
        expected=len(cal['input_token_ids'])+5*(n*len(gen['input_token_ids'])+1)
        self.assertEqual(self.flight['forward_tokens'],expected)
        for mutate in [lambda f:f['records'][1].update(role='calibration'),
            lambda f:f.update(forward_tokens=f['forward_tokens']-1),
            lambda f:f['records'][1].update(view_sha256='0'*64),
            lambda f:f.update(pad_token_id=True)]:
            bad=deepcopy(self.flight); mutate(bad); reseal(bad,'preflight_sha256')
            with self.assertRaises(ValueError): worker.validate_preflight(self.job,bad)

    def test_budget_caps_admitted_before_weights(self):
        for key,value in [('max_forward_passes',10),('max_forward_tokens',1),('max_result_bytes',200000)]:
            b=deepcopy(self.job['base_job']); b['limits'][key]=value; reseal(b,'job_sha256')
            with self.assertRaises(ValueError):
                j,_=worker.prepare_job(b,self.join,self.job['generation_spec']); worker.preflight(j,Tokenizer())
        s=deepcopy(self.job['generation_spec']); s['max_new_tokens']=512
        j,_=worker.prepare_job(self.job['base_job'],self.join,s)
        with self.assertRaisesRegex(ValueError,'context'): worker.preflight(j,Tokenizer())

    def test_delegates_unmodified_base(self):
        for name,args,kwargs in [('bootstrap_overlay',('out',),{'remaining_seconds':10}),
            ('materialize',('cache',{}),{}),('cached_tokenizer',(self.mat,'cache'),{})]:
            with patch.object(base,name,return_value='ok') as mock:
                self.assertEqual(getattr(worker,name)(self.job,*args,**kwargs),'ok')
                self.assertEqual(mock.call_args.args[0],self.job['base_job'])

    def test_actual_head_file_and_last_token_projection(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'model.safetensors'; model=Toy()
            head=torch.zeros(256,4096,dtype=torch.bfloat16); head[65]=1
            save_file({'lm_head.weight':head},path)
            asset=deepcopy(next(a for a in self.job['inventory']['assets'] if a['filename']=='model.safetensors'))
            asset['size']=path.stat().st_size; asset['oid']={'algorithm':'sha256','value':base.extract.file_hash(path)}
            job=deepcopy(self.job); job['inventory']['assets']=[asset]
            manifest={'model_files_sha256':{path.name:asset['oid']['value']}}
            weight,proof=worker.load_head(job,model,manifest,{base.asset_key(asset):path})
            ids=torch.tensor([[5,8]],dtype=torch.long)
            logits=worker.last_token_logits(model,weight,input_ids=ids,attention_mask=torch.ones_like(ids),position_ids=torch.tensor([[0,1]]),use_cache=False)
            self.assertEqual(tuple(logits.shape),(1,256)); self.assertEqual(logits.argmax(-1).item(),65)
            self.assertEqual(proof['shard_sha256'],asset['oid']['value'])
            path.write_bytes(path.read_bytes()[:-1]+b'X')
            with self.assertRaisesRegex(ValueError,'hash mismatch'): worker.load_head(job,model,manifest,{base.asset_key(asset):path})

    def head_cache(self, root):
        """Fresh Hub snapshot links and pinned bytes for the cache/head boundary."""
        cache=root/'cache'; head=torch.zeros(256,4096,dtype=torch.bfloat16); head[65]=1
        bodies={'model.safetensors':save({'lm_head.weight':head}),
                'model.safetensors.index.json':json.dumps({'weight_map':{'lm_head.weight':'model.safetensors'}}).encode()}
        template=next(a for a in self.job['inventory']['assets'] if a['filename']=='model.safetensors')
        assets=[]
        repo=cache/('models--'+template['repo'].replace('/','--'))
        snapshot=repo/'snapshots'/template['revision']; snapshot.mkdir(parents=True)
        (repo/'blobs').mkdir()
        for name,body in bodies.items():
            sha=hashlib.sha256(body).hexdigest()
            (repo/'blobs'/sha).write_bytes(body)
            (snapshot/name).symlink_to(Path('../../blobs')/sha)
            assets.append({**deepcopy(template),'filename':name,'size':len(body),
                           'oid':{'algorithm':'sha256','value':sha}})
        inventory=base.seal({'assets':assets,'total_bytes':sum(a['size'] for a in assets)},'inventory_sha256')
        b=base.seal({'inventory':inventory},'job_sha256')
        job={'base_job':b,'inventory':inventory,'experiment':self.job['experiment']}
        return job,materialization(b,bodies),cache,snapshot,head

    def test_verified_cache_symlinks_load_indexed_head(self):
        from huggingface_hub import constants
        with tempfile.TemporaryDirectory() as d:
            job,mat,cache,snapshot,head=self.head_cache(Path(d))
            index=snapshot/'model.safetensors.index.json'
            self.assertTrue(index.is_symlink())
            with self.assertRaisesRegex(ValueError,'Expected bounded regular artifact'):
                base.regular_bytes(index)
            with patch.object(constants,'HF_HUB_CACHE',str(cache)):
                paths=worker.verified_paths(job,mat,cache)
            manifest={'model_files_sha256':{'model.safetensors':mat['assets'][0]['sha256']}}
            weight,proof=worker.load_head(job,Toy(),manifest,paths)
            self.assertTrue(torch.equal(weight,head))
            self.assertEqual(proof['shard_sha256'],mat['assets'][0]['sha256'])
            self.assertTrue(all(p.is_file() and not p.is_symlink() and p.is_relative_to(cache) for p in paths.values()))

    def test_verified_cache_rejects_symlink_escape(self):
        from huggingface_hub import constants
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); job,mat,cache,snapshot,_=self.head_cache(root)
            index=snapshot/'model.safetensors.index.json'
            outside=root/'outside.json'; outside.write_bytes(index.read_bytes())
            index.unlink(); index.symlink_to(outside)
            # Matching pinned bytes outside the approved root must still fail.
            with patch.object(constants,'HF_HUB_CACHE',str(cache)):
                with self.assertRaisesRegex(ValueError,'Asset escaped pinned cache'):
                    worker.verified_paths(job,mat,cache)

    def test_missing_wrong_shape_nan_or_bias_head_rejected(self):
        for tensors in [{'other.weight':torch.zeros(1)}, {'lm_head.weight':torch.zeros(2,4)},
                        {'lm_head.weight':torch.full((256,4096),float('nan'))},
                        {'lm_head.weight':torch.zeros(256,4096),'lm_head.bias':torch.zeros(256)}]:
            with self.subTest(keys=list(tensors)),tempfile.TemporaryDirectory() as d:
                path=Path(d)/'model.safetensors'; save_file(tensors,path)
                asset=deepcopy(next(a for a in self.job['inventory']['assets'] if a['filename']=='model.safetensors'))
                asset['size']=path.stat().st_size; asset['oid']={'algorithm':'sha256','value':base.extract.file_hash(path)}
                job=deepcopy(self.job); job['inventory']['assets']=[asset]
                with self.assertRaises(ValueError): worker.load_head(job,Toy(),{'model_files_sha256':{path.name:asset['oid']['value']}},{base.asset_key(asset):path})

    def run_toy(self,root, *, fail=False):
        model=Toy(); head=torch.zeros(256,4096,dtype=torch.bfloat16); head[65]=1
        hashes={a['filename']:a['sha256'] for a in self.mat['assets'] if a['filename'].endswith('.safetensors')}
        proof={'tensor':'lm_head.weight','filename':'model.safetensors','shard_sha256':hashes['model.safetensors'],
            'model_files_sha256':hashes,'shape':[256,4096],'dtype':'torch.bfloat16',
            'projection':'F.linear(final_last_hidden_state, lm_head.weight); no bias; no cache'}
        runtime={'creation_started_at':time.time()-2,'rate_observed_at':time.time()-1,'observed_gpu_hourly_rate':.5}
        with ExitStack() as stack:
            stack.enter_context(patch.object(base,'check_overlay_process'))
            stack.enter_context(patch.object(worker,'cached_tokenizer',return_value=Tokenizer()))
            stack.enter_context(patch.object(worker,'verified_paths',return_value={}))
            stack.enter_context(patch.object(base,'load_layer_reusing_model',return_value=(model,Tokenizer(),model.block,{'W_dec':Decoder()},{'model_files_sha256':hashes})))
            stack.enter_context(patch.object(worker,'verify_loaded_files'))
            stack.enter_context(patch.object(worker,'load_head',return_value=(head,proof)))
            if fail: stack.enter_context(patch.object(worker.generation,'generate_controls',side_effect=RuntimeError('toy decode failed')))
            receipt=worker.execute_job(self.job,self.mat,'cache',root,runtime,environment=self.env,expected_preflight=self.flight)
            archive=worker.archive_outputs(root)
            imported=worker.import_outputs(self.job,self.join,archive)
        return receipt,archive,imported,model

    def test_toy_execution_calibrates_then_generates_and_imports(self):
        with tempfile.TemporaryDirectory() as d:
            receipt,archive,got,model=self.run_toy(Path(d)/'out')
            self.assertTrue(receipt['complete']); self.assertFalse(got['fit_eligible'])
            self.assertEqual(got['validated_completed_trials'],1)
            self.assertEqual(got['result']['usage']['forward_passes'],11)
            self.assertEqual(len(model.seen),11)
            cal=got['result']['calibrations'][0]
            self.assertEqual(cal['selected_token_indices'],self.flight['records'][0]['selected_token_indices'])
            norms=cal['norms']; self.assertEqual(got['result']['scale'],sorted(norms)[(len(norms)-1)//2])
            self.assertNotEqual(got['result']['scale'],1)
            self.assertEqual(got['result']['control_semantic_status'],'unverified_low_association_comparator')
            self.assertEqual(got['local_join']['rows'][0]['local']['record_id'],'test')
            self.assertEqual(model.block._forward_hooks,{})
            self.assertEqual(model._forward_pre_hooks,{})

    def test_partial_keeps_real_calibration_and_no_success_claim(self):
        with tempfile.TemporaryDirectory() as d:
            receipt,archive,got,model=self.run_toy(Path(d)/'out',fail=True)
            self.assertFalse(got['complete']); self.assertFalse(got['fit_eligible'])
            self.assertEqual(got['validated_completed_trials'],0)
            self.assertEqual(got['result']['usage']['forward_passes'],1)
            self.assertEqual(len(got['result']['calibrations']),1)

    def test_import_tampering_even_with_updated_receipt_and_result_hash(self):
        with tempfile.TemporaryDirectory() as d:
            _,body,_,_=self.run_toy(Path(d)/'out')
            for change in [lambda r:r.update(scale=1),lambda r:r['head'].update(shard_sha256='0'*64),
                          lambda r:r.update(control_semantic_status='verified'),
                          lambda r:r['usage'].update(forward_passes=0),
                          lambda r:r['rows'][0]['controls']['conditions']['selected_negative']['direction'].__setitem__(0,1),
                          lambda r:r['rows'][0]['controls']['conditions']['random']['direction'].__setitem__(0,.5),
                          lambda r:r['rows'][0]['controls']['conditions']['baseline'].update(intervention_scope='all_tokens'),
                          lambda r:r['rows'][0]['controls']['upper_bound'].update(forward_passes=1),
                          lambda r:r['directions']['selected'].__setitem__(0,0),
                          lambda r:r['rows'][0]['controls']['conditions']['baseline']['rows'][0]['generated_ids'].__setitem__(0,-1)]:
                def mutate(files):
                    r=json.loads(files['results.json']); change(r); reseal(r,'result_sha256'); files['results.json']=json.dumps(r).encode()
                bad=mutate_archive(body,mutate)
                with patch.object(worker,'verify_loaded_files'),self.assertRaises(ValueError): worker.import_outputs(self.job,self.join,bad)
            bad=mutate_archive(body,lambda files:files.update({'../escape':b'bad'}))
            with self.assertRaises(ValueError): worker.import_outputs(self.job,self.join,bad)

    def test_diagnostic_failure_stage_matches_controller(self):
        files={'experiment.log':b'bootstrap failed\n'}
        receipt={'schema_version':1,'evidence':'local_worker_process_not_pod_receipt',
            'job_sha256':self.job['job_sha256'],'exit_code':1,'complete':False,'fit_eligible':False,
            'completed_trials':0,'transport_exit_code':1,'transport_failure_stage':'bootstrap',
            'files':{'experiment.log':hashlib.sha256(files['experiment.log']).hexdigest()}}
        files['receipt.json']=json.dumps(receipt).encode()
        got=worker.import_outputs(self.job,self.join,tar_files(files))
        self.assertTrue(got['diagnostic_only']); self.assertEqual(got['diagnostic']['failure_stage'],'bootstrap')
        self.assertFalse(got['fit_eligible']); self.assertIsNone(got['local_join'])

    def test_loaded_manifest_requires_all_actual_asset_pins(self):
        obs=self.job['experiment']['config']['observer']; layer=obs['layers'][0]
        actual={base.asset_key(a):a for a in self.mat['assets']}
        def hashes(role):
            return {a['filename']:actual[base.asset_key(a)]['sha256'] for a in self.job['inventory']['assets'] if role in a['roles']}
        manifest={'evidence':'model_extraction','observer_model':obs['model'],'observer_revision':obs['model_revision'],
            'tokenizer_revision':obs['tokenizer_revision'],'sae_model':obs['sae_model'],'sae_revision':obs['sae_revision'],
            'sae_sha256':layer['sae_sha256'],'layer':12,'module':layer['module'],'hook':'residual_post_block',
            'dtype':'bfloat16','device':'cuda','dimensions':{'hidden':4096,'width':65536,'top_k':50},
            'model_files_sha256':{k:v for k,v in hashes('model').items() if k.endswith('.safetensors')},
            'tokenizer_files_sha256':hashes('tokenizer'),'config_sha256':hashes('model')['config.json'],
            'implementation_files_sha256':{k:self.job['source_files_sha256'][k] for k in ('observer_core.py','observer_extract.py','observer_models.py')}}
        worker.verify_loaded_files(self.job,manifest,self.mat)
        for mutate in [lambda m:m['model_files_sha256'].update(extra='0'*64),
                       lambda m:m['tokenizer_files_sha256'].pop('tokenizer.json'),
                       lambda m:m.update(config_sha256='0'*64),
                       lambda m:m['implementation_files_sha256'].pop('observer_models.py'),
                       lambda m:m['implementation_files_sha256'].update({'observer_models.py':'0'*64})]:
            bad=deepcopy(manifest); mutate(bad)
            with self.assertRaises(ValueError): worker.verify_loaded_files(self.job,bad,self.mat)

    def test_durable_calibration_context_tampering_rejects(self):
        with tempfile.TemporaryDirectory() as d:
            _,body,got,_=self.run_toy(Path(d)/'out',fail=True)
            self.assertEqual(len(got['result']['calibrations']),1)
            def mutate(files):
                context=json.loads(files['context.json']); context['calibrations'][0]['norms'][0]=1
                reseal(context,'context_sha256'); files['context.json']=json.dumps(context).encode()
            bad=mutate_archive(body,mutate)
            with patch.object(worker,'verify_loaded_files'),self.assertRaisesRegex(ValueError,'Durable calibration'):
                worker.import_outputs(self.job,self.join,bad)

    def test_meter_rejects_time_and_forward_overrun_before_call(self):
        runtime={'creation_started_at':time.time()-2,'rate_observed_at':time.time()-1,'observed_gpu_hourly_rate':.5}
        m=worker.ForwardMeter(self.job,self.flight,runtime)
        m.passes=self.flight['forward_passes']
        with self.assertRaises(ValueError): m.before(None,(),{'input_ids':torch.ones(1,2,dtype=torch.long),'use_cache':False})
        self.assertEqual(m.passes,self.flight['forward_passes'])
        m.passes=0; runtime['creation_started_at']=time.time()-99999
        with self.assertRaises(ValueError): m.before(None,(),{'input_ids':torch.ones(1,2,dtype=torch.long),'use_cache':False})


if __name__=='__main__': unittest.main()
