/** Process-isolated, already-funded instruction actor + learner adapter.
 * Imports, inspect and audit never look up credentials, reserve money or call a provider.
 * Explicit run methods are for the parent coordinator after its quality/admission gates.
 */
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual as same } from 'node:util';
import { mkdir, open, readFile, rename, stat, realpath } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';
import { actionHash, validateActionPlan, verifyActionEpisode, type ActionPlan, type ActionBranchInput,
  type ActionBackend, type ActionFunding, type BranchGrant } from './native_action_search.js';
import { JsonChatLearner, type JsonLearnerConfig } from './native_simulator.js';
import type { PilotRunnerInput } from './native_pilot_run.js';
import type { HarnessV3Request } from './benchmark_harness_v3.js';
import { nativeOutputPath } from './native_paths.js';

const ROOT = resolve(import.meta.dir, '../..');
const SELF = join(import.meta.dir, 'native_instruction_backend.ts');
const exec = promisify(execFile);
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
export const INSTRUCTION_EVALUATION_LIMIT = 'hosted_catalog_weights_have_no_immutable_checkpoint_attestation';
export interface InstructionTarget {
  lane: 'action' | 'pilot'; plan_sha256: string; branch_id: string; source_family: string; scenario_sha256: string;
}
export interface InstructionBinding {
  kind: 'native-instruction-backend/v1'; target: InstructionTarget;
  grant_path: string; actor_config_path: string; learner_config_path: string; state_dir: string;
  /** Actual runtime and local controller/deployment files, pinned before funding. */
  source_hashes: Record<string, string>;
}
interface RoleProof {
  config_hash: string; core_sha256: string; revision: string; model: string;
  limits: { context_tokens: number; max_output_tokens: number; timeout_seconds: number };
  max_provider_calls?: number; condition?: unknown; child_path: string;
}
export interface InstructionProof {
  binding_sha256: string; grant_hash: string; reserved_usd: string; combined_cap_usd: string;
  parent_path: string; actor: RoleProof; learner: RoleProof;
  evaluation_only: true; training_eligible: false; limitation: typeof INSTRUCTION_EVALUATION_LIMIT;
}

/** Uses existing Python config/seal/Decimal semantics; no JS/Python digest substitution. */
export const INSTRUCTION_INSPECT_PYTHON = String.raw`
import sys,json,hashlib
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,sys.argv[1])
import native_instruction_actor as actor
import native_tinker_learner as learner
import native_training as nt
import native_process_supervisor as supervisor
supervisor.check_support() # isolated read-only preflight process; no child or provider launched
from native_scenarios import digest
from native_tinker_update import sealed,dollars
a=json.load(sys.stdin); b=a['binding']
def need(ok,message):
    if not ok: raise ValueError(message)
def private(path):
    p=learner.private_path(path)
    need(p.is_file() and not p.stat().st_mode & 0o077,'private_backend_file_required')
    return p
def read(path): return nt.load_json(private(path))
need(b['kind']=='native-instruction-backend/v1','backend_kind')
t=b['target']; need(set(t)=={'lane','plan_sha256','branch_id','source_family','scenario_sha256'} and t['lane'] in ('action','pilot'),'backend_target')
configs={'actor':actor.actor_config(read(b['actor_config_path'])),'learner':learner.learner_config(read(b['learner_config_path']))}
g=read(b['grant_path']); sealed(g,'plan_hash')
need(g['kind']=='native-instruction-backend-allocation/v1' and g['target']==t
     and g['phases']==['allocate_actor','allocate_learner'],'backend_allocation_binding')
need(g['source_hashes']==b['source_hashes'],'backend_source_binding')
required={'native_instruction_backend.ts','native_process_supervisor.py','native_instruction_actor.py','native_tinker_learner.py',
 'native_tinker_update.py','native_training.py','native_simulator.ts','native_episode.ts','native_learner.ts',
 'benchmark_tinker_bridge.py','benchmark_harness_v3.ts','benchmark_harness_v3_extension.ts',
 'benchmark_harness_v3_provenance.ts','native_surface.ts','native_experiment.ts','research_access.py',
 'native_action_search.ts','native_pilot_run.ts','native_paths.ts','native_scenarios.py',
 'benchmark_sources.py','serve_pilot.py','native_capture.py','sdpo_math.py'}
need({'scripts/training/'+p for p in required}.issubset(b['source_hashes']),'backend_controller_source_pins_required')
for name,expected in b['source_hashes'].items():
    p=Path(sys.argv[1]).parent.parent/name
    need(not Path(name).is_absolute() and '..' not in Path(name).parts and p.is_file()
         and hashlib.sha256(p.read_bytes()).hexdigest()==expected,'backend_source_changed')
proof={}; children=set(); parents=set(); total=Decimal(0)
for role,c in configs.items():
    learner.funded_ledger(c) # Existing completed allocation and child state only; never reserve.
    alloc=c['allocation']; child=read(alloc['ledger_path']); parent=read(alloc['parent_ledger_path'])
    need(not a.get('fresh') or not child['runs'],'backend_child_already_used')
    need(alloc['id']==g['plan_hash'],'backend_wrong_parent_grant')
    held=parent['runs'].get(g['plan_hash'])
    need(held and held['reserved_usd']==g['cost']['reserved_usd'] and held['phases']==g['phases']
         and held['status']=='complete' and held['dispatched']==g['phases'],'backend_allocation_not_complete')
    cap=dollars(alloc['cap_usd']); need(cap==dollars(g['subcaps_usd'][role]),'backend_subcap_mismatch'); total+=cap
    need(sum((dollars(r['reserved_usd']) for r in child['runs'].values()),Decimal(0))<=cap,'backend_child_cap_exceeded')
    children.add(str(Path(alloc['ledger_path']).resolve())); parents.add(str(Path(alloc['parent_ledger_path']).resolve()))
    core=digest({k:v for k,v in c.items() if k not in ('allocation','config_hash')})
    need(core==g['config_core_sha256'][role],'backend_semantic_config_mismatch')
    revision=digest({k:c[k] for k in ('model','tokenizer','renderer','versions','sampling')+ (('condition',) if role=='actor' else ())})
    proof[role]={'config_hash':c['config_hash'],'core_sha256':core,'revision':revision,'model':c['model']['id'],
                 'limits':c['limits'],'child_path':alloc['ledger_path']}
    if role=='actor': proof[role].update(condition=c['condition'],max_provider_calls=c['max_provider_calls'])
need(len(children)==2 and len(parents)==1,'backend_dedicated_children_same_parent')
need(configs['actor']['project_selection']==configs['learner']['project_selection']
     and configs['actor']['project_id']==configs['learner']['project_id'],'backend_account_mismatch')
need(set(g['subcaps_usd'])=={'actor','learner'} and 0<total<=dollars(g['cost']['reserved_usd']),'backend_combined_cap_exceeds_allocation')
if a.get('audit'):
    # local_files_only is true; constructor audits SDK source, tokenizer, renderer
    # and stop token. It never constructs ServiceClient or reads a credential.
    audit=actor.PinnedActorSampler().audit
    need(audit['hf_revision']==learner.HF_REVISION and audit['tokenizer_files']==learner.HF_HASHES,'backend_local_audit_mismatch')
print(json.dumps(dict(grant_hash=g['plan_hash'],reserved_usd=g['cost']['reserved_usd'],combined_cap_usd=str(total),
    parent_path=next(iter(parents)),**proof,evaluation_only=True,training_eligible=False,
    limitation=actor.INELIGIBLE)))
`;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
  for (const name of ['PYTHONHOME', 'PYTHONPATH', 'TINKER_API_KEY', 'TINKER_PROJECT_ID', 'NODE_EXTRA_CA_CERTS',
    'KEATING_NATIVE_BRIDGE_TOKEN', 'KEATING_LEARNER_BRIDGE_TOKEN', 'NODE_OPTIONS', 'BUN_OPTIONS', 'BUN_INSPECT', 'PI_PACKAGE_DIR']) delete (env as NodeJS.ProcessEnv)[name];
  for (const name of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PASSWORD|AUTHORIZATION/i.test(name)) delete (env as NodeJS.ProcessEnv)[name];
  return env;
}
export async function inspectInstructionBinding(binding: InstructionBinding, options: { python?: string; audit?: boolean; fresh?: boolean } = {}): Promise<InstructionProof> {
  need(hash(binding.target.plan_sha256) && hash(binding.target.scenario_sha256)
    && /^[A-Za-z0-9_.:-]{1,180}$/.test(binding.target.branch_id) && !!binding.target.source_family, 'backend_target_identity');
  await nativeOutputPath(binding.state_dir);
  try {
    const operation = exec(options.python ?? 'python3', ['-c', INSTRUCTION_INSPECT_PYTHON, join(ROOT, 'scripts/training')],
      { cwd: ROOT, env: cleanEnv(), timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    // Complete harness inventories exceed Linux's per-argument limit. Keep Python
    // code/paths in argv and stream the unchanged JSON payload through stdin.
    operation.child.stdin!.on('error', () => operation.child.kill());
    operation.child.stdin!.end(JSON.stringify({ binding, audit: options.audit ?? true, fresh: options.fresh ?? false }));
    const { stdout } = await operation;
    return { ...JSON.parse(stdout), binding_sha256: actionHash(binding) };
  } catch { throw new Error('instruction_backend_preflight_failed'); } // No config, provider or credential diagnostics in logs.
}
function learnerConfig(proof: InstructionProof, endpoint = 'https://localhost:1/v1/chat/completions'): JsonLearnerConfig {
  return { endpoint, model: proof.learner.model, revision: proof.learner.revision, json_mode: 'prompt_only', temperature: 1,
    max_tokens: proof.learner.limits.max_output_tokens, api_key_env: 'KEATING_LEARNER_BRIDGE_TOKEN' };
}
export function instructionModelPins(proof: InstructionProof) {
  return { actor: { model: proof.actor.model, revision: proof.actor.revision, configuration_sha256: proof.actor.core_sha256 },
    learner: new JsonChatLearner(learnerConfig(proof)).provenance };
}

async function syncDir(path: string) { const fd = await open(path, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function privateJSON(path: string, value: unknown) {
  const temp = path + '.tmp'; const fd = await open(temp, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify(value)); await fd.sync(); } finally { await fd.close(); }
  await rename(temp, path); await syncDir(dirname(path));
}
const claimDir = (proof: InstructionProof) => `${proof.parent_path}.native-instruction-claims/${proof.grant_hash}`;
async function recordClaim(binding: InstructionBinding, proof: InstructionProof, signal?: AbortSignal): Promise<BranchGrant> {
  need(proof.binding_sha256 === actionHash(binding), 'backend_claim_binding');
  const directory = claimDir(proof);
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 }); await syncDir(dirname(dirname(directory)));
  signal?.throwIfAborted();
  await mkdir(directory, { mode: 0o700 }); await syncDir(dirname(directory)); // Never retry even a directory-only crash.
  await privateJSON(join(directory, 'claim.json'), { target: binding.target, binding_sha256: proof.binding_sha256 });
  return { grant_hash: proof.grant_hash, reserved_usd: proof.reserved_usd, enforcement_sha256: proof.binding_sha256 };
}

export interface InstructionProcess {
  metadata(): Promise<Record<string, any>>;
  completed: Promise<number>;
  stop(): Promise<void>;
}
export interface InstructionLaunch {
  role: 'actor' | 'learner' | 'worker'; executable: string; args: string[]; env: NodeJS.ProcessEnv; log: string;
  supervisor_python?: string; signal?: AbortSignal;
}
/** Explicit lifecycle test seam. Production uses an owner-pipe Linux subreaper. */
export interface InstructionRuntime {
  launch(spec: InstructionLaunch): Promise<InstructionProcess>;
}
/** Actual launcher, also exercised by real-process cancellation/death tests. */
export async function launchInstructionProcess(spec: InstructionLaunch): Promise<InstructionProcess> {
  spec.signal?.throwIfAborted();
  const log = await open(spec.log, 'wx', 0o600);
  try { spec.signal?.throwIfAborted(); } catch (error) { await log.close(); throw error; }
  const record = spec.log + '.supervision.json';
  const child = spawn(spec.supervisor_python ?? 'python3', [join(import.meta.dir, 'native_process_supervisor.py'),
    '--record', record, '--role', spec.role, '--', spec.executable, ...spec.args],
    { cwd: ROOT, env: spec.env, detached: true, stdio: ['pipe', 'pipe', log.fd] });
  // Only this owner retains the pipe. The subreaper closes inherited descriptors
  // before spawning; SIGKILL of the owner therefore still produces EOF cleanup.
  child.stdin!.on('error', () => {});
  const completed = new Promise<number>(resolve => {
    child.once('error', () => resolve(-1)); child.once('exit', code => resolve(code ?? -1));
  });
  void completed.then(() => log.close()).catch(() => {});
  let first: Record<string, any> | undefined;
  let resolveFirst!: (value: Record<string, any>) => void, rejectFirst!: (reason: Error) => void;
  const metadata = new Promise<Record<string, any>>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  void metadata.catch(() => {});
  const lines = createInterface({ input: child.stdout! });
  lines.on('line', line => {
    if (first) return;
    try { need(line.length < 65536, 'backend_metadata_size'); first = JSON.parse(line); resolveFirst(first!); }
    catch { rejectFirst(new Error('backend_invalid_startup_metadata')); }
  });
  void completed.then(() => { if (!first) rejectFirst(new Error('backend_exited_before_metadata')); });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    child.stdin!.end();
    await deadline(completed, 10_000);
    if (!child.pid) return; // Spawn failed before a guardian or service existed.
    const receipt = JSON.parse(await readFile(record, 'utf8'));
    need(receipt.kind === 'native-process-supervision/v1' && receipt.guardian_pid === child.pid
      && receipt.owner_pid === process.pid && receipt.role === spec.role
      && receipt.cleanup_verified === true && same(receipt.remaining_pids, []), 'backend_descendant_cleanup_unverified');
  })();
  const abort = () => { void stop().catch(() => {}); };
  spec.signal?.addEventListener('abort', abort, { once: true });
  if (spec.signal?.aborted) abort();
  void completed.then(() => spec.signal?.removeEventListener('abort', abort));
  return { metadata: () => metadata, completed, stop };
}
const localRuntime: InstructionRuntime = { launch: launchInstructionProcess };
async function deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('instruction_backend_deadline')), milliseconds);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function privateMaterial(path: unknown, state: string): Promise<string> {
  need(typeof path === 'string' && isAbsolute(path) && path.startsWith(state + '/'), 'backend_material_outside_state');
  need(await realpath(path) === path && ((await stat(path)).mode & 0o077) === 0, 'backend_material_not_private');
  return readFile(path, 'utf8');
}
export async function verifyInstructionMetadata(role: 'actor' | 'learner', metadata: Record<string, any>, proof: InstructionProof, state: string) {
  const pin = proof[role]; const endpoint = new URL(metadata.endpoint);
  need(endpoint.protocol === 'https:' && endpoint.hostname === 'localhost' && Number(endpoint.port) > 0
    && endpoint.pathname === '/v1/chat/completions' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,
    'backend_nonlocal_bridge');
  need(metadata.model === pin.model && metadata.config_hash === pin.config_hash
    && metadata.revision === `native-instruction-${role}-config:${pin.config_hash}`
    && metadata.temperature === 1 && metadata.max_tokens === pin.limits.max_output_tokens, 'backend_bridge_identity_mismatch');
  if (role === 'actor') need(metadata.origin === 'actor' && metadata.training_eligible === false
    && same(metadata.condition, proof.actor.condition) && metadata.provider_weight_revision === 'not_attested_by_tinker_base_model_api'
    && metadata.prompt_sha256 === (proof.actor.condition as { prompt_sha256?: string }).prompt_sha256
    && metadata.base_url === endpoint.origin + '/v1', 'backend_actor_condition_mismatch');
  else need(metadata.actor_training_eligible === false && metadata.json_mode === 'prompt_only', 'backend_learner_condition_mismatch');
  const token = (await privateMaterial(metadata.token_file, state)).trim();
  need(token.length >= 32 && !/\s/.test(token), 'backend_invalid_bridge_token');
  const cert = await privateMaterial(metadata.cert_file, state);
  need(cert.includes('-----BEGIN CERTIFICATE-----'), 'backend_certificate_missing');
  return { endpoint: metadata.endpoint as string, token, cert };
}

type WorkerInput = { lane: 'action'; input: Omit<ActionBranchInput, 'checkpoint' | 'signal'> } | { lane: 'pilot'; input: Omit<PilotRunnerInput, 'checkpoint'> };
export interface InstructionOptions {
  python?: string; credential_env?: string; startup_ms?: number; run_ms?: number;
  /** Offline tests only; do not substitute a provider by changing the production launcher. */
  runtime?: InstructionRuntime;
  inspect?: (binding: InstructionBinding, fresh: boolean) => Promise<InstructionProof>;
}
async function inspection(binding: InstructionBinding, options: InstructionOptions, fresh = false) {
  return options.inspect ? options.inspect(binding, fresh) : inspectInstructionBinding(binding, { python: options.python, fresh });
}
/** PilotDependencies.claimFunding can use this after independently replaying admission and all reviews. */
export async function claimInstructionBinding(binding: InstructionBinding, options: InstructionOptions = {}): Promise<BranchGrant> {
  return recordClaim(binding, await inspection(binding, options, true));
}
async function runPair(binding: InstructionBinding, proof: InstructionProof, worker: WorkerInput,
  checkpoint: ActionBranchInput['checkpoint'], options: InstructionOptions, signal?: AbortSignal) {
  signal?.throwIfAborted();
  need(Number.isInteger(options.startup_ms ?? 45_000) && (options.startup_ms ?? 45_000) > 0 && (options.startup_ms ?? 45_000) <= 45_000
    && Number.isInteger(options.run_ms ?? 900_000) && (options.run_ms ?? 900_000) > 0 && (options.run_ms ?? 900_000) <= 900_000, 'backend_bounded_deadlines');
  need(same(JSON.parse(await readFile(join(claimDir(proof), 'claim.json'), 'utf8')),
    { target: binding.target, binding_sha256: proof.binding_sha256 }), 'backend_durable_claim_required');
  signal?.throwIfAborted();
  const started = await open(join(claimDir(proof), 'started'), 'wx', 0o600); await started.sync(); await started.close(); await syncDir(claimDir(proof));
  const state = await nativeOutputPath(binding.state_dir); await mkdir(dirname(state), { recursive: true, mode: 0o700 });
  await mkdir(state, { mode: 0o700 }); await syncDir(dirname(state));
  await privateJSON(join(state, 'binding.json'), binding); await privateJSON(join(state, 'funding-proof.json'), proof);
  const keyName = options.credential_env ?? 'TINKER_API_KEY'; need(/^[A-Z][A-Z0-9_]*$/.test(keyName), 'backend_credential_env_name');
  const key = process.env[keyName]; need(typeof key === 'string' && !!key.trim(), 'backend_parent_credential_required');
  const env = cleanEnv(); env.TINKER_API_KEY = key;
  const runtime = options.runtime ?? localRuntime; const children: InstructionProcess[] = [];
  let status = 'interrupted', closing = false;
  const cancellation = new AbortController();
  const interrupted = () => {
    if (!cancellation.signal.aborted) cancellation.abort(new DOMException('instruction_backend_cancelled_or_child_died', 'AbortError'));
    for (const child of children) void child.stop().catch(() => {});
  };
  const check = () => { signal?.throwIfAborted(); cancellation.signal.throwIfAborted(); };
  const watch = (child: InstructionProcess) => {
    children.push(child);
    void child.completed.then(() => { if (!closing) interrupted(); }, () => { if (!closing) interrupted(); });
  };
  const cancelled = new Promise<never>((_, reject) => cancellation.signal.addEventListener('abort', () => reject(cancellation.signal.reason), { once: true }));
  void cancelled.catch(() => {});
  process.once('SIGTERM', interrupted); process.once('SIGINT', interrupted);
  signal?.addEventListener('abort', interrupted, { once: true });
  if (signal?.aborted) interrupted();
  try {
    const metadata: Record<string, Record<string, any>> = {}, material: Record<string, { endpoint: string; token: string; cert: string }> = {};
    for (const role of ['actor', 'learner'] as const) {
      check();
      const child = await runtime.launch({ role, signal: cancellation.signal, supervisor_python: options.python, executable: options.python ?? 'python3',
        args: [join(import.meta.dir, role === 'actor' ? 'native_instruction_actor.py' : 'native_tinker_learner.py'),
          'serve', '--config', role === 'actor' ? binding.actor_config_path : binding.learner_config_path,
          '--state', join(state, role), '--port', '0'], env: { ...env }, log: join(state, `${role}-stderr.log`) });
      watch(child); check();
      metadata[role] = await deadline(Promise.race([child.metadata(), cancelled]), options.startup_ms ?? 45_000);
      material[role] = await verifyInstructionMetadata(role, metadata[role]!, proof, join(state, role));
      check();
      await privateJSON(join(state, `${role}-metadata.json`), metadata[role]);
      await checkpoint('instruction_bridge_ready', { role, config_hash: proof[role].config_hash, evaluation_only: true });
    }
    const ca = join(state, 'ca.pem'); const caFile = await open(ca, 'wx', 0o600);
    try { await caFile.writeFile(material.actor!.cert + '\n' + material.learner!.cert); await caFile.sync(); } finally { await caFile.close(); }
    const workerEnv = cleanEnv();
    workerEnv.KEATING_NATIVE_BRIDGE_TOKEN = material.actor!.token;
    workerEnv.KEATING_LEARNER_BRIDGE_TOKEN = material.learner!.token;
    workerEnv.NODE_EXTRA_CA_CERTS = ca;
    const actorTransport: HarnessV3Request['transport'] = { kind: 'provider', provider: 'native-instruction-actor',
      model: proof.actor.model, endpoint: metadata.actor!.base_url, thinking: 'off', apiKeyEnv: 'KEATING_NATIVE_BRIDGE_TOKEN',
      modelMetadata: { name: proof.actor.model, contextWindow: proof.actor.limits.context_tokens,
        maxTokens: proof.actor.limits.max_output_tokens, reasoning: false } };
    await privateJSON(join(state, 'worker-input.json'), { ...worker, proof, python: options.python ?? 'python3', actor_transport: actorTransport,
      learner: learnerConfig(proof, material.learner!.endpoint) });
    check();
    const child = await runtime.launch({ role: 'worker', signal: cancellation.signal, supervisor_python: options.python, executable: process.execPath,
      args: [SELF, '--worker', state], env: workerEnv, log: join(state, 'worker-stderr.log') });
    children.push(child); check();
    const exit = await deadline(Promise.race([child.completed, cancelled]), options.run_ms ?? 900_000);
    check(); need(exit === 0, 'backend_episode_process_failed');
    const episode = JSON.parse(await readFile(join(state, 'episode.json'), 'utf8'));
    need(episode.training?.eligible === false, 'backend_catalog_training_ineligible');
    need(same(await inspection(binding, options), proof), 'backend_postflight_deployment_changed');
    await checkpoint('instruction_episode_returned', { state_dir: state, evaluation_only: true, limitation: proof.limitation });
    status = 'returned'; return episode;
  } finally {
    delete env.TINKER_API_KEY;
    closing = true;
    const cleanup = await Promise.allSettled([...children].reverse().map(child => child.stop()));
    const stopped = cleanup.every(result => result.status === 'fulfilled');
    process.removeListener('SIGTERM', interrupted); process.removeListener('SIGINT', interrupted);
    signal?.removeEventListener('abort', interrupted);
    await privateJSON(join(state, 'lifecycle.json'), { status: stopped ? status : 'cleanup_unverified', processes_stopped: stopped,
      supervision_records: options.runtime ? [] : ['actor', 'learner', 'worker'].slice(0, children.length).map(role => `${role}-stderr.log.supervision.json`),
      evaluation_only: true, training_eligible: false, provider_cancellation: 'not_attested', limitation: proof.limitation });
    need(stopped, 'backend_descendant_cleanup_unverified');
  }
}

function actionTarget(input: ActionBranchInput): InstructionTarget {
  return { lane: 'action', plan_sha256: input.plan.comparison_sha256, branch_id: input.branch.id,
    source_family: input.plan.admission.scenario.family, scenario_sha256: input.plan.admission.scenario_sha256 };
}
function checkActionBinding(binding: InstructionBinding, proof: InstructionProof, plan: ActionPlan, branchId: string) {
  const branch = plan.branches.find(b => b.id === branchId); need(branch, 'backend_unknown_action_branch');
  need(same(binding.target, actionTarget({ plan, branch, grant: {} as BranchGrant, checkpoint: async () => {} })), 'backend_action_target_mismatch');
  const pins = instructionModelPins(proof);
  need(same(pins.actor, plan.settings.pins.actor) && same(pins.learner, plan.settings.pins.learner), 'backend_action_model_pins');
  need(plan.settings.limits.max_provider_calls <= proof.actor.max_provider_calls!
    && plan.settings.limits.max_output_tokens <= proof.actor.limits.max_output_tokens
    && Object.entries(plan.settings.pins.controller_source_hashes).every(([name, value]) => binding.source_hashes[name] === value)
    && Object.entries(plan.settings.pins.runtime_source_hashes).every(([name, value]) => binding.source_hashes[name] === value), 'backend_action_source_or_limits');
}
export function instructionActionAdapter(bindings: Record<string, InstructionBinding>, options: InstructionOptions = {}): { funding: ActionFunding; backend: ActionBackend } {
  async function check(plan: ActionPlan) {
    need((await import('./benchmark_harness_v3.js')).HARNESS_EXPERIMENT_INSTRUCTION_VERSION === 1, 'backend_shared_instruction_seam_required');
    validateActionPlan(plan); need(same(Object.keys(bindings).sort(), plan.branches.map(b => b.id).sort()), 'backend_complete_branch_mapping_required');
    const used = new Set<string>();
    for (const branch of plan.branches) {
      const binding = bindings[branch.id]!; const proof = await inspection(binding, options);
      checkActionBinding(binding, proof, plan, branch.id);
      for (const identity of [proof.grant_hash, proof.actor.child_path, proof.learner.child_path, binding.state_dir]) {
        need(!used.has(identity), 'backend_reused_allocation_or_process_state'); used.add(identity);
      }
    }
  }
  return { funding: { verify: check, async claim(plan, branch, signal) {
    signal?.throwIfAborted();
    const binding = bindings[branch.id]!; const proof = await inspection(binding, options, true);
    checkActionBinding(binding, proof, plan, branch.id); signal?.throwIfAborted(); return recordClaim(binding, proof, signal);
  } }, backend: { preflight: check, async run(input) {
    try {
      input.signal?.throwIfAborted();
      const binding = bindings[input.branch.id]!; const proof = await inspection(binding, options, true);
      input.signal?.throwIfAborted();
      checkActionBinding(binding, proof, input.plan, input.branch.id);
      need(same(input.grant, { grant_hash: proof.grant_hash, reserved_usd: proof.reserved_usd, enforcement_sha256: proof.binding_sha256 }), 'backend_action_grant_mismatch');
      const { checkpoint, signal, ...value } = input;
      const episode = await runPair(binding, proof, { lane: 'action', input: value }, checkpoint, options, signal);
      verifyActionEpisode(input.plan, input.branch, episode); return episode;
    } catch (error) {
      // A service/worker failure or unverified cleanup stops the whole hosted
      // comparison. Detailed lifecycle evidence stays private; no sibling launch.
      throw new DOMException(`instruction_action_aborted:${error instanceof Error ? error.message : 'unknown'}`, 'AbortError');
    }
  } } };
}
/** Parent wires this into PilotDependencies.run after its full admission/format/golden checks.
 * The existing pilot CLI's checkpoint-sampler funding inspector is intentionally not reused.
 */
export async function runInstructionPilot(binding: InstructionBinding, input: PilotRunnerInput, options: InstructionOptions = {}) {
  const proof = await inspection(binding, options, true);
  need(same(binding.target, { lane: 'pilot', plan_sha256: input.plan.plan_sha256, branch_id: input.slot.id,
    source_family: input.scenario.family, scenario_sha256: input.slot.scenario_sha256 }), 'backend_pilot_target_mismatch');
  need(input.plan.configuration.actor.model === proof.actor.model && input.plan.configuration.actor.revision === proof.actor.revision
    && input.plan.configuration.learner.model === proof.learner.model && input.plan.configuration.learner.revision === proof.learner.revision
    && input.plan.configuration.actor.sampler.temperature === 1 && input.plan.configuration.actor.sampler.top_p === 1
    && input.plan.configuration.learner.sampler.temperature === 1 && input.plan.configuration.learner.sampler.top_p === 1
    && input.plan.configuration.limits.max_provider_calls <= proof.actor.max_provider_calls!
    && input.plan.configuration.actor.sampler.max_tokens === proof.actor.limits.max_output_tokens
    && input.plan.configuration.learner.sampler.max_tokens === proof.learner.limits.max_output_tokens, 'backend_pilot_model_or_limit_mismatch');
  const { checkpoint, ...value } = input;
  return runPair(binding, proof, { lane: 'pilot', input: value }, checkpoint, options);
}

async function workerMain(state: string) {
  const value = JSON.parse(await readFile(join(state, 'worker-input.json'), 'utf8'));
  const binding: InstructionBinding = JSON.parse(await readFile(join(state, 'binding.json'), 'utf8'));
  need(binding.state_dir === state, 'backend_worker_state_binding');
  const proof = await inspectInstructionBinding(binding, { python: value.python, fresh: true });
  need(same(proof, value.proof) && same(JSON.parse(await readFile(join(claimDir(proof), 'claim.json'), 'utf8')),
    { target: binding.target, binding_sha256: proof.binding_sha256 }), 'backend_worker_funding_binding');
  await stat(join(claimDir(proof), 'started'));
  for (const role of ['actor', 'learner'] as const) {
    const metadata = JSON.parse(await readFile(join(state, `${role}-metadata.json`), 'utf8'));
    const material = await verifyInstructionMetadata(role, metadata, proof, join(state, role));
    need(process.env[role === 'actor' ? 'KEATING_NATIVE_BRIDGE_TOKEN' : 'KEATING_LEARNER_BRIDGE_TOKEN'] === material.token,
      'backend_worker_credential_binding');
    need((role === 'actor' ? value.actor_transport.endpoint + '/chat/completions' : value.learner.endpoint) === material.endpoint,
      'backend_worker_endpoint_binding');
  }
  need(same(value.learner, learnerConfig(proof, value.learner.endpoint)), 'backend_worker_learner_identity');
  let sequence = 0;
  const checkpoint: ActionBranchInput['checkpoint'] = async (kind, payload) => {
    await privateJSON(join(state, `progress-${String(sequence++).padStart(5, '0')}.json`), { kind, payload });
  };
  let episode;
  if (value.lane === 'action') {
    checkActionBinding(binding, proof, value.input.plan, value.input.branch.id);
    const { nativeActionBackend } = await import('./native_action_search.js');
    const pins = instructionModelPins(proof);
    const backend = nativeActionBackend({ verifyDeployment: async () => {}, prepareBranch: async () => ({
      actor_transport: value.actor_transport, learner: new JsonChatLearner(value.learner),
      pins: { ...value.input.plan.settings.pins, ...pins }, enforcement_sha256: proof.binding_sha256,
    }) });
    episode = await backend.run({ ...value.input, checkpoint });
  } else {
    need(value.lane === 'pilot', 'backend_worker_lane');
    const { runPilotEpisode } = await import('./native_pilot_run.js');
    episode = await runPilotEpisode({ ...value.input, config: { ...value.input.config,
      actor_transport: value.actor_transport, learner: value.learner }, checkpoint });
  }
  need(episode.training.eligible === false, 'backend_training_ineligible_required');
  await privateJSON(join(state, 'episode.json'), episode);
}
if (import.meta.main) {
  const [mode, path] = process.argv.slice(2);
  try {
    need(!!path, 'backend_usage');
    if (mode === '--worker') await workerMain(await nativeOutputPath(path));
    else {
      need(mode === 'inspect', 'backend_usage');
      console.log(JSON.stringify(await inspectInstructionBinding(JSON.parse(await readFile(path, 'utf8')))));
    }
  } catch { process.stderr.write('instruction_backend_operation_failed\n'); process.exitCode = 1; }
}
