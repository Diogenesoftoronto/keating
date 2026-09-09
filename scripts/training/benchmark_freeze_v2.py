#!/usr/bin/env python3
"""Seal the authored v2 release once, before candidate dispatch."""
import json
from pathlib import Path
import subprocess
import typer
import benchmark as b
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
@app.command()
def main(suite:Path=Path(__file__).parent/'benchmarks/teaching-v2'):
    b.require(not (suite/'manifest.json').exists(),'Release already sealed; create a new version for changes')
    source=b.read_json(suite/'cases.json'); cases=source['cases'] if isinstance(source,dict) else source
    b.require(len(cases)==48 and len({c['id'] for c in cases})==48,'Expected48distinct authored cases')
    b.require(sum(c['tier']=='core' for c in cases)==16,'Expected16core cases')
    b.require(sum(len(c['messages'])>=12 for c in cases)>=8,'Expected eight substantive long histories')
    b.require(len({c['family'] for c in cases})>=10,'Insufficient task variety')
    b.require(all(c['messages'][-1]['role']=='user' and c['rubric'] and 1<=c.get('episode',{}).get('max_assistant_turns',3)<=3 for c in cases),'Invalid case boundary')
    context=b.read_json(suite/'context.json'); b.require(context['provenance']['private_context'] is False,'Only public default context')
    dependencies=json.loads(subprocess.run(['rtk','proxy','bun','scripts/training/benchmark_dependencies_v2.ts'],check=True,capture_output=True,text=True).stdout)
    files=['cases.json','rubric.json','context.json','judge-calibration.json','README.md']
    sources=['benchmark_retest.py','benchmark_providers.py','benchmark.py','pilot_budget.py','benchmark_judge.py','benchmark_review_batch.py','pyproject.toml','uv.lock']
    manifest={'id':'teaching-v2','benchmark_id':source['benchmark_id'],'version':2,'created_at':b.now(),'case_count':48,'core_count':16,
        'files':{name:b.digest((suite/name).read_bytes()) for name in files},**dependencies,
        'runner_sources':{f'scripts/training/{name}':b.digest((Path(__file__).parent/name).read_bytes()) for name in sources},
        'boundary':'Frozen authored development benchmark; no private real learner text; no human learning measurements',
        'sampling':{'attempts_per_model_case':1,'max_assistant_turns':3,'temperature':.1,'top_p':1,'seed':42,'provider_native_overrides':'Recorded per model; native controls vary'},
        'grading':'Objective contracts plus separately calibrated AI rubric review; human scores unknown'}
    b.write_json(suite/'manifest.json',manifest); print(b.digest((suite/'manifest.json').read_bytes()))
if __name__=='__main__': app()
