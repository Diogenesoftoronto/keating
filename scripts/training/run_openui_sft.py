#!/usr/bin/env python3
"""Bounded multi-turn OpenUI SFT; preserves native calls and the shared pilot ledger."""
import hashlib,json,math,os,random
from datetime import datetime,timezone
from pathlib import Path
import typer
from pilot_budget import PilotBudget
from run_tinker import write_json,load_parent,verified_prompt_revision

ROOT=Path(__file__).resolve().parents[2]
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
def sha(body):return hashlib.sha256(body).hexdigest()

def load_data(dataset,prompt_path):
    manifest=json.loads((dataset/'manifest.json').read_text())
    if manifest['schema_version']!=2 or manifest['base_model']!=PilotBudget.MODEL:raise ValueError('Expected native multi-turn Inkling dataset')
    verified_prompt_revision(prompt_path,manifest['system_prompt_sha256'],manifest['tool_schemas_sha256'])
    prompt=prompt_path.read_text();tools=json.loads((prompt_path.parent/'tool-schemas.json').read_text())
    if sha(prompt.encode())!=manifest['system_prompt_sha256']:raise ValueError('Prompt hash mismatch')
    rows={}
    for split in ['train','validation']:
        body=(dataset/f'{split}.jsonl').read_bytes()
        if sha(body)!=manifest['output_sha256'][f'{split}.jsonl']:raise ValueError('Dataset bytes changed')
        rows[split]=[json.loads(line) for line in body.splitlines() if line.strip()]
        if len(rows[split])!=manifest['counts'][split] or not rows[split]:raise ValueError('Split count mismatch')
        for r in rows[split]:
            if r['messages'][0]!={'role':'system','content':prompt} or r['tools']!=tools:raise ValueError('Context changed within dataset')
            if len(r['messages'])<20:raise ValueError('Expected multi-turn conversations')
            for m in r['messages']:
                if any(c['function']['name'] in ['quiz','deck'] for c in m.get('tool_calls',[])):raise ValueError('Legacy activity creation is forbidden in training')
    if {r['family'] for r in rows['train']}&{r['family'] for r in rows['validation']}:raise ValueError('Topic family leakage')
    return rows,manifest

def native_messages(row):
    from tinker_cookbook.renderers.base import ToolCall
    native=[]
    for message in row['messages']:
        m=dict(message)
        if m.get('tool_calls'):m['tool_calls']=[ToolCall.model_validate(c) for c in m['tool_calls']]
        native.append(m)
    native.insert(1,{'role':'tool_declare','content':json.dumps(row['tools'],separators=(',',':'))})
    return native

@app.command()
def main(dataset:Path=typer.Option(...),prompt_path:Path=typer.Option(...),parent_run:Path=typer.Option(...),run_dir:Path=typer.Option(...),budget_file:Path=typer.Option(...),epochs:int=typer.Option(2,min=1,max=3),learning_rate:float=typer.Option(1e-4),dry_run:bool=typer.Option(False)):
    if not math.isfinite(learning_rate) or not 0<learning_rate<=3e-4:raise ValueError('Invalid pilot learning rate')
    rows,manifest=load_data(dataset,prompt_path)
    raw_parent=json.loads((parent_run/'result.json').read_text())
    parent=load_parent(parent_run,raw_parent['owner_did'],manifest['system_prompt_sha256'],manifest['tool_schemas_sha256'],budget_file,100,True)
    ledger=json.loads(budget_file.read_text());budget=PilotBudget(budget_file,100)
    os.environ['HF_HUB_OFFLINE']='1'
    import tinker
    from tinker_cookbook import renderers,tokenizer_utils
    from tinker_cookbook.supervised.common import datum_from_model_input_weights
    renderer=renderers.get_renderer(parent['renderer'],tokenizer_utils.get_tokenizer(parent['model']),model_name=parent['model'])
    datums=[];stats=[]
    for row in rows['train']:
        native=native_messages(row)
        tokens,weights=renderer.build_supervised_example(native,train_on_what=renderers.TrainOnWhat.ALL_ASSISTANT_MESSAGES,effort=parent['effort'])
        if tokens.length>32768 or int((weights>0).sum())<100:raise ValueError('Bad native training sequence')
        prefix=renderer.build_generation_prompt(native[:3],effort=parent['effort'])
        if weights[:prefix.length-16].sum().item()!=0:raise ValueError('Prompt is not masked')
        datums.append(datum_from_model_input_weights(tokens,weights,reduction='mean'))
        stats.append({'id':row['id'],'tokens':tokens.length,'supervised_tokens':int((weights>0).sum())})
    training_reserve=epochs*sum(d.model_input.length for d in datums)*PilotBudget.TRAIN*PilotBudget.SAFETY_FACTOR/1e6
    plan={'epochs':epochs,'learning_rate':learning_rate,'updates':epochs*len(datums),'training_reservation_usd':training_reserve,'storage_reservation_usd':1,'prior_reservation_usd':ledger['reserved_usd'],'remaining_after_plan_usd':100-ledger['reserved_usd']-training_reserve-1,'datums':stats,'system_prompt_sha256':manifest['system_prompt_sha256'],'parent_system_prompt_sha256':parent['system_prompt_sha256'],'loss_contract':'ALL_ASSISTANT_MESSAGES; user, system, declarations and tool results masked','held_out_in_training':False}
    if plan['remaining_after_plan_usd']<8:raise ValueError('Preserve at least $8 of conservative headroom for evaluation and SDPO')
    if dry_run:print(json.dumps(plan));return
    if not os.environ.get('TINKER_API_KEY'):raise ValueError('Server-side key required')
    run_dir.mkdir(parents=True,exist_ok=False,mode=0o700);write_json(run_dir/'preflight.json',plan);write_json(run_dir/'dataset-manifest.json',manifest)
    metadata={'owner_did':parent['owner_did'],'product':'keating','purpose':'openui-sft'}
    with budget.reserve('openui-sft-storage',fixed_usd=1):
        service=tinker.ServiceClient(user_metadata=metadata)
        trainer=service.create_training_client_from_state(parent['training_state_path'],user_metadata=metadata)
    metrics=[]
    for epoch in range(epochs):
        order=list(range(len(datums)));random.Random(42+epoch).shuffle(order)
        for i in order:
            datum=datums[i]
            with budget.reserve('openui-sft-update',train=datum.model_input.length):
                backward=trainer.forward_backward([datum],loss_fn='cross_entropy').result()
                trainer.optim_step(tinker.AdamParams(learning_rate=learning_rate)).result()
            metrics.append({'epoch':epoch+1,'conversation':rows['train'][i]['id'],'provider_metrics':backward.metrics})
            write_json(run_dir/'steps.json',metrics);print(json.dumps({'epoch':epoch+1,'completed_updates':len(metrics)}),flush=True)
        state=trainer.save_state(f'openui-epoch-{epoch+1}',ttl_seconds=86400).result().path
        sampler=trainer.save_weights_for_sampler(f'openui-epoch-{epoch+1}',ttl_seconds=86400).result().path
        write_json(run_dir/f'epoch-{epoch+1}.json',{'training_state_path':state,'sampler_path':sampler})
    result={k:parent[k] for k in ['owner_did','model','renderer','effort']}
    result.update(schema_version=1,training_state_path=state,sampler_path=sampler,parent_sampler_path=parent['sampler_path'],parent_training_state_path=parent['training_state_path'],system_prompt_sha256=manifest['system_prompt_sha256'],tools_sha256=manifest['tool_schemas_sha256'],tool_count=len(rows['train'][0]['tools']),budget_file=str(budget_file.resolve()),cap_usd=100,method='supervised-openui-multiturn',epochs=epochs,updates=len(metrics),dataset_id=manifest['dataset_id'],public_model_id='keating-bot-openui',public_model_name='Keating Bot (OpenUI SFT)',checkpoint_ttl_seconds=86400,created_at=datetime.now(timezone.utc).isoformat(),evaluated=False,quality_improvement_verified=False,limitations=['Authored synthetic conversations; no causal learning-outcome measurement.','Independent rollout evaluation is required; training completion is not promotion.'])
    write_json(run_dir/'result.json',result);print(json.dumps({'status':'sft-checkpoints-saved','run_dir':str(run_dir),'reserved_usd':json.loads(budget_file.read_text())['reserved_usd']}),flush=True)
if __name__=='__main__':app()
