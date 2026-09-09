#!/usr/bin/env python3
"""Separately costed AI review of completed frozen benchmark episodes."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import typer
import benchmark as b
import benchmark_judge as j
import benchmark_providers as p
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)

@app.command()
def main(run_dir:Path=typer.Option(...),calibration:Path=typer.Option(...),key_file:Path=typer.Option(...),suite:Path=Path(__file__).parent/'benchmarks/teaching-v2',workers:int=4):
    control=b.read_json(calibration)
    b.require(control.get('passed') is True and control.get('status') == 'complete','Calibration did not pass; candidate results remain available without AI scores')
    b.require(control.get('calibration_sha256') == b.digest((suite/'judge-calibration.json').read_bytes()),'Calibration controls changed')
    calibration_reviews=[r for pair in control['pairs'] for r in pair['reviews'].values()]
    b.require(len(calibration_reviews)==16 and all(r['judge_prompt_sha256']==b.digest(j.SYSTEM) and r['judge_settings']==j.SETTINGS for r in calibration_reviews),'Calibration reviewer mismatch')
    b.require(1<=workers<=6,'Choose 1–6 reviewers')
    source=b.read_json(suite/'cases.json'); source=source['cases'] if isinstance(source,dict) else source
    cases={c['id']:c for c in source}; context=b.read_json(suite/'context.json')
    manifest=b.read_json(suite/'manifest.json')
    for name, expected in manifest['files'].items():
        b.require(b.digest((suite/name).read_bytes())==expected,'Frozen review material changed')
    plan=b.read_json(run_dir/'plan.json')
    b.require(plan['suite_sha256']==b.digest((suite/'manifest.json').read_bytes()),'Suite does not match candidate run')
    for c in cases.values(): c['system_prompt']=context['system_prompt']
    tasks=[]
    for path in sorted(run_dir.glob('*/results.json')):
        result=b.read_json(path)
        directory=path.parent/'reviews'; directory.mkdir(exist_ok=True,mode=0o700)
        for row in result['rows']:
            target=directory/(row['case_id']+'.json')
            if row['transcript'] and not target.exists(): tasks.append((result['arm']['model'],row,target))
    def review(task):
        model,row,target=task
        receipt=j.judge_case(cases[row['case_id']],row['transcript'],j.transport(key_file),candidate_model=model)
        usage=receipt.get('usage') or {}
        receipt['cost_usd']=(usage['input_tokens']*4+usage['output_tokens']*20)/1e6 if all(type(usage.get(k)) is int for k in ('input_tokens','output_tokens')) else None
        b.write_json(target,receipt)
        print(b.canonical({'case':row['case_id'],'model':model,'status':receipt['status']}),flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool: list(pool.map(review,tasks))
    receipts=[b.read_json(path) for path in run_dir.glob('*/reviews/*.json')]
    p.atomic_write(run_dir/'judge-summary.json',{'calibration_sha256':b.digest(calibration.read_bytes()),'calibration_passed':True,'reviews':len(receipts),'known_cost_usd':sum(r.get('cost_usd') or 0 for r in receipts),'calibration_cost_usd':sum(((r.get('usage') or {}).get('input_tokens',0)*4+(r.get('usage') or {}).get('output_tokens',0)*20)/1e6 for r in calibration_reviews),'human_ratings':None,'note':'Authored calibration is not human validation; same-family judge bias remains.'})

if __name__=='__main__': app()
