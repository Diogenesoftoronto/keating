"""Account-owned fresh-base pilot using actual logged responses and user follow-ups."""
import json
import math
import os
import re
from datetime import datetime,timezone
from pathlib import Path
import typer
from evaluate_interactions import Harness,native_prefix
from pilot_budget import PilotBudget
from run_tinker import completion_lps,verified_prompt_revision,write_json
from run_restart_sdpo import price,check
from sdpo_math import prepare_advantages
from user_interaction_sdpo import METHOD,load_dataset,encode_interaction,logged_token_loss,select_diverse
from prepare_user_interactions import digest

ROOT=Path(__file__).resolve().parents[2]
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)

@app.command()
def main(dataset:Path=typer.Option(...),prompt_path:Path=typer.Option(...),run_dir:Path=typer.Option(...),
         owner_record:Path=typer.Option(ROOT/'.keating/outputs/training/inkling-pilot/result.json'),
         budget_file:Path=typer.Option(ROOT/'.keating/outputs/training/inkling-pilot/budget.json'),
         regression_cases:Path=typer.Option(ROOT/'.keating/outputs/training/sdpo-restart-data-v3/cases.json'),
         steps:int=typer.Option(4),learning_rate:float=typer.Option(1e-5),dry_run:bool=typer.Option(False)):
    if not 1<=steps<=8 or not math.isfinite(learning_rate) or not 0<learning_rate<=1e-5:raise ValueError('Use 1–8 updates and learning rate at most 1e-5')
    os.environ['HF_HUB_OFFLINE']='1'
    splits,manifest=load_dataset(dataset)
    tools_path=prompt_path.parent/'tool-schemas.json';prompt_hash=digest(prompt_path.read_bytes());tools_hash=digest(tools_path.read_bytes())
    verified_prompt_revision(prompt_path,prompt_hash,tools_hash)
    owner=json.loads(owner_record.read_text());ledger=json.loads(budget_file.read_text())
    original=Path(owner.get('budget_file') or owner_record.parent/'budget.json')
    if original.resolve()!=budget_file.resolve() or ledger['cap_usd']!=100 or ledger['model']!=PilotBudget.MODEL:raise ValueError('Retain the original shared $100 budget')
    if owner['model']!=PilotBudget.MODEL or not re.fullmatch(r'did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9.:%_-]+)',owner['owner_did']):raise ValueError('Original pilot account required')
    import tinker
    from tinker_cookbook import renderers,tokenizer_utils
    renderer=renderers.get_renderer('tml_v0',tokenizer_utils.get_tokenizer(PilotBudget.MODEL),model_name=PilotBudget.MODEL)
    prompt=prompt_path.read_text();tools=json.loads(tools_path.read_text())
    encoded={};eligible={s:[] for s in splits};excluded={'completion_over_2048':0,'context_over_32768':0}
    for split,rows in splits.items():
        for row in rows:
            e=encode_interaction(renderer,row,prompt,tools);n=len(e['completion_tokens'])
            if n>2048:excluded['completion_over_2048']+=1;continue
            if max(len(e['student_tokens']),len(e['teacher_tokens']))+max(n,1536)>32768:excluded['context_over_32768']+=1;continue
            encoded[row['id']]=e;eligible[split].append(row)
    train=select_diverse(eligible['train'],steps);heldout=select_diverse(eligible['validation'],2)
    regression=json.loads(regression_cases.read_text())['validation']
    # Three authored regression controls are evaluations only: cards, grading, direct help.
    regression=[r for r in regression if r['kind'] in ['cards','grade_quiz','direct-help']]
    if len(regression)!=3:raise ValueError('Expected three fixed regression controls')
    eval_rows=[{'id':r['id'],'family':r['family'],'history':r['history'],'expected':{},'source':r['source'],'evaluation_origin':'real-heldout-history'} for r in heldout]+regression
    eval_prompts={r['id']:renderer.build_generation_prompt(native_prefix(r['history'],prompt,tools),effort=.1) for r in eval_rows}
    if any(p.length+1536>32768 for p in eval_prompts.values()):raise ValueError('Evaluation context too long')
    reserve=1.0
    for row in train:
        e=encoded[row['id']];n=len(e['completion_tokens']);s=len(e['student_tokens']);t=len(e['teacher_tokens'])
        # Custom loss performs a forward pass then backward pass. Reserve both at training rates.
        reserve+=price(prefill=s+t+2*n,train=2*(s+n-1))
    reserve+=2*sum(price(prefill=p.length,sample=1536) for p in eval_prompts.values())
    plan={'method':METHOD,'source_paper':'https://arxiv.org/html/2603.12273v1#S4.SS1',
        'initialization':'new rank-16 Inkling-Small adapter; no prior SFT or optimizer','steps':steps,'learning_rate':learning_rate,
        'hint_source':'the actual next user-role message attached to the original logged assistant response','synthetic_hints':0,
        'behavior_logprobs':'unavailable; no fabricated PPO ratios','loss':'negative mean detached clipped hindsight advantage times current log probability on observed assistant tokens',
        'context_prompt_sha256':prompt_hash,'tools_sha256':tools_hash,'dataset_manifest_sha256':digest((dataset/'manifest.json').read_bytes()),
        'regression_cases_sha256':digest(regression_cases.read_bytes()),'eligible_counts':{s:len(r) for s,r in eligible.items()},'excluded_at_encoding':excluded,
        'selected_training_ids':[r['id'] for r in train],'selected_evaluation_ids':[r['id'] for r in eval_rows],
        'prior_reserved_usd':ledger['reserved_usd'],'maximum_new_reservation_usd':reserve,'remaining_after_plan_usd':100-ledger['reserved_usd']-reserve,
        'limitations':manifest['limitations']+['Logged-token gradient surrogate is biased relative to fresh on-policy SDPO; no exact full-distribution KL claim.',
            'LoRA, batch size one, constant learning rate and 3x EMA clipping are pilot adaptations, not the paper hyperparameters.',
            'Real data teaches text responses in context; authored tool checks are separate evaluation controls.','Human teaching-quality review required; no automatic promotion.']}
    if plan['remaining_after_plan_usd']<2:raise ValueError('Planned run exceeds remaining shared budget or evaluation/serving buffer: '+json.dumps(plan))
    if dry_run:print(json.dumps(plan));return
    if not tinker.auth.tinker_has_credentials():raise ValueError('Tinker credential unavailable; no paid operation dispatched')
    run_dir.mkdir(parents=True,exist_ok=False,mode=0o700);write_json(run_dir/'preflight.json',plan);write_json(run_dir/'dataset-manifest.json',manifest)
    write_json(run_dir/'selected-interactions.json',train)
    harness=Harness(prompt_path,budget_file)
    with harness.budget.reserve('real-interaction-storage',fixed_usd=1):
        trainer=harness.service.create_lora_training_client(PilotBudget.MODEL,rank=16,seed=42,user_metadata={'owner_did':owner['owner_did'],'product':'keating','purpose':METHOD})
        baseline=trainer.save_weights_for_sampler('untouched-base',ttl_seconds=86400).result().path
    common={'owner_did':owner['owner_did'],'model':PilotBudget.MODEL,'renderer':'tml_v0','effort':.1,'system_prompt_sha256':prompt_hash,
        'tools_sha256':tools_hash,'tool_count':len(tools),'budget_file':str(budget_file.resolve()),'cap_usd':100,'checkpoint_ttl_seconds':86400}
    (run_dir/'base').mkdir();write_json(run_dir/'base/result.json',{**common,'method':'untouched-base','sampler_path':baseline,'public_model_id':'keating-base-control'})
    def evaluate(checkpoint,arm):
        client=harness.service.create_sampling_client(model_path=checkpoint);records=[]
        for row in eval_rows:
            sampled=harness.sample(client,row['history'],f'real-{arm}-{row["id"][:20]}',max_tokens=1536,temperature=.1)
            evidence=check(harness,row,sampled,run_dir/arm/row['id']);evidence['origin']=row.get('evaluation_origin','authored-regression-control')
            records.append(evidence);write_json(run_dir/f'{arm}-evaluation.json',records)
        return records
    before=evaluate(baseline,'before')
    if any(r['observations']['empty'] or r['at_token_limit'] for r in before):raise ValueError('Base response empty/truncated; inspect before changing weights')
    checkpoint=baseline;mean=None;metrics=[]
    for i,row in enumerate(train):
        e=encoded[row['id']];st=e['student_tokens'];tt=e['teacher_tokens'];tokens=e['completion_tokens'];client=harness.service.create_sampling_client(model_path=checkpoint)
        with harness.budget.reserve('real-interaction-hindsight-logprobs',prefill=len(st)+len(tt)+2*len(tokens)):
            sf=client.compute_logprobs(tinker.ModelInput.from_ints(st+tokens));tf=client.compute_logprobs(tinker.ModelInput.from_ints(tt+tokens))
            sl=completion_lps(sf.result(),len(st),len(tokens));tl=completion_lps(tf.result(),len(tt),len(tokens))
        advantages,mean,clipping=prepare_advantages(tl,sl,mean)
        full=st+tokens
        datum=tinker.Datum(model_input=tinker.ModelInput.from_ints(full[:-1]),loss_fn_inputs={'target_tokens':tinker.TensorData(data=full[1:],dtype='int64')})
        def loss_fn(_data,logprobs):
            loss=logged_token_loss(logprobs[0],advantages,len(st))
            return loss,{'logged_surrogate_loss':loss.item()}
        with harness.budget.reserve('real-interaction-custom-update',train=2*datum.model_input.length):
            result=trainer.forward_backward_custom([datum],loss_fn).result()
            trainer.optim_step(tinker.AdamParams(learning_rate=learning_rate)).result()
        state=trainer.save_state(f'logged-{i+1}',ttl_seconds=86400).result().path
        checkpoint=trainer.save_weights_for_sampler(f'logged-{i+1}',ttl_seconds=86400).result().path
        metrics.append({'step':i+1,'interaction_id':row['id'],'family':row['family'],'clipping':clipping,
            'completion_tokens':len(tokens),'negative_advantage_fraction':sum(a<0 for a in advantages)/len(advantages),'provider_metrics':result.metrics})
        write_json(run_dir/'steps.json',metrics)
        write_json(run_dir/'result.json',{**common,'method':METHOD,'sampler_path':checkpoint,'training_state_path':state,'baseline_sampler_path':baseline,
            'public_model_id':'keating-real-interactions','public_model_name':'Keating Bot (real interactions SDPO)',
            'updates':len(metrics),'created_at':datetime.now(timezone.utc).isoformat(),'evaluated':False,'quality_improvement_verified':False,'limitations':plan['limitations']})
        print(json.dumps({'completed_step':i+1,'interaction_id':row['id']}),flush=True)
    after=evaluate(checkpoint,'after');write_json(run_dir/'comparison.json',{'before':before,'after':after,'teaching_quality':None,'automatic_promotion':False})
    result=json.loads((run_dir/'result.json').read_text());result['evaluated']=True;write_json(run_dir/'result.json',result)
    print(json.dumps({'run_dir':str(run_dir),'updates':len(metrics),'reserved_usd':json.loads(budget_file.read_text())['reserved_usd']}))
if __name__=='__main__':app()
