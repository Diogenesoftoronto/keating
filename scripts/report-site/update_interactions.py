#!/usr/bin/env python3
"""Publish only authored scenario traces and aggregate results, never model credentials."""
import json,sys
from pathlib import Path
import typer
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/training'))
from estimate_cost import estimate
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
@app.command()
def main():
 source=ROOT/'web/public/reports/learning-to-teach';path=source/'report-data.json';data=json.loads(path.read_text());base=ROOT/'.keating/outputs/training'
 round={'cases':json.loads((ROOT/'scripts/training/data/interaction-eval.json').read_text())['cases']}
 for arm,folder in [('before','openui-eval-before'),('after','openui-eval-after'),('sdpo','openui-eval-sdpo')]:
  report=json.loads((base/folder/'evaluation.json').read_text())
  if len(report['traces'])!=len(round['cases']):raise ValueError('Incomplete evaluation')
  round[arm]=[{k:t[k] for k in ['scenario','messages','passed']}|{'system_prompt_sha256':report['system_prompt_sha256'],'creation':{k:t['creation'][k] for k in ['passed','feedback']},**({'grading':{k:t['grading'][k] for k in ['passed','feedback']}} if 'grading' in t else {})} for t in report['traces']]
  round[arm+'_passed']=report['passed']
 round['summary']=f"16 OpenUI SFT updates, then 6 fresh-feedback SDPO updates. Full interaction checks: {round['before_passed']}/7 → {round['after_passed']}/7 → {round['sdpo_passed']}/7. Identity and arithmetic controls are included."
 round['observations']={
  'test-temperature-quiz':'Both OpenUI-trained checkpoints create four valid questions, submit through the real action contract, and grade the pending open-ended answer with its actual ID. The temperature answer keys were inspected and are correct.',
  'test-speed-cards':'Both OpenUI-trained checkpoints create four valid cards and complete a synthetic review. The SDPO version also covers average versus instantaneous speed, which the SFT version omitted. These examples do not measure later recall.',
  'test-probability-check':'SFT produces a valid question, but its grading response contains malformed native tool markup. The SDPO checkpoint returns an executable grade_question_checks call for the same submitted question. The prose could be more precise about the 50% probability.',
  'test-fare-simulation':'Both OpenUI-trained checkpoints compile a simulation with the correct fare expression: 5 + 2 × distance. The controls and readouts execute locally in this report.',
  'test-time-exam':'SFT refers to an undefined questions binding. SDPO writes twenty questions with correct conversion answer keys, but passes too many arguments to Exam, so it still fails to compile. It also omits the requested across-midnight situations. More generated content is not a passing interaction.',
  'test-identity':'The latest-version Keating Bot identity remains an explicit regression check; it does not measure teaching quality.',
  'test-arithmetic':'All variants are checked against 7 × 8 = 56. This is a small regression control, not a broad mathematics benchmark.'}
 round['training_rollouts']={'count':6,'creation_passes':0,'sampling_temperature':1,'feedback':'All six fresh training responses failed before submission; SDPO used their exact compiler/contract errors. No grading tool executed inside these six training trajectories.'}
 round['evaluation_temperature']=0
 round['sdk_temperature']=0.1
 data['interaction_round']=round
 data['cost']=estimate(json.loads((base/'inkling-pilot/budget.json').read_text()))
 path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'scores':{arm:round[arm+'_passed'] for arm in ['before','after','sdpo']},'reservation_usd':data['cost']['safety_reservation_usd']}))
if __name__=='__main__':app()
