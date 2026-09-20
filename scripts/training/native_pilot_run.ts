/** Durable, parent-funded execution of native_pilot.py's reviewed Stage 1 slots.
 * Imports and `check` are offline. Only the explicit `run` CLI invokes models.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, readFile, rename, readdir } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { HarnessV3Request, HarnessV3Result } from './benchmark_harness_v3.js';
import type { NativeScenario, NativeOutcome, runNativeEpisode } from './native_episode.js';
import type { JsonLearnerConfig } from './native_simulator.js';
import { nativeSurfaceInstruction, type NativeSurface } from './native_surface.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const subprocess = promisify(execFile);
const sha = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex');
const equal = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
const TERMINAL: NativeOutcome[] = ['complete', 'learner_stop', 'tutor_failure', 'provider_failure',
  'invalid_learner_action', 'delivery_failure', 'budget_exhausted', 'assessment_unavailable'];
type Hashes = Record<string, string>;
type Episode = Omit<Awaited<ReturnType<typeof runNativeEpisode>>, 'outcome'> & { outcome: NativeOutcome };
type Sampler = { temperature: number; top_p: number; max_tokens: number };
type ModelPin = { model: string; revision: string; prompt_sha256: string; sampler: Sampler };
export interface PilotSlot {
  id: string; situation_id: string; cluster: string; condition: NativeSurface; replicate: number; paired_seed: number;
  scenario_sha256: string; initial_evidence_sha256: string; manifest_hashes: Hashes;
}
export interface PilotPlan {
  schema_version: 1; kind: 'native-stage1-plan'; plan_sha256: string; manifest_hashes: Hashes;
  configuration: { authors: string[]; actor: ModelPin; learner: ModelPin; runtime: { revision: string };
    limits: { max_decisions: number; max_sessions: number; max_provider_calls: number; max_tool_calls: number;
      max_repairs: number; turn_timeout_ms: number; learner_timeout_ms: number };
    conditions: Record<NativeSurface, { surface: NativeSurface; tool_schema_sha256: string; learner_actions: string[] }> };
  situations: Array<{ id: string; scenario: NativeScenario }>; slots: PilotSlot[];
}
export interface PilotDispatch {
  kind: 'native-stage1-dispatch'; plan_sha256: string; dispatch_sha256: string;
  manifest_hashes: Hashes; slots: PilotSlot[]; reviews: unknown;
}
export interface PilotPaths {
  scenarios: string; plan: string; dispatch: string; execution: string;
  cache?: string; registry?: string; python?: string;
}
export interface SlotExecution {
  actor_transport: Extract<HarnessV3Request['transport'], { kind: 'provider' }>;
  learner: JsonLearnerConfig; allowed_tools: string[]; tools: Array<{ name: string; [key: string]: unknown }>;
  grant_path: string; sampler_config_path: string;
  /** Optional separate parent-funded native_tinker_learner.py allocation. */
  learner_config_path?: string;
}
export interface PilotExecution {
  kind: 'native-pilot-execution/v1'; plan_sha256: string; dispatch_sha256: string;
  runtime_revision: string; source_hashes: Hashes; controller_source_hashes: Hashes;
  // Current Pi harness does not forward the Python paired seed. Do not imply it does.
  paired_seed_policy: 'record_only_backend_uncontrolled';
  stage_zero: { approved: boolean; independent: boolean; reviewer: string; evidence: { uri: string; sha256: string } };
  parent_budget: { path: string; project: string; model: string; cap_usd: string };
  slots: Record<string, SlotExecution>;
}
export interface AdmittedPilot {
  plan: PilotPlan; dispatch: PilotDispatch; execution: PilotExecution; execution_sha256: string;
}
export interface PilotAttempt {
  slot_id: string; plan_sha256: string; dispatch_sha256: string; manifest_hashes: Hashes;
  scenario_sha256: string; initial_evidence_sha256: string; status: 'started' | NativeOutcome;
  receipt: { uri: string; sha256: string } | null;
}

// Python owns sorted JSON seals, admission, review semantics and Decimal funding.
// native_hash is ONLY used by the pre-existing BudgetLedger and sampler config.
export const PILOT_PYTHON_BRIDGE = String.raw`
import json, sys, hashlib
from pathlib import Path
from decimal import Decimal
sys.path.insert(0, sys.argv[1])
import native_pilot as p
import native_training as nt
from native_tinker_update import BudgetLedger, BUDGET_KIND, sealed, dollars
from native_tinker_sampler import sampler_config
a=json.loads(sys.argv[2]); mode=a['mode']
def read(path): return json.loads(Path(path).read_text())
def rawsha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
if mode == 'tools':
    print(json.dumps([p.digest(x) for x in a['tools']]))
    sys.exit(0)
paths=a['paths']
kwargs={k:Path(paths[k]) for k in ('cache','registry') if paths.get(k)}
if 'registry' in kwargs: kwargs['registry_path']=kwargs.pop('registry')
bundle=p.load_admitted_bundle(Path(paths['scenarios']), **kwargs)
plan=p.validate_pilot(read(paths['plan']),bundle)
dispatch=read(paths['dispatch'])
p.require(dispatch == p.prepare_dispatch(plan,dispatch['reviews']), 'Dispatch integrity mismatch')
e=read(paths['execution']); eh=rawsha(paths['execution'])
p.require(e['kind']=='native-pilot-execution/v1' and e['plan_sha256']==plan['plan_sha256']
          and e['dispatch_sha256']==dispatch['dispatch_sha256'], 'Execution binding mismatch')
if a.get('execution_sha256'): p.require(a['execution_sha256']==eh, 'Execution changed before dispatch')
if mode=='admit':
    print(json.dumps(dict(plan=plan,dispatch=dispatch,execution=e,execution_sha256=eh),ensure_ascii=False))
    sys.exit(0)
p.require(mode in ('funding','claim'), 'Unknown offline operation')
budget=e['parent_budget']; bp=Path(budget['path'])
p.require(bp.is_absolute() and bp.exists(), 'Existing parent-funded budget required')
ledger=read(bp); sealed(ledger,'ledger_hash')
p.require(ledger['kind']==BUDGET_KIND and ledger['project_id']==budget['project'] and ledger['model_id']==budget['model']
          and dollars(ledger['cap_usd'])==dollars(budget['cap_usd']), 'Parent budget identity mismatch')
p.require(sum((dollars(r['reserved_usd']) for r in ledger['runs'].values()),Decimal(0))<=dollars(ledger['cap_usd']), 'Parent budget exceeded')
slots={s['id']:s for s in plan['slots']}; grants={}; configs={}; used=set(); allocations=set()
for sid, cfg in e['slots'].items():
    p.require(sid in slots, 'Unknown execution slot')
    for field in ('grant_path','sampler_config_path'): p.require(Path(cfg[field]).is_absolute(), 'Absolute grant/config paths required')
    grant=read(cfg['grant_path']); sealed(grant,'plan_hash')
    p.require(grant['kind']=='native-pilot-slot-grant/v1' and grant['slot_id']==sid
              and grant['plan_sha256']==plan['plan_sha256'] and grant['dispatch_sha256']==dispatch['dispatch_sha256']
              and grant['execution_sha256']==eh and grant['phases']==['native_pilot_episode'], 'Slot funding binding mismatch')
    p.require(grant['plan_hash'] not in used, 'Reused slot grant'); used.add(grant['plan_hash'])
    held=ledger['runs'].get(grant['plan_hash'])
    p.require(held is not None and held['reserved_usd']==grant['cost']['reserved_usd']
              and held['phases']==grant['phases'] and dollars(held['reserved_usd'])>0, 'Unfunded slot')
    sc=sampler_config(read(cfg['sampler_config_path'])); alloc=sc['allocation']
    p.require(grant['sampler_config_sha256']==rawsha(cfg['sampler_config_path']), 'Sampler changed after funding')
    p.require(alloc['id']==sid and dollars(alloc['cap_usd'])<=dollars(held['reserved_usd']), 'Slot sampler exceeds grant')
    lp=Path(alloc['ledger_path'])
    p.require(lp.is_absolute() and lp.resolve()!=bp.resolve() and str(lp.resolve()) not in allocations, 'Dedicated per-slot sampler ledger required')
    allocations.add(str(lp.resolve()))
    if lp.exists():
        local=read(lp); sealed(local,'ledger_hash')
        p.require(local['kind']==BUDGET_KIND and local['project_id']==alloc['budget_project_id']
                  and local['model_id']==sc['model']['id'] and dollars(local['cap_usd'])==dollars(alloc['cap_usd']), 'Sampler budget identity mismatch')
        p.require(sum((dollars(r['reserved_usd']) for r in local['runs'].values()),Decimal(0))<=dollars(alloc['cap_usd']), 'Sampler budget exceeded')
    base=grant['bridge_endpoint'].rstrip('/')
    p.require(cfg['actor_transport']['endpoint'].rstrip('/')==base
              and (cfg.get('learner_config_path') or cfg['learner']['endpoint']==base+'/chat/completions'), 'Attested bridge endpoint mismatch')
    for role in (('actor',) if cfg.get('learner_config_path') else ('actor','learner')):
        pin=plan['configuration'][role]
        p.require(pin['model']==sc['public_model_id'] and pin['revision']==sc['model']['sampler_checkpoint'], 'Sampler checkpoint/alias pin mismatch')
        p.require(pin['sampler']['temperature']==sc['sampling']['temperature'] and pin['sampler']['top_p']==sc['sampling']['top_p']
                  and pin['sampler']['max_tokens']<=sc['limits']['max_output_tokens'], 'Sampler settings mismatch')
    if cfg.get('learner_config_path'):
        from native_tinker_learner import learner_config, funded_ledger
        lpath=Path(cfg['learner_config_path'])
        p.require(lpath.is_absolute() and rawsha(lpath)==grant.get('learner_config_sha256'), 'Instruct learner config binding mismatch')
        lc=learner_config(read(lpath)); funded_ledger(lc)
        la=lc['allocation']; child_path=str(Path(la['ledger_path']).resolve())
        p.require(Path(la['parent_ledger_path']).resolve()==bp.resolve() and child_path not in allocations
                  and la['id'] not in used, 'Dedicated same-parent learner allocation required')
        allocations.add(child_path); used.add(la['id'])
        p.require(cfg['learner']['endpoint']==grant.get('learner_endpoint'), 'Attested learner endpoint mismatch')
        # Stable across allocations; explicitly retains the provider's lack of weight attestation.
        revision=p.digest({k:lc[k] for k in ('model','tokenizer','renderer','versions','sampling')})
        pin=plan['configuration']['learner']
        p.require(pin['revision']==revision and pin['model']==lc['model']['id'], 'Instruct learner identity pin mismatch')
        p.require(pin['sampler']['temperature']==lc['sampling']['temperature'] and pin['sampler']['top_p']==lc['sampling']['top_p']
                  and pin['sampler']['max_tokens']<=lc['limits']['max_output_tokens'], 'Instruct learner sampling mismatch')
    p.require(p.digest(cfg['tools'])==plan['configuration']['conditions'][slots[sid]['condition']]['tool_schema_sha256'], 'Tool schema pin mismatch')
    grants[sid]=grant; configs[sid]=sc
for sid in a['selected']: p.require(sid in grants, 'Selected slot has no funded grant')
if mode=='claim':
    p.require(len(a['selected'])==1, 'One slot per atomic claim')
    sid=a['selected'][0]
    # Also bind the logical slot globally: a new output directory or a newly
    # issued grant must not redispatch an already-started slot in this plan.
    claims=Path(str(bp)+'.native-pilot-slots')/plan['plan_sha256']
    claims.mkdir(parents=True,exist_ok=True,mode=0o700)
    claim=claims/sid
    import os
    claim.mkdir(mode=0o700)
    for directory in (claims,claims.parent,bp.parent):
        fd=os.open(directory,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    # Global budget lock prevents a second output directory from reusing funding.
    BudgetLedger(bp,budget['project'],budget['model'],budget['cap_usd']).before(grants[sid],'native_pilot_episode')
print(json.dumps({sid:{'grant_hash':grants[sid]['plan_hash'],'reserved_usd':grants[sid]['cost']['reserved_usd']} for sid in a['selected']}))
`;

async function pythonCall<T>(paths: Pick<PilotPaths, 'python'>, args: unknown): Promise<T> {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  delete env.PYTHONHOME; delete env.PYTHONPATH;
  const { stdout } = await subprocess(paths.python ?? 'python3', ['-c', PILOT_PYTHON_BRIDGE, join(ROOT, 'scripts/training'), JSON.stringify(args)],
    { cwd: ROOT, env, maxBuffer: 48 * 1024 * 1024, timeout: 120_000 });
  return JSON.parse(stdout) as T;
}
export async function replayPilotAdmission(paths: PilotPaths): Promise<AdmittedPilot> {
  return pythonCall(paths, { mode: 'admit', paths });
}

const CONTROLLER_FILES = ['native_pilot_run.ts', 'native_episode.ts', 'native_learner.ts', 'native_simulator.ts',
  'native_surface.ts', 'native_pilot.py', 'native_scenarios.py', 'native_tinker_sampler.py', 'native_tinker_update.py', 'native_training.py',
  'native_tinker_learner.py', 'research_access.py'];
/** File pins supplement a Git revision: the parent intentionally has a dirty tree. */
export async function pilotLocalPins() {
  const { captureHarnessSources } = await import('./benchmark_harness_v3_provenance.js');
  const inventory = await captureHarnessSources(ROOT);
  const hashes: Hashes = {};
  for (const file of CONTROLLER_FILES) hashes[`scripts/training/${file}`] = sha(await readFile(join(ROOT, 'scripts/training', file)));
  const { stdout } = await subprocess('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
  return { runtime_revision: stdout.trim(), source_hashes: inventory.hashes, controller_source_hashes: hashes };
}

export function validatePilotMetadata(pilot: AdmittedPilot, pins: Awaited<ReturnType<typeof pilotLocalPins>>, learnerPromptHash: string): void {
  const { plan, dispatch, execution: e } = pilot;
  need(plan.slots.length === 180 && plan.situations.length === 30, 'pilot_design_mismatch');
  need(new Set(plan.slots.map(s => s.id)).size === 180, 'pilot_duplicate_slot');
  need(plan.plan_sha256 === dispatch.plan_sha256 && equal(plan.slots, dispatch.slots)
    && equal(plan.manifest_hashes, dispatch.manifest_hashes), 'pilot_dispatch_mismatch');
  need(e.kind === 'native-pilot-execution/v1' && e.plan_sha256 === plan.plan_sha256
    && e.dispatch_sha256 === dispatch.dispatch_sha256, 'pilot_execution_binding');
  need(e.runtime_revision === plan.configuration.runtime.revision && equal(pins, {
    runtime_revision: e.runtime_revision, source_hashes: e.source_hashes, controller_source_hashes: e.controller_source_hashes }), 'pilot_runtime_pin_mismatch');
  need(plan.configuration.actor.prompt_sha256 === e.source_hashes['SYSTEM.md'], 'pilot_actor_prompt_pin');
  need(plan.configuration.learner.prompt_sha256 === learnerPromptHash, 'pilot_learner_prompt_pin');
  need(e.paired_seed_policy === 'record_only_backend_uncontrolled', 'pilot_unsupported_seed_claim');
  const gate = e.stage_zero;
  need(gate?.approved === true && gate.independent === true && !!gate.reviewer?.trim()
    && ![...plan.configuration.authors, plan.configuration.actor.model, plan.configuration.learner.model].includes(gate.reviewer)
    && /^[a-f0-9]{64}$/.test(gate.evidence?.sha256), 'pilot_stage_zero_review_required');
  for (const [id, cfg] of Object.entries(e.slots)) {
    need(plan.slots.some(s => s.id === id), 'pilot_unknown_execution_slot');
    const transport = cfg.actor_transport;
    need(transport.kind === 'provider' && transport.model === plan.configuration.actor.model
      && transport.thinking === 'off' && !!transport.provider && !!transport.apiKeyEnv, 'pilot_actor_transport_pin');
    for (const endpoint of [transport.endpoint, cfg.learner.endpoint]) {
      const url = new URL(endpoint ?? '');
      need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'pilot_invalid_endpoint');
    }
    need(transport.modelMetadata?.maxTokens === plan.configuration.actor.sampler.max_tokens, 'pilot_actor_token_limit');
    need(cfg.learner.model === plan.configuration.learner.model && cfg.learner.revision === plan.configuration.learner.revision
      && (cfg.learner.temperature ?? 1) === plan.configuration.learner.sampler.temperature
      && (cfg.learner.max_tokens ?? 1024) === plan.configuration.learner.sampler.max_tokens
      && cfg.learner.json_mode === 'prompt_only', 'pilot_learner_transport_pin');
    need(new Set(cfg.allowed_tools).size === cfg.allowed_tools.length && equal([...cfg.allowed_tools].sort(), cfg.tools.map(t => t.name).sort()), 'pilot_tool_profile_mismatch');
    need(cfg.allowed_tools.every(t => ['plan', 'map', 'verify', 'read', 'grade_quiz'].includes(t)), 'pilot_unsupported_tool');
  }
}

async function syncDirectory(path: string) {
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function privateJSON(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path); await syncDirectory(dirname(path));
}
async function readJSON<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T; }
async function absentJSON<T>(path: string): Promise<T | null> {
  try { return await readJSON<T>(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function attemptFor(pilot: AdmittedPilot, slot: PilotSlot): PilotAttempt {
  return { slot_id: slot.id, plan_sha256: pilot.plan.plan_sha256, dispatch_sha256: pilot.dispatch.dispatch_sha256,
    manifest_hashes: slot.manifest_hashes, scenario_sha256: slot.scenario_sha256,
    initial_evidence_sha256: slot.initial_evidence_sha256, status: 'started', receipt: null };
}
export interface PilotRunnerInput {
  scenario: NativeScenario; slot: PilotSlot; config: SlotExecution; plan: PilotPlan;
  checkpoint: (kind: string, payload: unknown) => Promise<void>;
}
export interface PilotDependencies {
  /** Test seam; the real CLI ALWAYS uses replayPilotAdmission. */
  admit(): Promise<AdmittedPilot>;
  preflight(pilot: AdmittedPilot, selected: string[]): Promise<void>;
  claimFunding(pilot: AdmittedPilot, slot: PilotSlot): Promise<unknown>;
  run(input: PilotRunnerInput): Promise<Episode>;
  checkResult(pilot: AdmittedPilot, slot: PilotSlot, episode: Episode): Promise<void>;
}

export async function readPilotAttempts(output: string, pilot: AdmittedPilot): Promise<PilotAttempt[]> {
  const entries = await readdir(join(output, 'slots')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  const slots = new Map(pilot.plan.slots.map(s => [s.id, s]));
  const attempts: PilotAttempt[] = [];
  for (const id of entries.sort()) {
    const slot = slots.get(id); need(slot, 'pilot_unknown_slot_directory');
    const expected = attemptFor(pilot, slot);
    // A crash between mkdir and start.json is still a claimed, unresolved slot.
    const actual = await absentJSON<PilotAttempt>(join(output, 'slots', id, 'attempt.json')) ?? expected;
    need(equal({ ...actual, status: 'started', receipt: null }, expected)
      && (actual.status === 'started' || TERMINAL.includes(actual.status)), 'pilot_attempt_binding_mismatch');
    if (actual.status !== 'started') {
      const receiptPath = join(output, 'slots', id, 'receipt.json');
      need(actual.receipt?.uri === pathToFileURL(receiptPath).href
        && actual.receipt.sha256 === sha(await readFile(receiptPath)), 'pilot_attempt_receipt_mismatch');
      const receipt = await readJSON<{ slot_id: string; plan_sha256: string; dispatch_sha256: string;
        status: string; episode: { uri: string; sha256: string } }>(receiptPath);
      const episodePath = join(output, 'slots', id, 'episode.json');
      need(receipt.status === actual.status && receipt.slot_id === id && receipt.plan_sha256 === pilot.plan.plan_sha256
        && receipt.dispatch_sha256 === pilot.dispatch.dispatch_sha256
        && receipt.episode.uri === pathToFileURL(episodePath).href
        && receipt.episode.sha256 === sha(await readFile(episodePath)), 'pilot_terminal_evidence_mismatch');
    }
    attempts.push(actual);
  }
  return attempts;
}
export function pilotDenominators(pilot: AdmittedPilot, attempts: PilotAttempt[]) {
  return (['chat', 'interactive'] as const).map(condition => {
    const ids = new Set(pilot.plan.slots.filter(s => s.condition === condition).map(s => s.id));
    const rows = attempts.filter(a => ids.has(a.slot_id));
    return { condition, planned: ids.size, attempted: rows.length, unattempted: ids.size - rows.length,
      unresolved: rows.filter(a => a.status === 'started').length,
      statuses: Object.fromEntries(['started', ...TERMINAL].map(s => [s, rows.filter(a => a.status === s).length])),
      assessed: 0, learning_effect: null };
  });
}

/** One directory claim per slot; fsynced before grant claim, then before runner invocation. */
export async function executePilot(output: string, selected: string[], deps: PilotDependencies) {
  need(isAbsolute(output), 'pilot_absolute_output_required');
  need(selected.length > 0 && new Set(selected).size === selected.length, 'pilot_explicit_unique_selection_required');
  const pilot = await deps.admit();
  need(selected.every(id => pilot.plan.slots.some(s => s.id === id) && pilot.execution.slots[id]), 'pilot_unconfigured_selection');
  await deps.preflight(pilot, selected);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await syncDirectory(dirname(output));
  // Exclusive immutable binding also prevents mixing two plans in a resumed directory.
  const binding = { plan_sha256: pilot.plan.plan_sha256, dispatch_sha256: pilot.dispatch.dispatch_sha256,
    execution_sha256: pilot.execution_sha256 };
  try {
    const handle = await open(join(output, 'binding.json'), 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(binding)); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(output);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  need(equal(await readJSON(join(output, 'binding.json')), binding), 'pilot_output_binding_mismatch');
  await mkdir(join(output, 'slots'), { recursive: true, mode: 0o700 });
  await syncDirectory(output);
  const previous = await readPilotAttempts(output, pilot);
  const already = new Set(previous.map(a => a.slot_id));
  for (const id of selected) {
    if (already.has(id)) continue;
    const slot = pilot.plan.slots.find(s => s.id === id)!;
    need(/^pilot-[a-f0-9]{32}$/.test(id), 'pilot_invalid_slot_path');
    const directory = join(output, 'slots', id);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    await syncDirectory(join(output, 'slots'));
    const attempt = attemptFor(pilot, slot);
    await privateJSON(join(directory, 'attempt.json'), attempt);
    let sequence = 0;
    const checkpoint = async (kind: string, payload: unknown) => {
      const number = sequence++;
      await privateJSON(join(directory, `progress-${String(number).padStart(5, '0')}.json`),
        { sequence: number, slot_id: id, at: new Date().toISOString(), kind, payload });
    };
    // Failures here remain started/unknown. No catch converts a possibly sent call into a retry.
    const grant = await deps.claimFunding(pilot, slot);
    await checkpoint('funded_inflight', { grant, paired_seed: slot.paired_seed,
      paired_seed_policy: pilot.execution.paired_seed_policy });
    const scenario = pilot.plan.situations.find(s => s.id === slot.situation_id)!.scenario;
    let episode: Episode;
    try { episode = await deps.run({ scenario: structuredClone(scenario), slot: structuredClone(slot),
      plan: structuredClone(pilot.plan), config: structuredClone(pilot.execution.slots[id]!), checkpoint }); }
    catch {
      await checkpoint('runner_interrupted', { status: 'started', provider_completion: 'unknown' });
      throw new Error('pilot_runner_interrupted_no_automatic_retry');
    }
    await privateJSON(join(directory, 'episode.json'), episode);
    let pinError: string | null = null;
    try { await deps.checkResult(pilot, slot, episode); }
    catch { pinError = 'actual_runtime_pin_or_surface_mismatch'; }
    let status: PilotAttempt['status'] = episode.outcome;
    if (!TERMINAL.includes(status as NativeOutcome)) status = 'tutor_failure';
    if (episode.runtime.status === 'failed') status = /limit/.test(episode.runtime.error_code ?? '') ? 'budget_exhausted'
      : /provider|tape/.test(episode.runtime.error_code ?? '') ? 'provider_failure' : 'tutor_failure';
    if (pinError) status = 'tutor_failure';
    const counts = episode.ledger.reduce<Record<string, number>>((acc, event) => {
      acc[event.kind] = (acc[event.kind] ?? 0) + 1; return acc;
    }, {});
    const receipt = { kind: 'native-pilot-slot-receipt/v1', slot_id: id, plan_sha256: pilot.plan.plan_sha256,
      dispatch_sha256: pilot.dispatch.dispatch_sha256, execution_sha256: pilot.execution_sha256,
      status, reported_outcome: episode.outcome, runtime_status: episode.runtime.status, runtime_error: episode.runtime.error_code,
      pin_error: pinError, measurement: episode.measurement, event_counts: counts,
      provider_requests_prepared: episode.runtime.requests.length,
      // Neither these prepared requests nor assistant error messages are claimed to be paid samples.
      paid_samples: null, assessment: null, learning_effect: null,
      episode: { uri: pathToFileURL(join(directory, 'episode.json')).href, sha256: sha(await readFile(join(directory, 'episode.json'))) } };
    const receiptPath = join(directory, 'receipt.json');
    await privateJSON(receiptPath, receipt);
    await privateJSON(join(directory, 'attempt.json'), { ...attempt, status,
      receipt: { uri: pathToFileURL(receiptPath).href, sha256: sha(await readFile(receiptPath)) } });
    // A pin drift blocks subsequent paid slots even though this failed attempt is preserved.
    if (pinError) throw new Error('pilot_actual_pin_mismatch_remaining_slots_blocked');
  }
  const attempts = await readPilotAttempts(output, pilot);
  await privateJSON(join(output, 'attempts.json'), attempts);
  const report = { kind: 'native-pilot-execution-summary/v1', plan_sha256: pilot.plan.plan_sha256,
    denominators: pilotDenominators(pilot, attempts), paired_seed_policy: pilot.execution.paired_seed_policy,
    assessment: 'independent_review_pending', authoritative: 'slots/*/attempt.json; rebuild projection after concurrent runs' };
  await privateJSON(join(output, 'execution-summary.json'), report);
  return report;
}

/** Real production runner; checkpoints contain actual settled steps and learner observations. */
export async function runPilotEpisode(input: PilotRunnerInput): Promise<Episode> {
  const { runNativeEpisode } = await import('./native_episode.js');
  const { runHarnessEpisode } = await import('./benchmark_harness_v3.js');
  const { JsonChatLearner } = await import('./native_simulator.js');
  const learner = new JsonChatLearner(input.config.learner);
  const trackedLearner = {
    provenance: learner.provenance,
    async next(...args: Parameters<typeof learner.next>) {
      await input.checkpoint('learner_observation', { observation: args[0], context: args[1] });
      const intent = await learner.next(...args);
      await input.checkpoint('learner_response', { observation_hash: args[0].observationHash, intent });
      return intent;
    },
  };
  const limits = input.plan.configuration.limits;
  return runNativeEpisode(input.scenario, input.config.actor_transport, trackedLearner, {
    branch_id: input.slot.id, surface: input.slot.condition, allowed_tools: input.config.allowed_tools,
    max_decisions: limits.max_decisions, max_sessions: limits.max_sessions, learner_timeout_ms: limits.learner_timeout_ms,
    limits: { max_provider_calls: limits.max_provider_calls, max_tool_calls: limits.max_tool_calls,
      max_output_tokens: input.plan.configuration.actor.sampler.max_tokens, turn_timeout_ms: limits.turn_timeout_ms },
  }, (request, diagnostics, controller) => runHarnessEpisode(request, diagnostics, controller && {
    max_steps: controller.max_steps,
    async afterStep(step) {
      await input.checkpoint('runtime_step', step);
      const next = await controller.afterStep(step);
      await input.checkpoint('next_runtime_step', next);
      return next;
    },
  }));
}

export async function checkPilotEpisode(pilot: AdmittedPilot, slot: PilotSlot, episode: Episode, python?: string): Promise<void> {
  const { plan, execution: e } = pilot;
  const cfg = e.slots[slot.id]!; const runtime = episode.runtime;
  const limits = plan.configuration.limits;
  need(episode.id === slot.situation_id && episode.branch_id === slot.id && episode.measurement === 'model_episode', 'pilot_actual_episode_identity');
  need(runtime.configuration.surface === slot.condition && runtime.configuration.transport_kind === 'provider'
    && runtime.configuration.surface_instruction_sha256 === sha(nativeSurfaceInstruction(slot.condition))
    && equal(runtime.configuration.allowed_tools, cfg.allowed_tools), 'pilot_actual_surface');
  need(equal(runtime.configuration.limits, { max_provider_calls: limits.max_provider_calls, max_tool_calls: limits.max_tool_calls,
    max_output_tokens: plan.configuration.actor.sampler.max_tokens, turn_timeout_ms: limits.turn_timeout_ms }), 'pilot_actual_limits');
  need(runtime.source_provenance.unchanged_at_end === true && equal(runtime.source_hashes, e.source_hashes), 'pilot_actual_source_drift');
  need(episode.learner_policy.model === plan.configuration.learner.model && episode.learner_policy.revision === plan.configuration.learner.revision
    && episode.learner_policy.prompt_sha256 === plan.configuration.learner.prompt_sha256, 'pilot_actual_learner_pin');
  if (slot.condition === 'chat') for (const event of episode.ledger) {
    if (event.kind !== 'delivered_observation') continue;
    const observation = event.payload as { documents: unknown[]; availableActions: unknown[] };
    need(observation.documents?.length === 0 && observation.availableActions?.length === 0, 'pilot_chat_controls_leaked');
  }
  const requests = runtime.requests as Array<{ data: { model: { id: string }; context: { systemPrompt: string; tools?: unknown[] } } }>;
  const toolHashes = await pythonCall<string[]>({ python }, { mode: 'tools', tools: requests.map(r => r.data.context.tools ?? []) });
  requests.forEach((r, i) => {
    need(r.data.model.id === plan.configuration.actor.model
      && r.data.context.systemPrompt.endsWith(nativeSurfaceInstruction(slot.condition))
      && toolHashes[i] === plan.configuration.conditions[slot.condition].tool_schema_sha256, 'pilot_actual_request_pin');
  });
}

function liveDependencies(paths: PilotPaths): PilotDependencies {
  return {
    admit: () => replayPilotAdmission(paths),
    async preflight(pilot, selected) {
      const { LEARNER_PROMPT, JsonChatLearner } = await import('./native_simulator.js');
      validatePilotMetadata(pilot, await pilotLocalPins(), sha(LEARNER_PROMPT));
      for (const id of selected) new JsonChatLearner(pilot.execution.slots[id]!.learner);
      const evidence = pilot.execution.stage_zero.evidence;
      const path = fileURLToPath(evidence.uri);
      need(sha(await readFile(path)) === evidence.sha256, 'pilot_stage_zero_evidence_changed');
      await pythonCall(paths, { mode: 'funding', paths, selected, execution_sha256: pilot.execution_sha256 });
    },
    async claimFunding(pilot, slot) {
      // Recheck code, admission, all reviews, metadata and funding immediately before each paid slot.
      const { LEARNER_PROMPT } = await import('./native_simulator.js');
      validatePilotMetadata(pilot, await pilotLocalPins(), sha(LEARNER_PROMPT));
      need(sha(await readFile(fileURLToPath(pilot.execution.stage_zero.evidence.uri))) === pilot.execution.stage_zero.evidence.sha256,
        'pilot_stage_zero_evidence_changed');
      return pythonCall(paths, { mode: 'claim', paths, selected: [slot.id], execution_sha256: pilot.execution_sha256 });
    },
    run: runPilotEpisode,
    async checkResult(pilot, slot, episode) {
      await checkPilotEpisode(pilot, slot, episode, paths.python);
      const { LEARNER_PROMPT } = await import('./native_simulator.js');
      validatePilotMetadata(pilot, await pilotLocalPins(), sha(LEARNER_PROMPT));
    },
  };
}

if (import.meta.main) {
  const [command, specPath, outputPath, ...selected] = process.argv.slice(2);
  if (command === 'pins') process.stdout.write(JSON.stringify(await pilotLocalPins()) + '\n');
  else {
    need((command === 'check' || command === 'run' || command === 'status') && specPath && outputPath,
      'Usage: bun native_pilot_run.ts pins | check|run|status PATHS_JSON OUTPUT [SLOT_ID ...]');
    const paths = await readJSON<PilotPaths>(resolve(specPath));
    const deps = liveDependencies(paths);
    if (command === 'check') {
      const pilot = await deps.admit();
      need(selected.length > 0, 'pilot_explicit_selection_required');
      await deps.preflight(pilot, selected);
      process.stdout.write(JSON.stringify({ ready: true, executes: false, selected, planned_slots: pilot.plan.slots.length }) + '\n');
    } else {
      const { nativeOutputPath } = await import('./native_paths.js');
      const output = await nativeOutputPath(outputPath);
      if (command === 'status') {
        const pilot = await deps.admit();
        need(equal(await readJSON(join(output, 'binding.json')), { plan_sha256: pilot.plan.plan_sha256,
          dispatch_sha256: pilot.dispatch.dispatch_sha256, execution_sha256: pilot.execution_sha256 }), 'pilot_output_binding_mismatch');
        const attempts = await readPilotAttempts(output, pilot);
        await privateJSON(join(output, 'attempts.json'), attempts);
        process.stdout.write(JSON.stringify({ executes: false, denominators: pilotDenominators(pilot, attempts) }) + '\n');
      } else process.stdout.write(JSON.stringify(await executePilot(output, selected, deps)) + '\n');
    }
  }
}
