#!/usr/bin/env python3
"""Attach separately attributed agent judgments to the public v2 report."""
import copy,json,sys
from pathlib import Path
import typer
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/training'))
import benchmark as b
from benchmark_agent_reviews import collect
from benchmark_judge import validate_ratings
from update_benchmark_v2 import public_guard
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)

def apply_reviews(data, registry):
    result=copy.deepcopy(data)
    cases={c['id']:c for c in result['cases']}
    rows={(m['id'],r['case_id']):r for m in result['models'] for r in m['rows']}
    for row in rows.values():
        row.setdefault('quality_api',row['quality'])
        row['quality_supplemental']=None
        row['quality']=row['quality_api']
        row.pop('supplemental_review',None)
        row['quality_source']='openai-api' if row['quality_api'] is not None else 'unavailable'
    seen=set()
    for review in registry['records']:
        key=(review['model_id'],review['case_id'])
        b.require(key in rows and key not in seen,'Unknown or duplicate supplemental target');seen.add(key)
        row=rows[key]
        b.require(row['quality_api'] is None and row['stop']=='final_response','Supplement may only review missing recorded final turns')
        b.require(review['transcript_sha256']==b.digest(b.canonical(row['transcript'])),'Supplement transcript mismatch')
        b.require(review['case_sha256']==b.digest(b.canonical(cases[key[1]])),'Supplement case mismatch')
        ratings=validate_ratings(cases[key[1]],row['transcript'],{'ratings':review['ratings']})
        values=[r['score'] for r in ratings]
        expected=50*sum(values)/len(values) if values and all(type(v) is int for v in values) else None
        b.require(review['quality']==expected,'Supplement score disagrees with validated ratings')
        row['supplemental_review']=copy.deepcopy(review)
        row['quality_supplemental']=review['quality']
        row['quality']=review['quality']
        row['quality_source']='codex-subagent' if review['quality'] is not None else 'unavailable'
    result['quality_label']='AI rubric score (mixed reviewers)'
    result['quality_available']=any(r['quality'] is not None for r in rows.values())
    result['review_completion']={'kind':'supplemental-agent-judgments','requested':registry['assignment_count'],
        'reviewed':len(seen),'scored':sum(r['quality_supplemental'] is not None for r in rows.values()),
        'original_api_scored':sum(r['quality_api'] is not None for r in rows.values()),
        'combined_scored':sum(r['quality'] is not None for r in rows.values()),
        'registry_sha256':b.digest(b.canonical(registry)),
        'note':'Original API reviews remain unchanged. Missing recorded final turns were reviewed by Codex subagents using the same case rubrics. These are AI judgments, not human ratings; reviewers were not cross-calibrated. Reviewer proportions differ by model, so mixed-score differences can reflect reviewer differences. Provider failures and unfinished episodes are not invented or silently completed.',
        'agent_execution_cost_usd':None,'external_provider_api_calls':0}
    public_guard(result)
    return result

@app.command()
def main(directory:Path=ROOT/'.keating/outputs/training/benchmark-v2-agent-completion',report_path:Path=ROOT/'web/public/reports/learning-to-teach/report-data.json'):
    registry=collect(directory,True)
    report=b.read_json(report_path)
    report['benchmark_v2']=apply_reviews(report['benchmark_v2'],registry)
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    receipt=directory/'validated-registry.json'
    if not receipt.exists():b.write_json(receipt,registry)
    print(b.canonical(report['benchmark_v2']['review_completion']))
if __name__=='__main__':app()
