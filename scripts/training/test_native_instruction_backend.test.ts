/** Authored funding records and offline process doubles. No reservation or provider calls. */
import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { actionHash, createActionPlan, type ActionBranchInput } from './native_action_search.js';
import { claimInstructionBinding, inspectInstructionBinding, instructionActionAdapter, instructionModelPins,
  runInstructionPilot, verifyInstructionMetadata, INSTRUCTION_EVALUATION_LIMIT,
  type InstructionBinding, type InstructionProof, type InstructionOptions, type InstructionRuntime, type InstructionLaunch } from './native_instruction_backend.js';
import type { PilotRunnerInput } from './native_pilot_run.js';

const ROOT = resolve(import.meta.dir, '../..');
const exec = promisify(execFile);
// The imported validators require typer/certifi, even though this test never loads a model.
// Offline resolution cannot fetch packages or contact a model/data provider.
let PYTHON = process.env.NATIVE_TEST_PYTHON ?? '', bootstrap: string | undefined;
beforeAll(async () => {
  if (PYTHON) return;
  const base = join(ROOT, '.keating/native-learning/instruction-backend-tests'); await mkdir(base,{recursive:true});
  bootstrap = await mkdtemp(join(base,'python-')); PYTHON = join(bootstrap,'python');
  await writeFile(PYTHON, '#!/usr/bin/env bash\nexec uv run --offline --no-project --managed-python --python 3.13 --with typer --with certifi python "$@"\n', {mode:0o700});
});
afterAll(async () => { if (bootstrap) await rm(bootstrap,{recursive:true,force:true}); });
let directory: string, binding: InstructionBinding, proof: InstructionProof;
const fixture = String.raw`
import sys,json,hashlib,os
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import native_training as nt
import native_instruction_actor as na
import native_tinker_learner as nl
from native_scenarios import digest
from native_tinker_update import BUDGET_KIND
d=Path(sys.argv[2])/(sys.argv[4] if len(sys.argv)>4 else ''); d.mkdir(exist_ok=True)
root=Path(sys.argv[1]).parent.parent
def save(path,value):
    path.write_text(json.dumps(value)); os.chmod(path,0o600)
names=['native_instruction_backend.ts','native_process_supervisor.py','native_instruction_actor.py','native_tinker_learner.py',
 'native_tinker_update.py','native_training.py','native_simulator.ts','native_episode.ts','native_learner.ts',
 'benchmark_tinker_bridge.py','benchmark_harness_v3.ts','benchmark_harness_v3_extension.ts',
 'benchmark_harness_v3_provenance.ts','native_surface.ts','native_experiment.ts','research_access.py',
 'native_action_search.ts','native_pilot_run.ts','native_paths.ts','native_scenarios.py',
 'benchmark_sources.py','serve_pilot.py','native_capture.py','sdpo_math.py']
sources={'scripts/training/'+n:hashlib.sha256((root/'scripts/training'/n).read_bytes()).hexdigest() for n in names}
target=json.loads(sys.argv[3]) if len(sys.argv)>3 else {'lane':'pilot','plan_sha256':'a'*64,'branch_id':'authored-slot','source_family':'authored-family','scenario_sha256':'b'*64}
configs={'actor':na.actor_config(),'learner':nl.learner_config()}
cores={r:digest({k:v for k,v in c.items() if k not in ('allocation','config_hash')}) for r,c in configs.items()}
grant=nt.seal({'kind':'native-instruction-backend-allocation/v1','target':target,'source_hashes':sources,
 'config_core_sha256':cores,'subcaps_usd':{'actor':'0.60','learner':'0.40'},'cost':{'reserved_usd':'1'},
 'phases':['allocate_actor','allocate_learner']},'plan_hash')
save(d/'grant.json',grant)
# Construct an explicitly authored completed allocation; never call reserve/before/mark.
parent={'kind':BUDGET_KIND,'project_id':nl.PARENT_PROJECT,'model_id':nl.PARENT_MODEL,'cap_usd':'100',
 'runs':{grant['plan_hash']:{'reserved_usd':'1','status':'complete','phases':grant['phases'],'dispatched':grant['phases']}}}
save(d/'parent.json',nt.seal(parent,'ledger_hash'))
for role,c in configs.items():
    cap=grant['subcaps_usd'][role]; child=d/(role+'-budget.json')
    c['allocation']={'id':grant['plan_hash'],'ledger_path':str(child),'budget_project_id':'authored-'+role,
      'cap_usd':cap,'parent_ledger_path':str(d/'parent.json')}
    c=nt.seal(c,'config_hash'); save(d/(role+'-config.json'),c)
    save(child,nt.seal({'kind':BUDGET_KIND,'project_id':'authored-'+role,'model_id':nl.MODEL,'cap_usd':cap,'runs':{},
      'parent_allocation':{'plan_hash':grant['plan_hash'],'ledger_path':str(d/'parent.json')}},'ledger_hash'))
b={'kind':'native-instruction-backend/v1','target':target,'source_hashes':sources,'grant_path':str(d/'grant.json'),
 'actor_config_path':str(d/'actor-config.json'),'learner_config_path':str(d/'learner-config.json'),'state_dir':str(d/'runtime')}
print(json.dumps(b))
`;
async function py(code: string, args: string[] = []) {
  const env = { ...process.env }; delete env.PYTHONHOME; delete env.PYTHONPATH;
  delete env.TINKER_API_KEY; env.PYTHONDONTWRITEBYTECODE = '1';
  try { return await exec(PYTHON, ['-c', code, join(ROOT, 'scripts/training'), directory, ...args], { cwd: ROOT, env }); }
  catch (error) { throw new Error(String((error as { stderr?: string }).stderr ?? 'fixture setup failed').split('\n').slice(-5).join('\n')); }
}
beforeEach(async () => {
  const base = join(ROOT, '.keating/native-learning/instruction-backend-tests'); await mkdir(base, { recursive: true });
  directory = await mkdtemp(join(base, 'authored-'));
  binding = JSON.parse((await py(fixture)).stdout);
  proof = await inspectInstructionBinding(binding, { python: PYTHON, audit: false, fresh: true });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); delete process.env.INSTRUCTION_TEST_API_KEY; });
async function mutate(path: string, expression: string, seal: string) {
  await py(`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport native_training as nt\np=Path(sys.argv[3]); v=json.loads(p.read_text())\n${expression}\np.write_text(json.dumps(nt.seal(v,sys.argv[4])))`, [path, seal]);
}
const fundingInspect = (b: InstructionBinding, fresh: boolean) => inspectInstructionBinding(b, { python: PYTHON, audit: false, fresh });

describe('actual config and existing allocation validation', () => {
  test('read-only inspection validates combined caps and preserves unattested catalog identity', async () => {
    const paths = ['parent.json','actor-budget.json','learner-budget.json','actor-config.json','learner-config.json'];
    const before = await Promise.all(paths.map(p => readFile(join(directory,p),'utf8')));
    const result = await inspectInstructionBinding(binding, { python: PYTHON, audit: false, fresh: true });
    expect(result.combined_cap_usd).toBe('1.00'); expect(result.reserved_usd).toBe('1');
    expect(result.training_eligible).toBe(false); expect(result.limitation).toBe(INSTRUCTION_EVALUATION_LIMIT);
    expect(result.actor.config_hash).not.toBe(result.actor.core_sha256);
    expect(instructionModelPins(result).learner.revision).toBe(result.learner.revision);
    expect(await Promise.all(paths.map(p => readFile(join(directory,p),'utf8')))).toEqual(before);
  });
  test('complete source inventories larger than the Linux argv limit use stdin unchanged',async()=>{
    // Bind 600 distinct lexical paths to this same owned file. The real Python
    // inspector still hashes every entry; only the inventory size is synthetic.
    const key='scripts/training/native_instruction_backend.ts';
    // Harmless './' spellings resolve to the existing file without writes.
    for(let index=1;index<=600;index++)binding.source_hashes['scripts/training/'+('./'.repeat(index))+'native_instruction_backend.ts']=binding.source_hashes[key]!;
    await writeFile(join(directory,'large-binding.json'),JSON.stringify(binding),{mode:0o600});
    await py(String.raw`
import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1]);import native_training as nt
d=Path(sys.argv[2]);b=json.loads((d/'large-binding.json').read_text());g=json.loads((d/'grant.json').read_text())
old=g['plan_hash'];g['source_hashes']=b['source_hashes'];g=nt.seal(g,'plan_hash')
(d/'grant.json').write_text(json.dumps(g))
p=d/'parent.json';v=json.loads(p.read_text());v['runs']={g['plan_hash']:v['runs'][old]};p.write_text(json.dumps(nt.seal(v,'ledger_hash')))
for role in ('actor','learner'):
 p=d/(role+'-config.json');c=json.loads(p.read_text());c['allocation']['id']=g['plan_hash'];p.write_text(json.dumps(nt.seal(c,'config_hash')))
 p=d/(role+'-budget.json');c=json.loads(p.read_text());c['parent_allocation']['plan_hash']=g['plan_hash'];p.write_text(json.dumps(nt.seal(c,'ledger_hash')))
`);
    expect(Buffer.byteLength(JSON.stringify(binding))).toBeGreaterThan(128*1024);
    const measured=await inspectInstructionBinding(binding,{python:PYTHON,audit:false,fresh:true});
    expect(measured.binding_sha256).toBe(actionHash(binding));expect(measured.combined_cap_usd).toBe('1.00');
  });
  test('two individually affordable children cannot exceed their single shared allocation', async () => {
    await mutate(binding.grant_path, "v['cost']['reserved_usd']='0.70'", 'plan_hash');
    // Rebind all parents/configs to a coherently sealed lower grant: only combined sum fails.
    await py(String.raw`
import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1]); import native_training as nt
d=Path(sys.argv[2]); g=json.loads((d/'grant.json').read_text())
def update(p,v,field): p.write_text(json.dumps(nt.seal(v,field)))
p=d/'parent.json'; v=json.loads(p.read_text()); held=next(iter(v['runs'].values())); held['reserved_usd']='0.70'; v['runs']={g['plan_hash']:held}; update(p,v,'ledger_hash')
for role in ('actor','learner'):
 p=d/(role+'-config.json'); c=json.loads(p.read_text()); c['allocation']['id']=g['plan_hash']; update(p,c,'config_hash')
 p=d/(role+'-budget.json'); c=json.loads(p.read_text()); c['parent_allocation']['plan_hash']=g['plan_hash']; update(p,c,'ledger_hash')
`);
    await expect(inspectInstructionBinding(binding, { python:PYTHON,audit:false })).rejects.toThrow('preflight_failed');
  });
  test.each(['model','tokenizer','renderer','versions'])('unsupported %s identity fails before any launch', async field => {
    await mutate(binding.actor_config_path, `v['${field}']={'unexpected':'changed'}`, 'config_hash');
    await expect(inspectInstructionBinding(binding, { python:PYTHON,audit:false })).rejects.toThrow('preflight_failed');
  });
  test('source drift, unfinished parent allocation and unreconciled child are rejected', async () => {
    const changed = structuredClone(binding); changed.source_hashes['scripts/training/native_instruction_actor.py']='c'.repeat(64);
    await expect(inspectInstructionBinding(changed,{python:PYTHON,audit:false})).rejects.toThrow();
    await mutate(join(directory,'parent.json'), "next(iter(v['runs'].values()))['status']='reserved'", 'ledger_hash');
    await expect(inspectInstructionBinding(binding,{python:PYTHON,audit:false})).rejects.toThrow();
    await mutate(join(directory,'parent.json'), "next(iter(v['runs'].values()))['status']='complete'", 'ledger_hash');
    await mutate(join(directory,'actor-budget.json'), "v['runs']={'authored':{'status':'failed_unknown','reserved_usd':'0.10'}}", 'ledger_hash');
    await expect(inspectInstructionBinding(binding,{python:PYTHON,audit:false})).rejects.toThrow();
  });
  test('a previously used child is not a fresh process allocation even if its operation completed', async () => {
    await mutate(join(directory,'learner-budget.json'), "v['runs']={'authored':{'status':'complete','reserved_usd':'0.10'}}", 'ledger_hash');
    await inspectInstructionBinding(binding,{python:PYTHON,audit:false});
    await expect(inspectInstructionBinding(binding,{python:PYTHON,audit:false,fresh:true})).rejects.toThrow();
  });
  test('claim is once-only across output paths and leaves monetary ledger bytes untouched', async () => {
    const before = await readFile(proof.parent_path,'utf8');
    const grant=await claimInstructionBinding(binding,{inspect:fundingInspect});
    expect(grant.enforcement_sha256).toBe(actionHash(binding));
    await expect(claimInstructionBinding({...binding,state_dir:join(directory,'another')},{inspect:fundingInspect})).rejects.toThrow();
    expect(await readFile(proof.parent_path,'utf8')).toBe(before);
  });
});

function pilotInput(): PilotRunnerInput {
  return { scenario:{id:'authored-scenario',family:binding.target.source_family,actor:{opening_message:'Original public task and wrong attempt.'}},
    slot:{id:binding.target.branch_id,scenario_sha256:binding.target.scenario_sha256,condition:'interactive'},
    plan:{plan_sha256:binding.target.plan_sha256,configuration:{actor:{model:proof.actor.model,revision:proof.actor.revision,
      sampler:{temperature:1,top_p:1,max_tokens:proof.actor.limits.max_output_tokens}},
      learner:{model:proof.learner.model,revision:proof.learner.revision,sampler:{temperature:1,top_p:1,max_tokens:proof.learner.limits.max_output_tokens}},
      limits:{max_provider_calls:4}}},config:{allowed_tools:[]},checkpoint:async()=>{} } as unknown as PilotRunnerInput;
}
async function metadata(role: 'actor'|'learner', launch: InstructionLaunch) {
  const state=launch.args[launch.args.indexOf('--state')+1]!; await mkdir(state,{mode:0o700});
  const token_file=join(state,'token'); const cert_file=join(state,'cert.pem');
  await writeFile(token_file,'authored-local-token-'.repeat(3),{mode:0o600});
  await writeFile(cert_file,'-----BEGIN CERTIFICATE-----\nauthored-test-only\n-----END CERTIFICATE-----',{mode:0o600});
  const p=proof[role];
  return {endpoint:`https://localhost:${role==='actor'?12443:12444}/v1/chat/completions`,model:p.model,
    revision:`native-instruction-${role}-config:${p.config_hash}`,config_hash:p.config_hash,temperature:1,max_tokens:p.limits.max_output_tokens,
    token_file,cert_file,...(role==='actor'?{base_url:'https://localhost:12443/v1',origin:'actor',condition:p.condition,
      prompt_sha256:(p.condition as any).prompt_sha256,training_eligible:false,provider_weight_revision:'not_attested_by_tinker_base_model_api'}:
      {json_mode:'prompt_only',actor_training_eligible:false})};
}
function fakeRuntime(options: { fail?: 'actor'|'learner'|'worker'; timeout?:boolean; badMetadata?:boolean; die?: 'actor'|'learner'; badStop?: 'actor'|'learner'|'worker' }={}) {
  const launched: InstructionLaunch[]=[], stopped:string[]=[];
  const runtime: InstructionRuntime={async launch(spec){
    launched.push(spec);
    if(options.fail===spec.role) throw new Error('authored-startup-failure');
    if(spec.role==='worker') {
      await writeFile(join(binding.state_dir,'episode.json'),JSON.stringify({training:{eligible:false},authored_test_only:true}),{mode:0o600});
      return {metadata:async()=>({}),completed:options.timeout?new Promise<number>(()=>{}):Promise.resolve(0),stop:async()=>{stopped.push(spec.role);if(options.badStop===spec.role)throw new Error('authored-cleanup-failure');}};
    }
    const m=await metadata(spec.role,spec); if(options.badMetadata)m.model='wrong-model';
    return {metadata:async()=>m,completed:options.die===spec.role?Promise.resolve(-9):new Promise<number>(()=>{}),stop:async()=>{stopped.push(spec.role);if(options.badStop===spec.role)throw new Error('authored-cleanup-failure');}};
  }};
  return {runtime,launched,stopped};
}
describe('fresh process lifecycle and secret scope',()=>{
  test('requires durable funding claim before launching either process',async()=>{
    process.env.INSTRUCTION_TEST_API_KEY='authored-provider-secret'; const f=fakeRuntime();
    await expect(runInstructionPilot(binding,pilotInput(),{runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY'})).rejects.toThrow();
    expect(f.launched).toHaveLength(0);
  });
  test('fresh actor, learner and Bun processes get scoped credentials; cleanup is reverse order',async()=>{
    process.env.INSTRUCTION_TEST_API_KEY='authored-provider-secret'; const f=fakeRuntime();
    const options:InstructionOptions={runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY'};
    await claimInstructionBinding(binding,options); await runInstructionPilot(binding,pilotInput(),options);
    expect(f.launched.map(p=>p.role)).toEqual(['actor','learner','worker']);
    expect(f.stopped).toEqual(['worker','learner','actor']);
    for(const service of f.launched.slice(0,2)){
      expect(service.env.TINKER_API_KEY).toBe('authored-provider-secret');
      expect(service.env.INSTRUCTION_TEST_API_KEY).toBeUndefined();
      expect(service.args.slice(-2)).toEqual(['--port','0']);
    }
    const worker=f.launched[2]!;
    expect(worker.env.TINKER_API_KEY).toBeUndefined(); expect(worker.env.INSTRUCTION_TEST_API_KEY).toBeUndefined();
    expect(worker.env.KEATING_NATIVE_BRIDGE_TOKEN).toContain('authored-local-token');
    expect(worker.env.NODE_EXTRA_CA_CERTS).toBe(join(binding.state_dir,'ca.pem'));
    expect(process.env.NODE_EXTRA_CA_CERTS).not.toBe(worker.env.NODE_EXTRA_CA_CERTS);
    const input=JSON.parse(await readFile(join(binding.state_dir,'worker-input.json'),'utf8'));
    expect(input.actor_transport.endpoint).toBe('https://localhost:12443/v1');
    expect(input.actor_transport.model).toBe(proof.actor.model);
    expect(input.actor_transport.modelMetadata.maxTokens).toBe(proof.actor.limits.max_output_tokens);
    expect(input.input.slot.condition).toBe('interactive');
    expect(input.input.config.allowed_tools).toEqual([]);
    expect(input.input.scenario.actor.opening_message).toBe(pilotInput().scenario.actor.opening_message);
    expect(input.learner.revision).toBe(proof.learner.revision);
    expect(JSON.stringify(input)).not.toContain('authored-provider-secret');
    expect(JSON.stringify(input)).not.toContain('authored-local-token');
    await expect(runInstructionPilot(binding,pilotInput(),options)).rejects.toThrow(); expect(f.launched).toHaveLength(3);
  });
  test.each(['learner','worker'] as const)('%s startup failure stops already-running services',async role=>{
    process.env.INSTRUCTION_TEST_API_KEY='authored'; const f=fakeRuntime({fail:role});
    const options={runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY'};
    await claimInstructionBinding(binding,options);
    await expect(runInstructionPilot(binding,pilotInput(),options)).rejects.toThrow('authored-startup-failure');
    expect(f.stopped).toEqual(role==='learner'?['actor']:['learner','actor']);
  });
  test('worker timeout retains started claim, closes all processes and does not attest provider cancellation',async()=>{
    process.env.INSTRUCTION_TEST_API_KEY='authored';const f=fakeRuntime({timeout:true});
    const options={runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY',run_ms:5};
    await claimInstructionBinding(binding,options);
    await expect(runInstructionPilot(binding,pilotInput(),options)).rejects.toThrow('deadline');
    expect(f.stopped).toEqual(['worker','learner','actor']);
    const lifecycle=JSON.parse(await readFile(join(binding.state_dir,'lifecycle.json'),'utf8'));
    expect(lifecycle.status).toBe('interrupted');expect(lifecycle.provider_cancellation).toBe('not_attested');
  });
  test('wrong actual model metadata blocks the learner and worker',async()=>{
    process.env.INSTRUCTION_TEST_API_KEY='authored';const f=fakeRuntime({badMetadata:true});
    const options={runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY'};
    await claimInstructionBinding(binding,options);
    await expect(runInstructionPilot(binding,pilotInput(),options)).rejects.toThrow('identity_mismatch');
    expect(f.launched.map(l=>l.role)).toEqual(['actor']); expect(f.stopped).toEqual(['actor']);
  });
  test('unexpected service death blocks subsequent service/worker launches',async()=>{
    process.env.INSTRUCTION_TEST_API_KEY='authored';const f=fakeRuntime({die:'actor'});
    const options={runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY'};
    await claimInstructionBinding(binding,options);
    await expect(runInstructionPilot(binding,pilotInput(),options)).rejects.toThrow('child_died');
    expect(f.launched.map(l=>l.role)).toEqual(['actor']); expect(f.stopped).toContain('actor');
  });
  test('one cleanup failure still attempts every child and records cleanup as unverified',async()=>{
    process.env.INSTRUCTION_TEST_API_KEY='authored';const f=fakeRuntime({badStop:'worker'});
    const options={runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY'};
    await claimInstructionBinding(binding,options);
    await expect(runInstructionPilot(binding,pilotInput(),options)).rejects.toThrow('cleanup_unverified');
    expect(f.stopped).toEqual(['worker','learner','actor']);
    const receipt=JSON.parse(await readFile(join(binding.state_dir,'lifecycle.json'),'utf8'));
    expect(receipt.processes_stopped).toBe(false); expect(receipt.status).toBe('cleanup_unverified');
  });
  test('remote metadata endpoints and escaped token paths are rejected',async()=>{
    const launch:InstructionLaunch={role:'learner',executable:'unused',args:['--state',join(directory,'meta')],env:{},log:'unused'};
    const m=await metadata('learner',launch);
    await expect(verifyInstructionMetadata('learner',{...m,endpoint:'https://example.com/v1/chat/completions'},proof,join(directory,'meta'))).rejects.toThrow('nonlocal');
    await expect(verifyInstructionMetadata('learner',{...m,token_file:join(directory,'parent.json')},proof,join(directory,'meta'))).rejects.toThrow('outside_state');
  });
});

test('action adapter requires the whole candidate mapping and stable semantic pins before claims',async()=>{
  const pins=instructionModelPins(proof);
  const plan=createActionPlan({scenario:{schema_version:1,id:'authored',family:'authored-family',source:{},actor:{opening_message:'Authored question'},
    learner:{profile_evidence:[],assumptions:[]},evaluation_only:{}},bundle_sha256:'b'.repeat(64),registry_sha256:'c'.repeat(64),
    scenario_sha256:'d'.repeat(64),initial_evidence_sha256:'e'.repeat(64)},
    {authors:['authored-author'],moves:['hint','diagnose','counterexample'],learner_replicates:1,
      pins:{...pins,runtime_source_hashes:{'authored':'f'.repeat(64)},controller_source_hashes:{'authored':'f'.repeat(64)}},
      surface:'chat',allowed_tools:[],tools_sha256:actionHash([]),limits:{max_provider_calls:2,max_tool_calls:1,max_output_tokens:2048,turn_timeout_ms:1000,learner_timeout_ms:1000},
      utility:{metric:'authored',outcome_unit:'points',minimum:0,maximum:1,costs:[]}});
  await expect(instructionActionAdapter({}, {inspect:fundingInspect}).backend.preflight(plan)).rejects.toThrow('complete_branch_mapping');
  const target={lane:'action' as const,plan_sha256:plan.comparison_sha256,branch_id:plan.branches[0]!.id,source_family:'authored-family',scenario_sha256:'d'.repeat(64)};
  const fake={...binding,target};const p={...proof,binding_sha256:actionHash(fake),actor:{...proof.actor,revision:'different'}};
  const adapter=instructionActionAdapter({[target.branch_id]:fake},{inspect:async()=>p});
  await expect(adapter.funding.claim(plan,plan.branches[0]!)).rejects.toThrow('model_pins');
});

test('funded interactive W5 reaches the worker with unchanged evidence, empty tools and the planned move',async()=>{
  const pins=instructionModelPins(proof);
  const plan=createActionPlan({scenario:{schema_version:1,id:'authored-native-practice',family:'authored-family',
    source:{dataset:'authored-test-only'},actor:{opening_message:'I added thirds and fourths and got 2/7. Please give me practice.'},
    learner:{profile_evidence:[{wrong_attempt:'2/7'}],assumptions:[]},evaluation_only:{}},
    bundle_sha256:'b'.repeat(64),registry_sha256:'c'.repeat(64),scenario_sha256:'d'.repeat(64),initial_evidence_sha256:'e'.repeat(64)},
    {authors:['authored-author'],moves:['retrieve_practice','hint','diagnose'],learner_replicates:1,
      pins:{...pins,runtime_source_hashes:{...binding.source_hashes},controller_source_hashes:{...binding.source_hashes}},
      surface:'interactive',allowed_tools:[],tools_sha256:actionHash([]),
      limits:{max_provider_calls:2,max_tool_calls:1,max_output_tokens:2048,turn_timeout_ms:1000,learner_timeout_ms:1000},
      utility:{metric:'authored',outcome_unit:'points',minimum:0,maximum:1,costs:[]}});
  const bindings:Record<string,InstructionBinding>={};
  for(const branch of plan.branches){
    const target={lane:'action',plan_sha256:plan.comparison_sha256,branch_id:branch.id,
      source_family:plan.admission.scenario.family,scenario_sha256:plan.admission.scenario_sha256};
    bindings[branch.id]=JSON.parse((await py(fixture,[JSON.stringify(target),branch.id])).stdout);
  }
  const branch=plan.branches[0]!; binding=bindings[branch.id]!; proof=await fundingInspect(binding,true);
  process.env.INSTRUCTION_TEST_API_KEY='authored-provider-secret';
  // Stop at the explicit worker seam. Do not manufacture a successful native episode.
  const f=fakeRuntime({fail:'worker'});
  const options={runtime:f.runtime,inspect:fundingInspect,credential_env:'INSTRUCTION_TEST_API_KEY'};
  const adapter=instructionActionAdapter(bindings,options);
  await adapter.backend.preflight(plan); await adapter.funding.verify(plan);
  const before=structuredClone(plan), grant=await adapter.funding.claim(plan,branch);
  await expect(adapter.backend.run({plan,branch,grant,checkpoint:async()=>{}})).rejects.toThrow('authored-startup-failure');
  const input=JSON.parse(await readFile(join(binding.state_dir,'worker-input.json'),'utf8'));
  expect(input.lane).toBe('action'); expect(input.input.plan).toEqual(before);
  expect(input.input.branch.move).toBe('retrieve_practice'); expect(input.input.grant).toEqual(grant);
  expect(input.input.plan.settings.surface).toBe('interactive'); expect(input.input.plan.settings.allowed_tools).toEqual([]);
  expect(input.actor_transport.model).toBe(pins.actor.model);
  expect(input.learner.revision).toBe(pins.learner.revision);
  expect(input.proof.actor.core_sha256).toBe(pins.actor.configuration_sha256);
  expect(input.proof.combined_cap_usd).toBe('1.00'); expect(plan).toEqual(before);
  expect(f.stopped).toEqual(['learner','actor']);
  await expect(adapter.funding.claim(plan,branch)).rejects.toThrow();
}, 30_000); // Replays three full Python funding maps; no hosted calls.
