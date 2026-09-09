"""Fresh Inkling LoRA: sampled-token SDPO only, same-context base comparison."""
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime,timezone
from pathlib import Path
import typer
from evaluate_interactions import Harness,native_prefix
from pilot_budget import PilotBudget
from ppo_diagnostics import completion_alignment
from run_tinker import completion_lps,verified_prompt_revision,write_json
from sdpo_math import datum_vectors,prepare_advantages

ROOT=Path(__file__).resolve().parents[2]
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def load_inputs(dataset,prompt_path,owner_record,budget_file,steps):
    if not 1<=steps<=8:raise ValueError('Bounded restart allows 1–8 distinct steps')
    manifest=json.loads((dataset/'manifest.json').read_text())
    for name,digest in manifest['files'].items():
        if Path(name).name!=name or sha(dataset/name)!=digest:raise ValueError('Dataset hash mismatch')
    tools_path=prompt_path.parent/'tool-schemas.json'
    if manifest['system_prompt_sha256']!=sha(prompt_path) or manifest['tools_sha256']!=sha(tools_path):raise ValueError('Dataset prompt mismatch')
    verified_prompt_revision(prompt_path,sha(prompt_path),sha(tools_path))
    owner=json.loads(owner_record.read_text())
    if owner['model']!=PilotBudget.MODEL or not re.fullmatch(r'did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9.:%_-]+)',owner['owner_did']):raise ValueError('Existing pilot account/model required')
    original=Path(owner.get('budget_file') or owner_record.parent/'budget.json')
    if original.resolve()!=budget_file.resolve():raise ValueError('Never reset the shared pilot budget')
    ledger=json.loads(budget_file.read_text())
    if ledger['cap_usd']!=100 or ledger['model']!=PilotBudget.MODEL:raise ValueError('Budget mismatch')
    data=json.loads((dataset/'cases.json').read_text())
    if {r['family'] for r in data['train']}&{r['family'] for r in data['validation']}:raise ValueError('Family overlap')
    if len(data['train'])<steps or not data['validation']:raise ValueError('Insufficient cases')
    rows=data['train'][:steps]+data['validation']
    if len({r['id'] for r in rows})!=len(rows):raise ValueError('Duplicate case')
    if any('reference' in r or not r['history'] or r['history'][-1]['role'] not in ['user','tool'] for r in rows):raise ValueError('Use context snapshots without exact assistant targets')
    return data,manifest,owner,ledger

def teacher_context(row,rubric,feedback):
    return ('Training-only context. The system prompt and original learner request still apply. '
        'The guidance below is authored, not a human rating of this response. Contract feedback was computed on the actual new response. '
        'Improve behavior without copying a fixed answer or revealing this training context.\n'+
        json.dumps({'behavior_guidance':rubric,'case_guidance':row['hint'],'contract_observation':feedback},ensure_ascii=False))

def price(prefill=0,sample=0,train=0):
    return PilotBudget.SAFETY_FACTOR*(prefill*PilotBudget.PREFILL+sample*PilotBudget.SAMPLE+train*PilotBudget.TRAIN)/1e6

def check(harness,row,sampled,directory):
    directory.mkdir(parents=True,exist_ok=False,mode=0o700)
    write_json(directory/'sample.json',sampled)
    write_json(directory/'input.json',[{'response':sampled['message'],'tools':harness.tools,'expected':row['expected']}])
    subprocess.run(['rtk','proxy','bun',str(ROOT/'scripts/training/check_restart.ts'),str(directory/'input.json'),str(directory/'checked.json')],check=True,capture_output=True)
    checked=json.loads((directory/'checked.json').read_text())[0]
    evidence={'case':row['id'],'family':row['family'],'history':row['history'],'response':sampled['message'],
        'parse_status':sampled['parse_status'],'at_token_limit':sampled['at_token_limit'],**checked}
    write_json(directory/'evidence.json',evidence)
    return evidence

@app.command()
def main(dataset:Path=typer.Option(...),prompt_path:Path=typer.Option(...),run_dir:Path=typer.Option(...),
         owner_record:Path=typer.Option(ROOT/'.keating/outputs/training/inkling-pilot/result.json'),
         budget_file:Path=typer.Option(ROOT/'.keating/outputs/training/inkling-pilot/budget.json'),
         steps:int=typer.Option(4),max_tokens:int=typer.Option(1536),dry_run:bool=typer.Option(False)):
    if not 256<=max_tokens<=2048:raise ValueError('Completion limit must fit the serving adapter')
    os.environ['HF_HUB_OFFLINE']='1'
    data,manifest,owner,ledger=load_inputs(dataset,prompt_path,owner_record,budget_file,steps)
    import tinker
    from tinker_cookbook import renderers,tokenizer_utils
    renderer=renderers.get_renderer('tml_v0',tokenizer_utils.get_tokenizer(PilotBudget.MODEL),model_name=PilotBudget.MODEL)
    prompt=prompt_path.read_text();tools=json.loads((prompt_path.parent/'tool-schemas.json').read_text())
    prompts={r['id']:renderer.build_generation_prompt(native_prefix(r['history'],prompt,tools),effort=.1) for r in data['train'][:steps]+data['validation']}
    if any(p.length+max_tokens>32768 for p in prompts.values()):raise ValueError('Do not truncate history')
    # Teacher contexts are bounded at runtime. Reserve the full bound up front in the plan.
    planned=1+sum(price(prefill=p.length+2*(32768),sample=max_tokens,train=p.length+max_tokens) for r in data['train'][:steps] for p in [prompts[r['id']]])
    planned+=2*sum(price(prefill=prompts[r['id']].length,sample=max_tokens) for r in data['validation'])
    plan={'method':'sdpo-only-fresh-base','model':PilotBudget.MODEL,'steps':steps,'max_tokens':max_tokens,'learning_rate':1e-5,
        'prior_reserved_usd':ledger['reserved_usd'],'maximum_new_reservation_usd':planned,'remaining_after_plan_usd':100-ledger['reserved_usd']-planned,
        'base_prompt_sha256':sha(prompt_path),'tools_sha256':manifest['tools_sha256'],'dataset_sha256':sha(dataset/'cases.json'),
        'training_cases':[r['id'] for r in data['train'][:steps]],'evaluation_cases':[r['id'] for r in data['validation']],
        'initialization':'new rank-16 base LoRA; no SFT checkpoint or optimizer restored','staleness':0,
        'evaluation_temperature':.1,'training_temperature':1,'promotion':'manual only; teaching quality unscored',
        'limitations':manifest['limitations']+['Sampled-token hinted self-distillation with PPO clipping, not full SDPO++.']}
    if plan['remaining_after_plan_usd']<2:raise ValueError(f'Preserve $2 serving headroom; plan: {json.dumps(plan)}')
    if dry_run:print(json.dumps(plan));return
    if not tinker.auth.tinker_has_credentials():raise ValueError('Load the existing Tinker credential before executing; preflight makes no provider calls')
    run_dir.mkdir(parents=True,exist_ok=False,mode=0o700);write_json(run_dir/'preflight.json',plan)
    write_json(run_dir/'dataset-manifest.json',manifest)
    harness=Harness(prompt_path,budget_file)
    with harness.budget.reserve('restart-sdpo-storage',fixed_usd=1):
        trainer=harness.service.create_lora_training_client(PilotBudget.MODEL,rank=16,seed=42,user_metadata={'owner_did':owner['owner_did'],'product':'keating','purpose':'sdpo-only-restart'})
        baseline=trainer.save_weights_for_sampler('untrained-base',ttl_seconds=86400).result().path
    common={'owner_did':owner['owner_did'],'model':PilotBudget.MODEL,'renderer':'tml_v0','effort':.1,
        'system_prompt_sha256':sha(prompt_path),'tools_sha256':manifest['tools_sha256'],'tool_count':len(tools),
        'budget_file':str(budget_file.resolve()),'cap_usd':100,'checkpoint_ttl_seconds':86400}
    (run_dir/'base').mkdir();write_json(run_dir/'base/result.json',{**common,'sampler_path':baseline,'method':'untouched-base','public_model_id':'keating-base-control'})
    def evaluate(checkpoint,arm):
        client=harness.service.create_sampling_client(model_path=checkpoint);records=[]
        for row in data['validation']:
            sampled=harness.sample(client,row['history'],f'restart-{arm}-{row["id"]}',max_tokens=max_tokens,temperature=.1)
            records.append(check(harness,row,sampled,run_dir/arm/row['id']))
            write_json(run_dir/f'{arm}-evaluation.json',records)
        return records
    before=evaluate(baseline,'before')
    if any(r['observations']['empty'] or r['at_token_limit'] for r in before):
        raise ValueError('Base response empty or truncated: inspect transport/output budget before training')
    checkpoint=baseline;running_mean=None;metrics=[]
    for i,row in enumerate(data['train'][:steps]):
        client=harness.service.create_sampling_client(model_path=checkpoint)
        sampled=harness.sample(client,row['history'],f'restart-train-{i}',max_tokens=max_tokens,temperature=1,seed=42+i)
        evidence=check(harness,row,sampled,run_dir/'train'/row['id'])
        if sampled['at_token_limit'] or not sampled['completion_tokens']:raise ValueError('Do not train a truncated or missing completion')
        native=native_prefix(row['history'],prompt,tools)
        if renderer.build_generation_prompt(native,effort=.1).to_ints()!=sampled['prompt_tokens']:raise ValueError('Rollout context changed')
        feedback={'passed':evidence['contract_passed'],'feedback':evidence['feedback'],'teaching_quality':None}
        hint=teacher_context(row,data['rubric'],feedback)
        native.insert(2,{'role':'user','content':hint})
        tp=renderer.build_generation_prompt(native,effort=.1);tokens=sampled['completion_tokens'];sp=sampled['prompt_tokens']
        if tp.length+len(tokens)>32768:raise ValueError('Teacher context exceeds reservation')
        with harness.budget.reserve('restart-student-teacher',prefill=len(sp)+tp.length+2*len(tokens)):
            sf=client.compute_logprobs(tinker.ModelInput.from_ints(sp+tokens));tf=client.compute_logprobs(tinker.ModelInput.from_ints(tp.to_ints()+tokens))
            sl=completion_lps(sf.result(),len(sp),len(tokens));tl=completion_lps(tf.result(),tp.length,len(tokens))
        advantages,running_mean,clip=prepare_advantages(tl,sl,running_mean)
        vectors=datum_vectors(sp,tokens,sampled['rollout_logprobs'],advantages)
        datum=tinker.Datum(model_input=tinker.ModelInput.from_ints(vectors['input_tokens']),loss_fn_inputs={k:tinker.TensorData(data=vectors[k],dtype='int64' if k=='target_tokens' else 'float32') for k in ['target_tokens','logprobs','advantages']})
        with harness.budget.reserve('restart-ppo-update',train=datum.model_input.length):
            backward=trainer.forward_backward([datum],loss_fn='ppo',loss_fn_config={'clip_low_threshold':.8,'clip_high_threshold':1.2}).result()
            trainer.optim_step(tinker.AdamParams(learning_rate=1e-5)).result()
        state=trainer.save_state(f'sdpo-only-{i+1}',ttl_seconds=86400).result().path
        checkpoint=trainer.save_weights_for_sampler(f'sdpo-only-{i+1}',ttl_seconds=86400).result().path
        metrics.append({'step':i+1,'case':row['id'],'contract_passed':evidence['contract_passed'],'hint':hint,'clip':clip,
            'alignment':completion_alignment(len(sp),len(tokens),sampled['rollout_logprobs'],backward.loss_fn_outputs[0]['logprobs'].data,sl),'provider_metrics':backward.metrics})
        write_json(run_dir/'steps.json',metrics)
        write_json(run_dir/'result.json',{**common,'method':'sdpo-only-fresh-base','training_state_path':state,'sampler_path':checkpoint,
            'baseline_sampler_path':baseline,'public_model_id':'keating-sdpo-only','public_model_name':'Keating Bot (SDPO only)',
            'updates':len(metrics),'created_at':datetime.now(timezone.utc).isoformat(),'evaluated':False,'quality_improvement_verified':False,'limitations':plan['limitations']})
        print(json.dumps({'completed_step':i+1,'case':row['id']}),flush=True)
    after=evaluate(checkpoint,'after')
    report={'before':before,'after':after,'teaching_quality':None,'automatic_promotion':False,'review_required':'Blindly compare substantive help, diagnostic relevance, adaptation, reasoning and transfer. Question marks and compilation are not teaching quality.'}
    write_json(run_dir/'comparison.json',report)
    result=json.loads((run_dir/'result.json').read_text());result['evaluated']=True;write_json(run_dir/'result.json',result)
    print(json.dumps({'run_dir':str(run_dir),'updates':len(metrics),'automatic_promotion':False,'reserved_usd':json.loads(budget_file.read_text())['reserved_usd']}))
if __name__=='__main__':app()
