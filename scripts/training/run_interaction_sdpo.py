#!/usr/bin/env python3
"""On-policy SDPO-inspired continuation with feedback from each actual new interaction."""
import hashlib,json,os
from pathlib import Path
from datetime import datetime,timezone
import typer
from evaluate_interactions import Harness,native_prefix
from run_tinker import completion_lps,write_json,load_parent
from sdpo_math import prepare_advantages,datum_vectors
from ppo_diagnostics import completion_alignment
from pilot_budget import PilotBudget
ROOT=Path(__file__).resolve().parents[2]
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)

@app.command()
def main(parent_run:Path=typer.Option(...),run_dir:Path=typer.Option(...),prompt_path:Path=typer.Option(...),cases:Path=typer.Option(Path(__file__).parent/'data/interaction-sdpo.json'),evaluation_cases:Path=typer.Option(Path(__file__).parent/'data/interaction-eval.json'),budget_file:Path=typer.Option(ROOT/'.keating/outputs/training/inkling-pilot/budget.json'),dry_run:bool=typer.Option(False)):
 os.environ['HF_HUB_OFFLINE']='1'
 scenarios=json.loads(cases.read_text())['cases'];heldout=json.loads(evaluation_cases.read_text())['cases']
 if not 1<=len(scenarios)<=8 or {s['family'] for s in scenarios}&{s['family'] for s in heldout}:raise ValueError('Keep a bounded, disjoint training split')
 if len({s['id'] for s in scenarios})!=len(scenarios):raise ValueError('Duplicate training scenario')
 parent=json.loads((parent_run/'result.json').read_text())
 load_parent(parent_run,parent['owner_did'],hashlib.sha256(prompt_path.read_bytes()).hexdigest(),hashlib.sha256((prompt_path.parent/'tool-schemas.json').read_bytes()).hexdigest(),budget_file,100)
 # Each request is independently reserved again immediately before dispatch.
 # Bound a creation and, where relevant, a grading turn at 32768 prompt tokens.
 turns=sum(2 if s['kind'] in ['quiz','question'] else 1 for s in scenarios)
 per_turn=5*((32768+2*(32768+2048))*PilotBudget.PREFILL+2048*PilotBudget.SAMPLE+(32768+2048)*PilotBudget.TRAIN)/1e6
 ledger=json.loads(budget_file.read_text())
 plan={'steps':len(scenarios),'maximum_assistant_turns':turns,'worst_case_reservation_usd':1+turns*per_turn,'prior_reservation_usd':ledger['reserved_usd'],'rollouts_per_case':1,'rollout_staleness':0,'feedback':'Current compiler, actual canonical actions and local tool execution; automated, not human feedback.','train_case_hash':hashlib.sha256(cases.read_bytes()).hexdigest(),'eval_case_hash':hashlib.sha256(evaluation_cases.read_bytes()).hexdigest()}
 if ledger['reserved_usd']+plan['worst_case_reservation_usd']+2>100:raise ValueError('Preserve at least $2 for post-training evaluation; reduce training cases')
 if dry_run:print(json.dumps(plan));return
 if not os.environ.get('TINKER_API_KEY'):raise ValueError('Server-held credential required')
 run_dir.mkdir(parents=True,exist_ok=False,mode=0o700);write_json(run_dir/'preflight.json',plan)
 harness=Harness(prompt_path,budget_file);tinker=harness.tinker
 metadata={'owner_did':parent['owner_did'],'product':'keating','purpose':'fresh-interaction-sdpo'}
 with harness.budget.reserve('interaction-sdpo-storage',fixed_usd=1):
  trainer=harness.service.create_training_client_from_state(parent['training_state_path'],user_metadata=metadata)
 checkpoint=parent['sampler_path'];running_mean=None;metrics=[]
 for step,scenario in enumerate(scenarios):
  current=harness.service.create_sampling_client(model_path=checkpoint)
  directory=run_dir/scenario['id']
  evidence=harness.trajectory(current,scenario,directory,'fresh-sdpo-'+scenario['id'],temperature=1)
  datums=[];diagnostics=[]
  for phase in ['create','grade']:
   path=directory/f'sample-{phase}.json'
   if not path.exists():continue
   sampled=json.loads(path.read_text());feedback=evidence['creation' if phase=='create' else 'grading']
   # This feedback is computed after this exact response, never copied from an old answer.
   history=evidence['messages'][:1 if phase=='create' else 3]
   native=native_prefix(history,harness.prompt,harness.tools)
   student_prompt=harness.renderer.build_generation_prompt(native,effort=.1)
   if student_prompt.to_ints()!=sampled['prompt_tokens']:raise ValueError('Rollout context changed')
   hint={'source':feedback['feedback_source'],'passed':feedback['passed'],'observation':feedback['feedback']}
   native.insert(2,{'role':'user','content':'Post-rollout automated feedback on this exact response, provided only during training. Use it to satisfy the original learner request; do not repeat this feedback as the answer.\n'+json.dumps(hint)})
   teacher_prompt=harness.renderer.build_generation_prompt(native,effort=.1)
   tokens=sampled['completion_tokens'];lps=sampled['rollout_logprobs']
   student_full=tinker.ModelInput.from_ints(sampled['prompt_tokens']+tokens)
   teacher_full=tinker.ModelInput.from_ints(teacher_prompt.to_ints()+tokens)
   if teacher_full.length>32768:raise ValueError('Feedback-conditioned prompt exceeds the pilot limit')
   with harness.budget.reserve('fresh-student-teacher-logprobs',prefill=student_full.length+teacher_full.length):
    sf=current.compute_logprobs(student_full);tf=current.compute_logprobs(teacher_full)
    student_lps=completion_lps(sf.result(),student_prompt.length,len(tokens));teacher_lps=completion_lps(tf.result(),teacher_prompt.length,len(tokens))
   advantages,running_mean,clip=prepare_advantages(teacher_lps,student_lps,running_mean)
   vectors=datum_vectors(sampled['prompt_tokens'],tokens,lps,advantages)
   datums.append(tinker.Datum(model_input=tinker.ModelInput.from_ints(vectors['input_tokens']),loss_fn_inputs={'target_tokens':tinker.TensorData(data=vectors['target_tokens'],dtype='int64'),'logprobs':tinker.TensorData(data=vectors['logprobs'],dtype='float32'),'advantages':tinker.TensorData(data=vectors['advantages'],dtype='float32')}))
   diagnostics.append({'phase':phase,'clip':clip,'feedback':hint,'prompt_length':student_prompt.length,'completion_length':len(tokens),'rollout_lps':lps,'current_lps':student_lps})
  with harness.budget.reserve('fresh-interaction-ppo',train=sum(d.model_input.length for d in datums)):
   backward=trainer.forward_backward(datums,loss_fn='ppo',loss_fn_config={'clip_low_threshold':.8,'clip_high_threshold':1.2}).result()
   trainer.optim_step(tinker.AdamParams(learning_rate=1e-5)).result()
  for d,out in zip(diagnostics,backward.loss_fn_outputs):
   d['alignment']=completion_alignment(d['prompt_length'],d['completion_length'],d.pop('rollout_lps'),out['logprobs'].data,d.pop('current_lps'))
  state=trainer.save_state(f'interaction-{step+1}',ttl_seconds=86400).result().path
  checkpoint=trainer.save_weights_for_sampler(f'interaction-{step+1}',ttl_seconds=86400).result().path
  metrics.append({'step':step+1,'case':scenario['id'],'creation_passed':evidence['creation']['passed'],'grading_passed':evidence.get('grading',{}).get('passed'),'staleness':0,'diagnostics':diagnostics,'provider_metrics':backward.metrics,'sampler_path':checkpoint})
  write_json(run_dir/'steps.json',metrics);write_json(run_dir/'checkpoint.json',{'training_state_path':state,'sampler_path':checkpoint})
  print(json.dumps({'completed_step':step+1,'assistant_turns':len(datums),'creation_passed':evidence['creation']['passed'],'grading_passed':evidence.get('grading',{}).get('passed')}),flush=True)
 result={k:parent[k] for k in ['owner_did','model','renderer','effort','system_prompt_sha256','tools_sha256','tool_count','budget_file','cap_usd']}
 result.update(schema_version=1,method='sdpo-inspired-fresh-interaction-feedback',training_state_path=state,sampler_path=checkpoint,parent_sampler_path=parent['sampler_path'],parent_training_state_path=parent['training_state_path'],public_model_id='keating-bot-openui-sdpo',public_model_name='Keating Bot (OpenUI + SDPO)',additional_updates=len(metrics),cumulative_sdpo_updates=len(metrics),created_at=datetime.now(timezone.utc).isoformat(),checkpoint_ttl_seconds=86400,evaluated=False,quality_improvement_verified=False,limitations=['One fresh rollout per distinct authored situation. Feedback is automated contract/action execution evidence.','No live human feedback or causal learner outcome claims.','Clipped PPO and 3x EMA advantage clipping; not an exact SDPO++ reproduction.','Train families remain separate from the evaluation cases.'])
 write_json(run_dir/'result.json',result)
 print(json.dumps({'run_dir':str(run_dir),'steps':len(metrics),'reserved_usd':json.loads(budget_file.read_text())['reserved_usd']}))
if __name__=='__main__':app()
