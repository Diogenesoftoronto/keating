#!/usr/bin/env python3
"""Static multi-turn teaching episodes through the actual Keating CLI harness."""
import json
import math
import re
import subprocess
import time
from urllib.parse import urlparse
from pathlib import Path
import typer
import benchmark as b

app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)
SUITE = Path(__file__).parent / 'benchmarks/teaching-v3-profiles'
DRIVER = b.ROOT / 'scripts/training/benchmark_harness_v3.ts'


def load_cases(path=SUITE / 'cases.json'):
    path = Path(path)
    manifest_path = path.parent/'manifest.json'
    if manifest_path.exists():
        manifest = b.read_json(manifest_path)
        b.require(b.digest(path.read_bytes()) == manifest['files'][path.name], 'Frozen case definition changed; version the suite explicitly')
    value = b.read_json(path)
    cases = value['cases'] if isinstance(value, dict) else value
    ids = set()
    for case in cases:
        b.require(re.fullmatch(r'[a-z0-9-]+', case['id']) and case['id'] not in ids, 'Invalid or duplicate case ID')
        ids.add(case['id'])
        b.require(4 <= sum(s['kind'] == 'message' for s in case['steps']) <= 12, 'Expected multi-turn case')
        b.require(case['rubric'] and case['reference']['facts'], 'Missing semantic evaluation reference')
        dimensions = set()
        for rule in case['rubric']:
            b.require(rule['dimension'] not in dimensions and set(rule['criteria']) == {'0','1','2'}, 'Invalid rubric')
            dimensions.add(rule['dimension'])
            b.require(all(type(i) is int and 0 <= i < len(case['steps']) for i in rule['evidence_steps']), 'Invalid evidence step')
        for check in case.get('state_checks', []):
            b.require(0 <= check['after_step'] < len(case['steps']) and check['path'].startswith('.keating/'), 'Invalid state check')
    return cases


def request_for(case, transport):
    # Private evaluator references, rubrics and expected state are never model input.
    request = {'id': case['id'], 'transport': transport, 'steps': case['steps'],
               'seed_files': case.get('seed_files', {}),
               'limits': {'max_provider_calls': 48, 'max_tool_calls': 64,
                          'max_output_tokens': 3000, 'turn_timeout_ms': 120000}}
    if case.get('learner_profile') is not None:
        request.update(profile_name='learner', learner_profile=case['learner_profile'])
    if case.get('profile_lifecycle'):
        request['profile_name'] = 'learner'
    return request


def provider_transport(provider, model, endpoint='', api_key_env='', context_window=0, model_max_tokens=0):
    b.require(bool(provider and model), 'Provider and model required')
    b.require(not any(x in provider.lower() for x in ('openai','anthropic','google','gemini','claude')), 'Provider excluded for this experiment')
    value = {'kind':'provider','provider':provider,'model':model,'thinking':'off'}
    if endpoint:
        parsed = urlparse(endpoint)
        b.require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password and not parsed.query,
                  'Use an HTTPS inference endpoint without credentials or query parameters')
        b.require(not any(parsed.hostname == host or parsed.hostname.endswith('.'+host) for host in ('openai.com','anthropic.com','googleapis.com')), 'Endpoint excluded for this experiment')
        b.require(re.fullmatch(r'[A-Z_][A-Z0-9_]*',api_key_env) and context_window > 0 and model_max_tokens > 0,
                  'Custom endpoint requires --api-key-env, --context-window and --model-max-tokens')
        value.update(endpoint=endpoint,apiKeyEnv=api_key_env,modelMetadata={'contextWindow':context_window,'maxTokens':model_max_tokens})
    else:
        b.require(not api_key_env and not context_window and not model_max_tokens, 'Custom model settings require --endpoint')
    return value


def summarize(case, result, elapsed):
    checks = []
    for check in case.get('state_checks', []):
        steps = result.get('steps', [])
        step = steps[check['after_step']] if len(steps) > check['after_step'] else None
        files = {f['path']: f['content'] for f in step.get('files', [])} if step else {}
        checks.append({**check, 'passed': check['contains'] in files.get(check['path'], '') if step and step['status'] == 'completed' else None})
    # Session histories repeat on every receipt. Count each assistant message once per session.
    sessions = {}
    for step in result.get('steps', []):
        sid = step.get('state', {}).get('sessionId')
        if sid: sessions[sid] = step.get('messages', [])
    messages = [m for history in sessions.values() for m in history if m.get('role') == 'assistant']
    usages = [m.get('usage') for m in messages]
    measured = bool(usages) and all(m.get('stopReason') not in ('error','aborted') for m in messages) and all(isinstance(u, dict) and type(u.get('output')) in (int,float) and math.isfinite(u['output']) and u['output'] >= 0 for u in usages)
    return {'case_id': case['id'], 'category': case['category'], 'status': result.get('status','failed'),
            'error_code': result.get('error_code'), 'measurement': result.get('measurement','unavailable'),
            'elapsed_seconds': elapsed, 'provider_calls': len(result.get('requests', [])),
            'output_tokens': sum(u['output'] for u in usages) if measured else None,
            'cost_usd': None, 'cost_note': 'No current tariff or invoice supplied; not treated as zero.',
            'state_checks': checks, 'quality': None,
            'quality_status': 'unreviewed' if result.get('status') == 'completed' else 'incomplete_episode',
            'note': 'Runtime completion and literal state checks are not teaching-quality scores.'}


@app.command()
def validate(suite: Path = SUITE):
    cases = load_cases(suite / 'cases.json')
    print(b.canonical({'cases':len(cases), 'learner_turns':sum(s['kind']=='message' for c in cases for s in c['steps']),
                       'cases_sha256': b.digest((suite/'cases.json').read_bytes()), 'track':'fixed-cli-harness'}))


@app.command()
def run(output: Path, provider: str = '', model: str = '', suite: Path = SUITE,
        case_id: str = '', tape_directory: Path | None = None, endpoint: str = '',
        api_key_env: str = '', context_window: int = 0, model_max_tokens: int = 0, runtime_root: Path | None = None):
    """Run sequential candidates; review is a separate, offline stage. Output must be new."""
    b.require(not output.exists(), 'Output exists: choose a new run directory; completed evidence is immutable')
    b.require(bool(tape_directory) or bool(provider and model), 'Supply --provider/--model or --tape-directory')
    b.require(not (tape_directory and (provider or model or endpoint or api_key_env or context_window or model_max_tokens)), 'Do not mix tape and provider transports')
    # This experiment explicitly excludes these providers; no exhausted-credit retries/fallback.
    selected_transport = None if tape_directory else provider_transport(provider,model,endpoint,api_key_env,context_window,model_max_tokens)
    cases = load_cases(suite/'cases.json')
    if case_id:
        cases = [c for c in cases if c['id'] == case_id]
        b.require(bool(cases), 'Unknown case ID')
    driver = (runtime_root.resolve()/'scripts/training/benchmark_harness_v3.ts') if runtime_root else DRIVER
    inspector = driver.with_name('benchmark_tui_openui.ts')
    b.require(driver.is_file() and inspector.is_file(), 'Runtime driver/inspector missing')
    output.mkdir(parents=True, mode=0o700)
    plan = {'track':'fixed-cli-harness','status':'planned','provider':provider or None,'model':model or None,
            'measurement':'offline_integration' if tape_directory else 'model_episode',
            'cases_sha256':b.digest((suite/'cases.json').read_bytes()),
            'runner_sha256':b.digest(Path(__file__).read_bytes()), 'driver_sha256':b.digest(driver.read_bytes()),
            'runtime_root':str(runtime_root.resolve()) if runtime_root else str(b.ROOT),
            'inspector_sha256':b.digest(inspector.read_bytes()),
            'transport':selected_transport, 'cases':cases, 'adaptive_harness':'not implemented in this static comparison; no revision activation'}
    b.write_json(output/'plan.json', plan)
    rows = []
    for case in cases:
        transport = {'kind':'tape','responses':b.read_json(tape_directory/(case['id']+'.json'))} if tape_directory else selected_transport
        request = request_for(case,transport)
        request_path = output/(case['id']+'.request.json')
        b.write_json(request_path,request)
        started = time.monotonic()
        try:
            process = subprocess.run(['rtk','proxy','bun',str(driver),str(request_path.resolve())],cwd=b.ROOT,
                                     capture_output=True,text=True,timeout=120*len(case['steps'])+60)
            result = json.loads(process.stdout)
            b.require(result.get('id') in (case['id'],None), 'Driver case mismatch')
            if process.returncode and result.get('status') == 'completed': raise ValueError('Driver exit disagrees with receipt')
        except (subprocess.TimeoutExpired,ValueError) as exc:
            result = {'id':case['id'],'status':'failed','error_code':'driver_timeout' if isinstance(exc,subprocess.TimeoutExpired) else 'driver_invalid_receipt'}
        b.write_json(output/(case['id']+'.result.json'),result)
        elapsed = time.monotonic()-started
        try:
            inspection = subprocess.run(['rtk','proxy','bun',str(inspector),str((output/(case['id']+'.result.json')).resolve())], cwd=b.ROOT, capture_output=True,text=True,timeout=60)
            b.require(inspection.returncode == 0, 'Inspector failed')
            ui_receipt = json.loads(inspection.stdout)
        except (ValueError, subprocess.TimeoutExpired):
            ui_receipt = {'status':'unavailable'}
        b.write_json(output/(case['id']+'.tui-openui.json'),ui_receipt)
        row = summarize(case,result,elapsed)
        rows.append(row)
        # Full histories, exact applied prompt and real tool outcomes are retained for an independent reviewer.
        b.write_json(output/(case['id']+'.review-packet.json'), {'case':case,'result':result,'tui_openui':ui_receipt,
                     'instruction':'Judge each rubric dimension with exact step/message evidence. Permit paraphrases and alternative sound strategies. Abstain on unavailable evidence. Do not infer human learning from scripted replies.'})
        print(b.canonical({'case':case['id'],'status':row['status']}),flush=True)
    b.write_json(output/'summary.json',{'track':plan['track'],'measurement':plan['measurement'],'rows':rows,
                                      'quality_status':'not judged','status':'complete'})

def validate_review(case, result, review):
    b.require(result.get('measurement') == 'model_episode' and result.get('status') == 'completed',
              'Only completed model episodes can receive teaching quality scores')
    b.require(review.get('result_sha256') == b.digest(b.canonical(result)), 'Review result binding mismatch')
    b.require(review.get('case_sha256') == b.digest(b.canonical(case)), 'Review case binding mismatch')
    b.require(review.get('reviewer_kind') in ('human','codex_subagent','model_api') and review.get('reviewer_id'), 'Reviewer provenance required')
    rules = {r['dimension']:r for r in case['rubric']}
    ratings = review.get('ratings', [])
    b.require(len(ratings) == len(rules) and {r['dimension'] for r in ratings} == set(rules), 'Incomplete rubric coverage')
    for rating in ratings:
        score = rating.get('score')
        b.require(score is None or type(score) is int and score in (0,1,2), 'Invalid rubric score')
        b.require(isinstance(rating.get('reason'),str) and rating['reason'].strip(), 'Reason required')
        if score is None:
            b.require(bool(rating.get('uncertainty')), 'Abstention requires uncertainty')
            continue
        evidence = rating.get('evidence',{})
        b.require(evidence.get('kind') in ('quote','missing_behavior'), 'Invalid evidence kind')
        step_index = evidence.get('step_index')
        b.require(type(step_index) is int and step_index in rules[rating['dimension']]['evidence_steps'], 'Evidence outside rubric step')
        step = result['steps'][step_index]
        b.require(step['status'] == 'completed', 'Unobserved step cannot support a score')
        if evidence.get('kind') == 'missing_behavior':
            b.require(bool(evidence.get('observation')), 'Describe specific missing behavior')
        else:
            index = evidence.get('message_index')
            start = step.get('message_start_index')
            b.require(type(start) is int and type(index) is int and start <= index < len(step['messages']), 'Evidence must cite a new message from this step')
            message = step['messages'][index]
            b.require(message.get('role') in ('assistant','toolResult'), 'Learner script is not tutor evidence')
            content = message.get('content',[])
            texts = [content] if isinstance(content,str) else [block.get('text','') for block in content if isinstance(block,dict)]
            quote = evidence.get('quote')
            b.require(isinstance(quote,str) and quote.strip() and any(quote in text for text in texts), 'Quote absent from actual tutor/tool text')
    values = [r['score'] for r in ratings]
    return 50*sum(values)/len(values) if all(type(v) is int for v in values) else None


@app.command()
def review(run_directory: Path, reviews: Path, output: Path):
    """Validate independently authored reviews; never infer or synthesize missing scores."""
    plan = b.read_json(run_directory/'plan.json')
    rows = []
    for case in plan['cases']:
        path = reviews/(case['id']+'.json')
        if not path.exists():
            rows.append({'case_id':case['id'],'quality':None,'status':'missing_review'})
            continue
        result = b.read_json(run_directory/(case['id']+'.result.json'))
        receipt = b.read_json(path)
        score = validate_review(case,result,receipt)
        rows.append({'case_id':case['id'],'quality':score,'status':'reviewed','review':receipt})
    b.write_json(output,{'track':'fixed-cli-harness','rows':rows,'note':'Semantic judgments are separate from runtime completion, tokens and costs. Reviewer calibration is not assumed.'})

if __name__ == '__main__': app()
