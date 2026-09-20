/** Authored offline contracts. No dataset download, credential lookup or inference. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { nativeSurfaceInstruction } from './native_surface.js';
import { LEARNER_PROMPT } from './native_simulator.js';
import { PILOT_PYTHON_BRIDGE, checkPilotEpisode, executePilot, pilotDenominators, readPilotAttempts,
  replayPilotAdmission, validatePilotMetadata, type AdmittedPilot, type PilotDependencies, type PilotPaths,
  type PilotRunnerInput } from './native_pilot_run.js';

const command = promisify(execFile);
const training = resolve(import.meta.dir);
const hash = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex');
async function python(code: string, args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  delete env.PYTHONHOME; delete env.PYTHONPATH;
  return command('python3', ['-c', code, training, ...args], { env, maxBuffer: 32 * 1024 * 1024 });
}

const FIXTURE = String.raw`
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import native_pilot as p
import native_scenarios as n
import native_training as nt
from native_tinker_sampler import sampler_config
from native_tinker_update import BudgetLedger
import native_tinker_learner as instruct
from test_native_pilot import fixture_records,fixture_configuration,approved_reviews
root=Path(sys.argv[2]); prompt_hash=sys.argv[3]; separate=len(sys.argv)>4
def save(name,value):
    path=root/name; path.write_text(json.dumps(value,ensure_ascii=False)); return str(path)
def rawsha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
bundle=n.build_native_scenarios(fixture_records(),n.load_registry())
config=fixture_configuration(); config['authors']=['authored-créateur']
for role in ('actor','learner'):
    config[role].update(model='Qwen/Qwen3.5-9B-Base',revision='tinker://00000000-0000-0000-0000-000000000001/sampler_weights/initial')
    # Preserve Python's 1.0 and Unicode serialization in the real sealed files.
    config[role]['sampler'].update(temperature=1.0,top_p=1.0)
config['actor']['prompt_sha256']='a'*64; config['learner']['prompt_sha256']=prompt_hash
if separate:
    lc=instruct.learner_config()
    config['learner']['model']=instruct.MODEL
    config['learner']['revision']=p.digest({k:lc[k] for k in ('model','tokenizer','renderer','versions','sampling')})
for c in p.CONDITIONS: config['conditions'][c]['tool_schema_sha256']=p.digest([])
plan=p.build_pilot(bundle,config); dispatch=p.prepare_dispatch(plan,approved_reviews(plan))
paths=dict(scenarios=save('bundle.json',bundle),plan=save('plan.json',plan),dispatch=save('dispatch.json',dispatch),
           execution=str(root/'execution.json'),cache=str(root/'no-real-cache'))
e={'kind':'native-pilot-execution/v1','plan_sha256':plan['plan_sha256'],'dispatch_sha256':dispatch['dispatch_sha256'],
   'runtime_revision':config['runtime']['revision'],'source_hashes':{'SYSTEM.md':'a'*64},'controller_source_hashes':{'fixture':'b'*64},
   'paired_seed_policy':'record_only_backend_uncontrolled',
   'stage_zero':{'approved':True,'independent':True,'reviewer':'authored-reviewer',
      'evidence':{'uri':Path(save('gate.json',{'authored_test_only':True})).as_uri(),'sha256':rawsha(root/'gate.json')}},
   'parent_budget':{'path':str(root/'parent.json'),'project':instruct.PARENT_PROJECT,'model':instruct.PARENT_MODEL,'cap_usd':'100'},'slots':{}}
ledger=BudgetLedger(root/'parent.json',instruct.PARENT_PROJECT,instruct.PARENT_MODEL,'100')
for slot in plan['slots'][:2]:
    sid=slot['id']; sc=sampler_config(); sc['model']['sampler_checkpoint']=config['actor']['revision']
    sc['allocation']={'id':sid,'ledger_path':str(root/(sid+'-sampler-ledger.json')),'budget_project_id':'authored-slot','cap_usd':'1'}
    save(sid+'-sampler.json',nt.seal(sc,'config_hash'))
    e['slots'][sid]={'actor_transport':{'kind':'provider','provider':'authored-provider','model':config['actor']['model'],
      'thinking':'off','endpoint':'https://localhost:4443/v1','apiKeyEnv':'AUTHORED_TEST_ONLY',
      'modelMetadata':{'contextWindow':32768,'maxTokens':128}},
      'learner':{'endpoint':'https://localhost:4443/v1/chat/completions','api_key_env':'AUTHORED_TEST_ONLY',
        'model':config['learner']['model'],'revision':config['learner']['revision'],'temperature':1,'max_tokens':128,'json_mode':'prompt_only'},
      'allowed_tools':[],'tools':[],'grant_path':str(root/(sid+'-grant.json')),'sampler_config_path':str(root/(sid+'-sampler.json'))}
    if separate:
        child_grant=nt.seal({'kind':'authored-allocation-test-only','slot_id':sid,'cost':{'reserved_usd':'1'},'phases':['allocate']},'plan_hash')
        ledger.reserve(child_grant); ledger.before(child_grant,'allocate'); ledger.mark(child_grant,status='complete')
        lc=instruct.learner_config(); lc['allocation']={'id':child_grant['plan_hash'],'ledger_path':str(root/(sid+'-learner-ledger.json')),
          'budget_project_id':'authored-learner-slot','cap_usd':'1','parent_ledger_path':str(root/'parent.json')}
        child=nt.seal({'kind':'native-research-budget/v1','project_id':'authored-learner-slot','model_id':instruct.MODEL,'cap_usd':'1',
          'runs':{},'parent_allocation':{'ledger_path':str(root/'parent.json'),'plan_hash':child_grant['plan_hash']}},'ledger_hash')
        save(sid+'-learner-ledger.json',child); Path(lc['allocation']['ledger_path']).chmod(0o600)
        e['slots'][sid]['learner_config_path']=save(sid+'-learner.json',nt.seal(lc,'config_hash'))
        e['slots'][sid]['learner']['endpoint']='https://localhost:4444/v1/chat/completions'
save('execution.json',e); eh=rawsha(root/'execution.json')
for sid,cfg in e['slots'].items():
    fields={'kind':'native-pilot-slot-grant/v1','slot_id':sid,'plan_sha256':plan['plan_sha256'],
      'dispatch_sha256':dispatch['dispatch_sha256'],'execution_sha256':eh,'phases':['native_pilot_episode'],
      'bridge_endpoint':'https://localhost:4443/v1','sampler_config_sha256':rawsha(cfg['sampler_config_path']),
      'cost':{'reserved_usd':'1'}}
    if separate: fields.update(learner_config_sha256=rawsha(cfg['learner_config_path']),learner_endpoint=cfg['learner']['endpoint'])
    grant=nt.seal(fields,'plan_hash')
    save(sid+'-grant.json',grant); ledger.reserve(grant)
save('paths.json',paths)
save('pilot.json',dict(plan=plan,dispatch=dispatch,execution=e,execution_sha256=eh))
`;

let directory: string, output: string, pilot: AdmittedPilot, paths: PilotPaths;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'native-pilot-executor-test-'));
  output = join(directory, 'run');
  await python(FIXTURE, [directory, hash(LEARNER_PROMPT)]);
  pilot = JSON.parse(await readFile(join(directory, 'pilot.json'), 'utf8'));
  paths = JSON.parse(await readFile(join(directory, 'paths.json'), 'utf8'));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const selected = () => pilot.plan.slots.slice(0, 2).map(s => s.id);
const pins = () => ({ runtime_revision: pilot.execution.runtime_revision,
  source_hashes: pilot.execution.source_hashes, controller_source_hashes: pilot.execution.controller_source_hashes });

/** Only the source-cache reader is replaced, inside this isolated Python test.
 * The real reconstruction, review gate, Decimal ledger and locks still execute.
 * There is no such bypass in the CLI or replayPilotAdmission.
 */
async function bridge(mode: string, ids = selected()) {
  const prefix = `import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_pilot\nimport native_tinker_learner\nnative_tinker_learner.private_path=lambda value:Path(value)\nnative_pilot.load_admitted_bundle=lambda *args,**kw: json.loads(Path(json.loads(sys.argv[2])['paths']['scenarios']).read_text())\n`;
  const { stdout } = await python(prefix + PILOT_PYTHON_BRIDGE, [JSON.stringify({ mode, paths, selected: ids,
    execution_sha256: pilot.execution_sha256 })]);
  return JSON.parse(stdout);
}

function episode(input: PilotRunnerInput): Awaited<ReturnType<PilotDependencies['run']>> {
  const limits = input.plan.configuration.limits;
  return {
    schema_version: 1, id: input.scenario.id, branch_id: input.slot.id, family: input.scenario.family,
    source: input.scenario.source, outcome: 'learner_stop', measurement: 'model_episode',
    learner_policy: { kind: 'model', model: pilot.plan.configuration.learner.model,
      revision: pilot.plan.configuration.learner.revision, prompt_sha256: hash(LEARNER_PROMPT) },
    ledger: [], evaluation_only: input.scenario.evaluation_only, assessment: null, training: { eligible: false, reason: 'Authored test only' },
    runtime: { id: input.scenario.id, status: 'completed', error_code: null, runtime: 'keating-tui-pi-rpc', measurement: 'model_episode',
      fidelity: { entrypoint: 'authored fixture', model_loop: 'authored fixture', tool_handlers: 'authored fixture', persistence: 'authored fixture', limitations: ['Not actual model execution'] },
      configuration: { surface: input.slot.condition, surface_instruction_sha256: hash(nativeSurfaceInstruction(input.slot.condition)),
        transport_kind: 'provider', allowed_tools: input.config.allowed_tools, profile_name: null,
        limits: { max_provider_calls: limits.max_provider_calls, max_tool_calls: limits.max_tool_calls,
          max_output_tokens: input.plan.configuration.actor.sampler.max_tokens, turn_timeout_ms: limits.turn_timeout_ms } },
      source_hashes: pilot.execution.source_hashes,
      source_provenance: { unchanged_at_end: true, changed_paths: [], unresolved_optional_imports: [], scope: 'authored fixture' },
      requests: [{ kind: 'provider_request', data: { model: { id: input.plan.configuration.actor.model },
        context: { systemPrompt: 'Authored prefix\n\n' + nativeSurfaceInstruction(input.slot.condition), tools: [] } } }],
      receipts: [], steps: [], files: [], initial_files: [], session_files: [],
    },
  };
}
function dependencies(overrides: Partial<PilotDependencies> = {}): PilotDependencies {
  return {
    admit: async () => structuredClone(pilot),
    preflight: async p => validatePilotMetadata(p, pins(), hash(LEARNER_PROMPT)),
    claimFunding: async () => ({ kind: 'authored_no_money' }),
    run: async input => episode(input),
    checkResult: checkPilotEpisode,
    ...overrides,
  };
}

describe('admission and monetary authority', () => {
  test('real CLI admission fails closed with an unavailable pinned cache', async () => {
    await expect(replayPilotAdmission(paths)).rejects.toThrow();
    const ledger = JSON.parse(await readFile(join(directory, 'parent.json'), 'utf8'));
    expect(Object.values(ledger.runs).every((run: any) => run.dispatched.length === 0)).toBe(true);
  });
  test('Python replay retains Unicode and float seals; all 90 review records are checked', async () => {
    const replay = await bridge('admit');
    expect(replay.plan.plan_sha256).toBe(pilot.plan.plan_sha256);
    // JSON.stringify sorts neither keys nor Python float spellings. Never use it to reseal this plan.
    expect(hash(JSON.stringify(pilot.plan))).not.toBe(pilot.plan.plan_sha256);
    for (const which of ['source_context', 'chat', 'interactive']) {
      const original = await readFile(paths.dispatch, 'utf8');
      const changed = JSON.parse(original);
      const row = changed.reviews.situations[29];
      (which === 'source_context' ? row.source_context : row.formats[which]).approved = false;
      await writeFile(paths.dispatch, JSON.stringify(changed));
      await expect(bridge('funding')).rejects.toThrow();
      await writeFile(paths.dispatch, original);
    }
  });
  test('full reconstruction rejects a resealed plan with altered slot evidence', async () => {
    await python(`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_pilot as p\nx=json.loads(Path(sys.argv[2]).read_text())\nx.pop('plan_sha256'); x['slots'][0]['initial_evidence_sha256']='0'*64\nPath(sys.argv[2]).write_text(json.dumps(p.sealed(x,'plan_sha256')))`, [paths.plan]);
    await expect(bridge('admit')).rejects.toThrow();
  });
  test('funding check does not reserve; claim atomically consumes the existing grant once', async () => {
    const before = await readFile(join(directory, 'parent.json'), 'utf8');
    await bridge('funding');
    expect(await readFile(join(directory, 'parent.json'), 'utf8')).toBe(before);
    await bridge('claim', [selected()[0]!]);
    await expect(bridge('claim', [selected()[0]!])).rejects.toThrow();
    const ledger = JSON.parse(await readFile(join(directory, 'parent.json'), 'utf8'));
    expect(Object.values(ledger.runs).filter((r: any) => r.dispatched.length === 1)).toHaveLength(1);
  });
  test('a validly sealed sampler cap greater than its funded grant is rejected', async () => {
    const grantPath = pilot.execution.slots[selected()[0]!]!.grant_path;
    await python(`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_training as n\ngp,lp=map(Path,sys.argv[2:4]);g=json.loads(gp.read_text());old=g.pop('plan_hash');g['cost']['reserved_usd']='0.5';g=n.seal(g,'plan_hash');gp.write_text(json.dumps(g))\nl=json.loads(lp.read_text());l.pop('ledger_hash');r=l['runs'].pop(old);r['reserved_usd']='0.5';l['runs'][g['plan_hash']]=r;lp.write_text(json.dumps(n.seal(l,'ledger_hash')))`, [grantPath, join(directory, 'parent.json')]);
    await expect(bridge('funding')).rejects.toThrow('Slot sampler exceeds grant');
  });
  test('a second output directory cannot reuse the same globally claimed slot', async () => {
    const deps = dependencies({ claimFunding: (_p, slot) => bridge('claim', [slot.id]) });
    await executePilot(output, [selected()[0]!], deps);
    let calls = 0;
    await expect(executePilot(join(directory, 'another-output'), [selected()[0]!], { ...deps,
      run: async input => { calls++; return episode(input); } })).rejects.toThrow();
    expect(calls).toBe(0);
  });
  test('separate instruct learner requires its own already-funded allocation and semantic pin', async () => {
    const separateRoot = join(directory, 'separate'); await mkdir(separateRoot);
    await python(FIXTURE, [separateRoot, hash(LEARNER_PROMPT), 'instruct']);
    pilot = JSON.parse(await readFile(join(separateRoot, 'pilot.json'), 'utf8'));
    paths = JSON.parse(await readFile(join(separateRoot, 'paths.json'), 'utf8'));
    validatePilotMetadata(pilot, pins(), hash(LEARNER_PROMPT));
    await bridge('funding');
    await bridge('claim', [selected()[0]!]);
    const config = JSON.parse(await readFile(pilot.execution.slots[selected()[0]!]!.learner_config_path!, 'utf8'));
    await python(`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_training as n\np=Path(sys.argv[2]);x=json.loads(p.read_text());x.pop('ledger_hash');x['parent_allocation']['plan_hash']='0'*64\np.write_text(json.dumps(n.seal(x,'ledger_hash')))`, [config.allocation.ledger_path]);
    await expect(bridge('funding')).rejects.toThrow();
  });
  test('tampered sampler cap, changed execution and unfunded grant all fail before dispatch', async () => {
    const cfg = pilot.execution.slots[selected()[0]!]!;
    const original = await readFile(cfg.sampler_config_path, 'utf8');
    await python(`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_training as n\np=Path(sys.argv[2]);x=json.loads(p.read_text());x.pop('config_hash');x['allocation']['cap_usd']='2'\np.write_text(json.dumps(n.seal(x,'config_hash')))`, [cfg.sampler_config_path]);
    await expect(bridge('funding')).rejects.toThrow();
    await writeFile(cfg.sampler_config_path, original);
    await writeFile(paths.execution, (await readFile(paths.execution, 'utf8')) + '\n');
    await expect(bridge('funding')).rejects.toThrow();
    await writeFile(paths.execution, (await readFile(paths.execution, 'utf8')).trimEnd());
    await python(`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_training as n\np=Path(sys.argv[2]);x=json.loads(p.read_text());x.pop('ledger_hash');x['runs']={}\np.write_text(json.dumps(n.seal(x,'ledger_hash')))`, [join(directory, 'parent.json')]);
    await expect(bridge('funding')).rejects.toThrow();
  });
});

describe('durability and denominators', () => {
  test('a selected pair produces exact Python report attempts and leaves 178 unattempted', async () => {
    const report = await executePilot(output, selected(), dependencies());
    expect(report.denominators.map(r => [r.planned, r.attempted, r.unattempted, r.assessed])).toEqual([[90, 1, 89, 0], [90, 1, 89, 0]]);
    const { stdout } = await python(`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_pilot as p\nr=Path(sys.argv[2]);read=lambda x:json.loads(x.read_text())\nreport=p.report_pilot(read(r/'plan.json'),read(r/'run/attempts.json'),[],read(r/'dispatch.json'))\nprint(json.dumps(report['denominators']))`, [directory]);
    expect(JSON.parse(stdout).filter((r: any) => r.dataset === 'all').map((r: any) => r.unattempted)).toEqual([89, 89]);
  });
  test('interrupted runner preserves progress and started status; resume never redispatches', async () => {
    let runs = 0, grants = 0;
    const deps = dependencies({ claimFunding: async () => { grants++; return {}; }, run: async input => {
      runs++; await input.checkpoint('actual_prefix_fixture', { accepted: true }); throw new Error('provider completion unknown');
    } });
    await expect(executePilot(output, [selected()[0]!], deps)).rejects.toThrow('no_automatic_retry');
    expect((await readPilotAttempts(output, pilot))[0]?.status).toBe('started');
    const report = await executePilot(output, [selected()[0]!], deps);
    expect([runs, grants]).toEqual([1, 1]);
    expect(report.denominators[0]?.unresolved).toBe(1);
    const progress = JSON.parse(await readFile(join(output, 'slots', selected()[0]!, 'progress-00001.json'), 'utf8'));
    expect(progress.kind).toBe('actual_prefix_fixture');
  });
  test('an OS-killed child leaves a durable started claim and does not rerun', async () => {
    const child = Bun.spawn([process.execPath, '--eval', `
      import { executePilot } from ${JSON.stringify(join(training, 'native_pilot_run.ts'))};
      const pilot=await Bun.file(process.env.W2_FIXTURE).json();
      await executePilot(process.env.W2_OUTPUT,[pilot.plan.slots[0].id],{
        admit:async()=>pilot,preflight:async()=>{},claimFunding:async()=>({authored:true}),
        run:async(input)=>{await input.checkpoint('before_kill',{authored:true});process.kill(process.pid,'SIGKILL');},
        checkResult:async()=>{}
      });
    `], { env: { ...process.env, W2_FIXTURE: join(directory, 'pilot.json'), W2_OUTPUT: output }, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).not.toBe(0);
    expect((await readPilotAttempts(output, pilot))[0]?.status).toBe('started');
    let calls = 0;
    await executePilot(output, [selected()[0]!], dependencies({ run: async input => { calls++; return episode(input); } }));
    expect(calls).toBe(0);
  });
  test('concurrent owner observes the inflight slot and cannot dispatch it', async () => {
    let entered!: () => void, release!: () => void, calls = 0;
    const started = new Promise<void>(r => { entered = r; });
    const held = new Promise<void>(r => { release = r; });
    const deps = dependencies({ run: async input => { calls++; entered(); await held; return episode(input); } });
    const first = executePilot(output, [selected()[0]!], deps);
    await started;
    await executePilot(output, [selected()[0]!], deps);
    release(); await first;
    expect(calls).toBe(1);
  });
  test('a directory-only crash window counts as unresolved, never unattempted', async () => {
    await mkdir(join(output, 'slots', selected()[0]!), { recursive: true });
    const attempts = await readPilotAttempts(output, pilot);
    expect(attempts[0]?.status).toBe('started');
    expect(pilotDenominators(pilot, attempts)[0]?.unattempted).toBe(89);
  });
  test('changing output binding or editing a terminal receipt blocks reuse', async () => {
    await executePilot(output, [selected()[0]!], dependencies());
    await writeFile(join(output, 'slots', selected()[0]!, 'receipt.json'), '{}');
    await expect(executePilot(output, selected(), dependencies())).rejects.toThrow('receipt_mismatch');
    pilot.execution_sha256 = '0'.repeat(64);
    await expect(executePilot(output, selected(), dependencies())).rejects.toThrow('output_binding');
  });
});

describe('pins, conditions and failure accounting', () => {
  test('golden, prompt, source and tool-profile changes block the runner before any grant claim', async () => {
    const original = structuredClone(pilot);
    const mutations = [
      () => { pilot.execution.stage_zero.approved = false; },
      () => { pilot.plan.configuration.learner.prompt_sha256 = 'f'.repeat(64); },
      () => { pilot.execution.runtime_revision = 'changed'; },
      () => { pilot.execution.slots[selected()[0]!]!.allowed_tools = ['read']; },
    ];
    let claims = 0;
    for (const mutate of mutations) {
      pilot = structuredClone(original); mutate();
      await expect(executePilot(output, selected(), dependencies({ claimFunding: async () => { claims++; return {}; } }))).rejects.toThrow();
    }
    expect(claims).toBe(0);
  });
  test('a chat artifact leak fails that slot and halts remaining dispatch', async () => {
    let calls = 0;
    await expect(executePilot(output, selected(), dependencies({ run: async input => {
      calls++; const result = episode(input);
      result.ledger.push({ kind: 'delivered_observation', payload: { documents: [{ id: 'hidden' }], availableActions: [] } } as any);
      return result;
    } }))).rejects.toThrow('remaining_slots_blocked');
    expect(calls).toBe(1);
    const attempts = await readPilotAttempts(output, pilot);
    expect(attempts[0]?.status).toBe('tutor_failure');
    expect(pilotDenominators(pilot, attempts)[1]?.unattempted).toBe(90);
  });
  test('wrong runtime surface, instruction hash, and actual tool schema are rejected', async () => {
    for (const change of ['surface', 'hash', 'schema']) {
      const input = { slot: pilot.plan.slots[0]!, config: pilot.execution.slots[selected()[0]!]!,
        scenario: pilot.plan.situations[0]!.scenario, plan: pilot.plan, checkpoint: async () => {} };
      const result = episode(input);
      if (change === 'surface') result.runtime.configuration.surface = 'interactive';
      if (change === 'hash') result.runtime.configuration.surface_instruction_sha256 = 'f'.repeat(64);
      if (change === 'schema') (result.runtime.requests[0] as any).data.context.tools = [{ name: 'read' }];
      await expect(checkPilotEpisode(pilot, input.slot, result)).rejects.toThrow();
    }
  });
  test('wrapper success with four prepared calls, five messages and no learner is still a failed interaction', async () => {
    await executePilot(output, [selected()[0]!], dependencies({ run: async input => {
      const result = episode(input); result.outcome = 'complete';
      result.runtime.status = 'failed'; result.runtime.error_code = 'harness_provider_call_limit';
      result.runtime.requests = Array.from({ length: 4 }, () => structuredClone(result.runtime.requests[0]));
      result.ledger = [...Array(5).fill('actor_message'), ...Array(4).fill('tool_call'), ...Array(4).fill('tool_result')]
        .map(kind => ({ kind } as any));
      return result;
    } }));
    const receipt = JSON.parse(await readFile(join(output, 'slots', selected()[0]!, 'receipt.json'), 'utf8'));
    expect(receipt.status).toBe('budget_exhausted');
    expect(receipt.event_counts.actor_message).toBe(5);
    expect(receipt.event_counts.learner_intent).toBeUndefined();
    expect(receipt.provider_requests_prepared).toBe(4);
    expect(receipt.paid_samples).toBeNull();
    expect(receipt.learning_effect).toBeNull();
  });
});
