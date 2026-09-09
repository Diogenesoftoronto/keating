#!/usr/bin/env python3
"""Validate supplemental Codex-subagent judgments without replacing original API reviews."""
import copy
from pathlib import Path
import typer
import benchmark as b
from benchmark_judge import validate_ratings

app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
DEFAULT= b.ROOT/'.keating/outputs/training/benchmark-v2-agent-completion'
REVIEWERS={'a':'benchmark_cases','b':'account_preflight'}

def collect(directory, require_complete=True):
    directory=Path(directory);mapping=b.read_json(directory/'mapping.json')
    records=[];missing=[]
    b.require(len({x['review_id'] for x in mapping})==len(mapping),'Duplicate review assignment')
    for item in mapping:
        path=directory/item['partition']/'reviews'/(item['review_id']+'.json')
        if not path.exists():missing.append(item['review_id']);continue
        packet_path=directory/item['partition']/(item['review_id']+'.json')
        packet=b.read_json(packet_path);review=b.read_json(path)
        b.require(review.get('review_id')==item['review_id'],'Review assignment mismatch')
        b.require(review.get('reviewer_kind')=='codex_subagent' and review.get('reviewer_id')==REVIEWERS[item['partition']],'Reviewer identity mismatch')
        b.require(packet['case']['id']==item['case_id'],'Case assignment mismatch')
        b.require(b.digest(b.canonical(packet['transcript']))==item['transcript_sha256'],'Transcript binding mismatch')
        ratings=validate_ratings(packet['case'],packet['transcript'],{'ratings':review.get('ratings')})
        values=[r['score'] for r in ratings]
        records.append({'model_id':item['model_id'],'case_id':item['case_id'],'review_id':item['review_id'],
            'reviewer_kind':'codex_subagent','reviewer_id':review['reviewer_id'],'reviewer_model':None,
            'status':'reviewed','transcript_sha256':item['transcript_sha256'],
            'case_sha256':b.digest(b.canonical(packet['case'])), 'packet_sha256':b.digest(packet_path.read_bytes()),
            'review_sha256':b.digest(path.read_bytes()),'ratings':copy.deepcopy(ratings),
            'quality':50*sum(values)/len(values) if values and all(type(v) is int for v in values) else None,
            'calibration':'Not calibrated against the original API reviewer or independent human reviewers',
            'cost_usd':None,'cost_note':'No external provider API request made; agent execution cost not measured by the benchmark',
            'limitations':'Supplemental agent judgment, not human review. Model identities were omitted from packets; contextual blinding is not guaranteed.'})
    if require_complete:b.require(not missing,f'{len(missing)} assigned reviews remain missing')
    return {'kind':'supplemental-agent-judgments','assignment_count':len(mapping),'reviewed_count':len(records),'missing_ids':missing,
            'original_api_reviews_unchanged':True,'mapping_sha256':b.digest((directory/'mapping.json').read_bytes()),
            'context_sha256':b.digest((directory/'context.json').read_bytes()),'records':records}

@app.command()
def main(directory:Path=DEFAULT,output:Path|None=None,allow_partial:bool=False):
    value=collect(directory,not allow_partial)
    if output:b.write_json(output,value)
    print(b.canonical({'assigned':value['assignment_count'],'reviewed':value['reviewed_count'],'missing':len(value['missing_ids'])}))
if __name__=='__main__':app()
