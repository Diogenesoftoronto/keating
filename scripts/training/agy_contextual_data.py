"""Run resumable Gemini 3.8 Flash data drafting/review through the user's agy CLI.

Each job owns one output file. Never starts policy training or a compute provider.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import time
import native_data_expansion as data

PROMPTS=Path(__file__).parent/'prompts'

def run_batch(directory, name, phase, timeout_minutes):
    directory=Path(directory).resolve()
    manifest=data.read(directory/'manifest.json')
    source=directory/(name+'.input.json')
    data.require(source.name in manifest['batch_hashes'], 'Unregistered batch')
    packet=data.read(source)
    data.require(data.native.digest(packet)==manifest['batch_hashes'][source.name], 'Batch changed')
    target=directory/(name+('.draft.json' if phase=='draft' else '.review.json'))
    draft=directory/(name+'.draft.json')
    if phase=='review':data.validate_draft(data.read(draft),packet)
    if target.exists():
        # agy can leave a syntactically valid file before a quota/timeout error.
        # File presence alone is not completion evidence, including on resume.
        target_hash=hashlib.sha256(target.read_bytes()).hexdigest()
        receipts=[data.read(p) for p in directory.glob(f'{name}.{phase}.*.receipt.json')]
        data.require(any(r.get('exit_code')==0 and r.get('output_sha256')==target_hash
            and r.get('input_hash')==data.native.digest(packet) for r in receipts),
            'Existing output has no matching successful agy receipt; preserve it for review before retrying')
        if phase=='draft':data.validate_draft(data.read(target),packet)
        else:
            review=data.read(target)
            data.require(review['draft_sha256']==data.native.digest(data.read(draft)) and review['model']==data.MODEL,'Stale review')
        return {'batch':name,'phase':phase,'status':'existing-output-retained'}
    prompt=(PROMPTS/f'contextual-data-{phase}.md').read_text()
    prompt=prompt.replace('INPUT_PATH',str(source)).replace('DRAFT_PATH',str(draft)).replace('OUTPUT_PATH',str(target))
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    log=directory/f'{name}.{phase}.{stamp}.log'
    started=time.monotonic()
    with log.open('x') as stream:
        result=subprocess.run(['agy','--model',data.MODEL,'--effort','high','--mode','accept-edits',
            '--dangerously-skip-permissions','--print-timeout',f'{timeout_minutes}m','-p',prompt],
            stdout=stream,stderr=subprocess.STDOUT,timeout=timeout_minutes*60+30)
    receipt={'batch':name,'phase':phase,'model':data.MODEL,'started_at':stamp,'exit_code':result.returncode,
        'elapsed_seconds':round(time.monotonic()-started,2),'input_hash':data.native.digest(packet),
        'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest(),'log_sha256':hashlib.sha256(log.read_bytes()).hexdigest(),
        'output_sha256':hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None}
    data.write(directory/f'{name}.{phase}.{stamp}.receipt.json',receipt)
    data.require(result.returncode==0 and target.is_file(),f'agy {phase} did not finish: {name}; inspect {log}')
    if phase=='draft':data.validate_draft(data.read(target),packet)
    else:
        review=data.read(target)
        data.require(review['model']==data.MODEL and review['draft_sha256']==data.native.digest(data.read(draft)), 'Review draft binding failed')
    return {k:v for k,v in receipt.items() if k in {'batch','phase','elapsed_seconds','exit_code'}}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['draft','review']);parser.add_argument('directory',type=Path)
    parser.add_argument('--batch',action='append');parser.add_argument('--jobs',type=int,default=2)
    parser.add_argument('--timeout-minutes',type=int,default=15)
    args=parser.parse_args()
    data.require(1<=args.jobs<=6 and 1<=args.timeout_minutes<=30,'Bound jobs 1..6 and timeout 1..30 minutes')
    manifest=data.read(args.directory/'manifest.json')
    names=args.batch or [n.removesuffix('.input.json') for n in manifest['batch_hashes']]
    data.require(len(set(names))==len(names), 'Duplicate batch')
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for result in pool.map(lambda n:run_batch(args.directory,n,args.phase,args.timeout_minutes),names):
            print(json.dumps(result),flush=True)

if __name__=='__main__':main()
