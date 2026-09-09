#!/usr/bin/env python3
"""Frozen multi-provider teaching episodes. Evaluation cap removed by user; no training."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
import typer
import benchmark as b
import benchmark_providers as p

app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)
SUITE = Path(__file__).parent / 'benchmarks/teaching-v2'
RUNNER_SOURCES = ('benchmark_retest.py', 'benchmark_providers.py', 'benchmark.py', 'pilot_budget.py', 'pyproject.toml', 'uv.lock')

def verify_frozen_suite(suite):
    """Check the case files, complete executable checker closure, and Python adapters before dispatch."""
    suite = Path(suite)
    manifest = b.read_json(suite/'manifest.json')
    for name, expected in manifest.get('files',{}).items():
        b.require(Path(name).name == name, 'Frozen suite paths must be local filenames')
        b.require(b.digest((suite/name).read_bytes()) == (expected.get('sha256') if isinstance(expected,dict) else expected), f'Frozen file changed: {name}')
    loaded = b.load_suite(suite)
    inventory = subprocess.run(['rtk','proxy','bun',str(Path(__file__).with_name('benchmark_dependencies_v2.ts'))], cwd=b.ROOT, capture_output=True, timeout=90)
    b.require(inventory.returncode == 0, 'Could not inventory the v2 checker and tool runtime')
    resolved = json.loads(inventory.stdout)
    b.require(manifest.get('contract_sources') == resolved['contract_sources'], 'Frozen checker/tool dependency closure changed or is incomplete')
    b.require(manifest.get('contract_runtime') == resolved['contract_runtime'], 'Frozen Bun runtime changed')
    sources = manifest.get('runner_sources',{})
    b.require(all(f'scripts/training/{name}' in sources for name in RUNNER_SOURCES), 'Frozen Python runner sources are incomplete')
    for name, expected in sources.items():
        path = Path(name)
        b.require(not path.is_absolute() and '..' not in path.parts, 'Runner source paths must stay inside the repository')
        b.require(b.digest((b.ROOT/path).read_bytes()) == expected, f'Frozen runner source changed: {name}')
    return loaded

def eligible(arms):
    return [a for a in arms if a['provider'] not in ('anthropic', 'gemini') and not any(s in a['model'].lower() for s in ('claude','gemini'))]

def command_json(script, value):
    with tempfile.TemporaryDirectory(prefix='keating-v2-') as directory:
        source, target = Path(directory)/'input.json', Path(directory)/'output.json'
        b.write_json(source, value)
        result = subprocess.run(['rtk','proxy','bun',str(Path(__file__).parent/script),str(source),str(target)], capture_output=True, timeout=90)
        b.require(result.returncode == 0, f'{script} failed; no checker result was accepted')
        return b.read_json(target)

def totals(calls):
    def total(key):
        values = [(c.get('usage') or {}).get(key) for c in calls]
        return sum(values) if values and all(type(v) is int for v in values) else None
    costs = [c.get('cost_usd') for c in calls]
    return {'input_tokens':total('prompt_tokens'), 'output_tokens':total('completion_tokens'),
            'cached_input_tokens':total('cached_input_tokens'), 'reasoning_tokens':total('reasoning_tokens'),
            'cost_usd':sum(costs) if costs and all(v is not None for v in costs) else None,
            'known_cost_usd':sum(v for v in costs if v is not None),
            'provider_seconds':sum(c['wall_seconds'] for c in calls)}

def episode(case, context, dispatch, tool_step=command_json):
    history = copy.deepcopy(case['messages'])
    transcript, turns, calls, executions = [], [], [], []
    start = time.monotonic()
    limit = case.get('episode',{}).get('max_assistant_turns',3)
    b.require(type(limit) is int and 1 <= limit <= 3, 'Episode must have 1–3 assistant turns')
    stop = 'turn_limit'
    for index in range(limit):
        payload = {'messages':[{'role':'system','content':context['system_prompt']},*history],
                   'tools':context['tools'], 'max_tokens':case['max_tokens'], 'temperature':.1,'top_p':1,'seed':42,'n':1,'stream':False}
        try:
            receipt = dispatch({'case_id':case['id'],'payload':payload}, index)
        except Exception as error:
            receipt = {'error':{'kind':type(error).__name__,'stage':'dispatch'},'wall_seconds':0}
        calls.append(receipt)
        if receipt.get('error'):
            stop = 'provider_error'
            break
        response = receipt['response']
        turns.append(response)
        message = {'role':'assistant','content':response.get('content') or ''}
        if response.get('tool_calls'):
            message['tool_calls'] = response['tool_calls']
        history.append(message); transcript.append(message)
        if response.get('finish_reason') == 'length':
            stop = 'truncated'; break
        if not response.get('tool_calls'):
            stop = 'final_response'; break
        try:
            step = tool_step('benchmark_tool_step.ts', {'case':case,'tools':context['tools'],'turns':turns})
            executions = step['execution']
            history.extend(step['tool_messages']); transcript.extend(step['tool_messages'])
        except Exception as error:
            stop = 'harness_error'
            executions.append({'status':'unavailable','stage':'tool_step','kind':type(error).__name__})
            break
    return {'case_id':case['id'],'category':case['category'],'turns':turns,'transcript':transcript,
            'measurement_status':'unavailable' if stop in ('provider_error','harness_error') else 'collected',
            'calls':calls,'tool_execution':executions,'stop':stop,'latency_seconds':time.monotonic()-start,**totals(calls)}

class HttpDispatch:
    def __init__(self, arm):
        import httpx
        self.arm, self.client = arm, httpx.Client(timeout=180)
        self.key = p.load_key(arm)
    def __call__(self, request, index):
        wire = p.build_request(self.arm,request)
        receipt = {'request_sha256':wire['native_request_sha256'],'request':wire['payload']}
        start = time.monotonic()
        try:
            result = self.client.post(wire['endpoint'],json=wire['payload'],headers={'Authorization':'Bearer '+self.key})
            raw = result.json()
            receipt['raw'] = raw
            if result.status_code != 200 or raw.get('error'):
                receipt['error'] = p.safe_error(raw,result.status_code)
            else:
                response, usage, returned = p.normalize(self.arm['provider'],raw,f"{request['case_id']}-turn-{index+1}")
                receipt.update(response=response,usage=usage,returned=returned,cost_usd=p.usage_cost(self.arm,usage))
        except Exception as error:
            receipt['error'] = {'kind':type(error).__name__}
        receipt['wall_seconds'] = time.monotonic()-start
        return receipt

class NativeDispatch:
    def __init__(self, arm):
        import tinker
        from tinker_cookbook import renderers, tokenizer_utils
        self.arm, self.tinker, self.renderers = arm,tinker,renderers
        api_key = p.load_key(arm)
        self.renderer = renderers.get_renderer(arm['renderer'],tokenizer_utils.get_tokenizer(arm['base_model']),model_name=arm['base_model'])
        self.service = tinker.ServiceClient(api_key=api_key)
        self.client = self.service.create_sampling_client(**({'model_path':arm['sampler_path']} if arm.get('sampler_path') else {'base_model':arm['base_model']}))
    def __call__(self, request, index):
        from tinker_cookbook.renderers.base import ToolCall
        payload, arm = request['payload'], self.arm
        start, receipt = time.monotonic(), {}
        try:
            history = copy.deepcopy(payload['messages'][1:])
            for message in history:
                if message.get('tool_calls'):
                    message['tool_calls'] = [ToolCall.model_validate(c) for c in message['tool_calls']]
            if arm['renderer'] == 'tml_v0':
                prefix = [{'role':'system','content':payload['messages'][0]['content']},
                          {'role':'tool_declare','content':json.dumps(payload['tools'],separators=(',',':'))}]
                prompt = self.renderer.build_generation_prompt(prefix+history,effort=.1)
            else:
                prefix = self.renderer.create_conversation_prefix_with_tools([copy.deepcopy(t['function']) for t in payload['tools']],system_prompt=payload['messages'][0]['content'])
                prompt = self.renderer.build_generation_prompt(prefix+history)
            b.require(prompt.length+payload['max_tokens'] <= arm.get('context_limit',65536), 'Context limit exceeded; no truncation')
            receipt.update(request_sha256=b.digest(b.canonical(prompt.to_ints())),prompt_tokens=prompt.length)
            params = self.tinker.SamplingParams(max_tokens=payload['max_tokens'],temperature=.1,top_p=1,seed=42,stop=self.renderer.get_stop_sequences())
            sampled = self.client.sample(prompt,num_samples=1,sampling_params=params).result(timeout=240)
            sequence = sampled.sequences[0]
            parsed, finished = self.renderer.parse_response(sequence.tokens)
            calls=[]
            for n, call in enumerate(parsed.get('tool_calls',[])):
                value = call.model_dump(mode='json') if hasattr(call,'model_dump') else dict(call)
                value['id']=f"{request['case_id']}-{index}-{n}"
                calls.append(value)
            usage={'prompt_tokens':prompt.length,'completion_tokens':len(sequence.tokens),'cached_input_tokens':None,'reasoning_tokens':None}
            reason = getattr(sequence,'stop_reason',None)
            response={'content':self.renderers.get_text_content(parsed),'tool_calls':calls,'finish_reason':'length' if reason=='length' or len(sequence.tokens)>=payload['max_tokens'] else 'tool_calls' if calls else 'stop'}
            receipt.update(response=response,usage=usage,cost_usd=p.usage_cost(arm,usage),tokens=list(sequence.tokens),parse_finished=bool(finished),stop_reason=reason)
        except Exception as error:
            receipt['error']={'kind':type(error).__name__}
        receipt['wall_seconds']=time.monotonic()-start
        return receipt

def run_arm(arm, cases, context, output):
    identity=p.arm_id(arm); directory=output/identity; directory.mkdir(mode=0o700)
    public={k:v for k,v in arm.items() if k not in ('key_file','api_key_env')}
    result={'id':identity,'arm':public,'status':'running','rows':[]}
    path=directory/'results.json'; p.atomic_write(path,result)
    try:
        dispatch=NativeDispatch(arm) if arm['provider']=='tinker-native' else HttpDispatch(arm)
    except Exception as error:
        result.update(status='unavailable',error={'kind':type(error).__name__})
        p.atomic_write(path,result); return result
    for case in cases:
        row=episode(case,context,dispatch)
        row['checks'] = None
        if row['turns'] and row['measurement_status'] == 'collected':
            try:
                row['checks']=command_json('benchmark_check_v2.ts',{'case':case,'tools':context['tools'],'turns':row['turns']})
            except Exception as error:
                row['checking_error']={'kind':type(error).__name__,'stage':'contract_check'}
                row['measurement_status']='unavailable'
        result['rows'].append(row); p.atomic_write(path,result)
        print(b.canonical({'arm':identity,'completed':len(result['rows']),'total':len(cases),'stop':row['stop']}),flush=True)
    result['status']='complete'; p.atomic_write(path,result)
    return result

@app.command()
def main(config:Path=typer.Option(...),output_dir:Path=typer.Option(...),suite:Path=SUITE,execute:bool=False,workers:int=3):
    b.require(1<=workers<=6,'Choose 1–6 concurrent models')
    loaded=verify_frozen_suite(suite)
    cases, context = loaded['cases'], loaded['context']
    arms=eligible(b.read_json(config)['arms'])
    b.require(arms and len({p.arm_id(a) for a in arms})==len(arms),'Distinct eligible models required')
    output_dir.mkdir(parents=True,exist_ok=False,mode=0o700)
    b.write_json(output_dir/'plan.json',{'suite_sha256':b.digest((suite/'manifest.json').read_bytes()),'cases':[c['id'] for c in cases],
        'arms':[{k:v for k,v in a.items() if k not in ('key_file','api_key_env')} for a in arms],
        'evaluation_cap_usd':None,'authorization':'User removed USD20 evaluation cap; Claude and Gemini excluded',
        'max_assistant_turns':3,'retries':0,'human_scores':None,'cost_note':'Uncached token estimates; cache counts recorded when available; not invoices. Tinker rates include discount once.',
        'runner_sha256':b.digest(Path(__file__).read_bytes())})
    if not execute:
        print(f'Prepared {len(arms)} models × {len(cases)} cases; add --execute to run.'); return
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures=[pool.submit(run_arm,a,cases,context,output_dir) for a in arms]
        results=[f.result() for f in futures]
    b.write_json(output_dir/'summary.json',{'models':len(results),'episodes':sum(len(r['rows']) for r in results),
        'known_cost_usd':sum(row['known_cost_usd'] for r in results for row in r['rows']), 'status':'complete'})

if __name__=='__main__': app()
