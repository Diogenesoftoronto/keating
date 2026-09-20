/** Three real tutor moves, fresh native branches, and independently reviewed utility.
 * Importing/planning/reporting is offline. No invented tutor completions or receipts.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { HarnessV3Request, HarnessV3Result, runHarnessEpisode } from './benchmark_harness_v3.js';
import type { NativeScenario, runNativeEpisode } from './native_episode.js';
import type { AdaptiveLearner } from './native_learner.js';
import { nativeSurfaceInstruction, type NativeSurface } from './native_surface.js';
import { nativeOutputPath } from './native_paths.js';

const ROOT = resolve(import.meta.dir, '../..');
const subprocess = promisify(execFile);
const same = isDeepStrictEqual;
const hashBytes = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function need(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const isHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** W5-only canonical JSON. Python source seals and budget seals stay opaque. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { need(Number.isFinite(value), 'action_nonfinite_json'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  need(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'action_non_json_value');
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
export const actionHash = (value: unknown): string => hashBytes(canonical(value));

export const ACTION_MOVES = ['diagnose', 'hint', 'counterexample', 'worked_example', 'retrieve_practice', 'check_transfer'] as const;
export type ActionMove = typeof ACTION_MOVES[number];
const DIRECTIONS: Record<ActionMove, string> = {
  diagnose: 'Ask a focused diagnostic question to understand the learner\'s reasoning or missing concept.',
  hint: 'Offer a bounded hint and leave meaningful work for the learner.',
  counterexample: 'Offer a relevant counterexample that tests the learner\'s current reasoning.',
  worked_example: 'Teach through a worked example relevant to the learner\'s actual problem.',
  retrieve_practice: 'Use available tools or task material to find suitable practice. If retrieval is unavailable, say so; never invent a retrieval receipt.',
  check_transfer: 'Ask the learner to apply the relevant idea to a fresh problem or representation.',
};
export function actionInstruction(move: ActionMove): string {
  need(ACTION_MOVES.includes(move), 'action_unknown_move');
  return `Native candidate comparison. For the FIRST tutor move at this decision boundary: ${DIRECTIONS[move]}\n`
    + 'Generate your own response through the actual runtime. Follow the available evidence, tools and surface constraints. '
    + 'Do not invent missing source task material, tool receipts, learner answers, submissions or successful outcomes. '
    + 'You may author fresh practice through supported native activities, clearly distinguished from source material. '
    + 'If the move cannot be delivered, explain the limitation. Respond normally to subsequent learner behavior. '
    + 'This is an experimental instruction to the tutor, not a message from the learner.';
}

export interface ActionAdmission {
  scenario: NativeScenario; bundle_sha256: string; registry_sha256: string;
  scenario_sha256: string; initial_evidence_sha256: string;
}
export interface ActionAdmissionPaths { scenarios: string; scenario_id: string; cache?: string; registry?: string; python?: string }
const ADMISSION = String.raw`
import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import native_pilot as p
import native_scenarios as n
a=json.loads(sys.argv[2]); kwargs={}
if a.get('cache'): kwargs['cache']=Path(a['cache'])
if a.get('registry'): kwargs['registry_path']=Path(a['registry'])
b=p.load_admitted_bundle(Path(a['scenarios']),**kwargs)
rows=[s for s in b['scenarios'] if s['id']==a['scenario_id']]
p.require(len(rows)==1,'One admitted development situation required')
s=rows[0]; n.validate_native_scenario(s)
p.require(s['evaluation_only']['admission']['purpose']=='development','Development admission required')
print(json.dumps(dict(scenario=s,bundle_sha256=p.digest(b),registry_sha256=b['registry_sha256'],
                     scenario_sha256=p.digest(s),initial_evidence_sha256=p.digest(n.public_views(s))),ensure_ascii=False))
`;
async function pythonJSON<T>(code: string, args: unknown, executable = 'python3'): Promise<T> {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  delete env.PYTHONHOME; delete env.PYTHONPATH;
  const { stdout } = await subprocess(executable, ['-c', code, join(ROOT, 'scripts/training'), JSON.stringify(args)],
    { cwd: ROOT, env, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  return JSON.parse(stdout) as T;
}
export function admitActionScenario(paths: ActionAdmissionPaths): Promise<ActionAdmission> {
  return pythonJSON(ADMISSION, paths, paths.python);
}

export interface ActionPins {
  actor: { model: string; revision: string; configuration_sha256: string };
  learner: AdaptiveLearner['provenance'];
  runtime_source_hashes: Record<string, string>;
  controller_source_hashes: Record<string, string>;
}
export type CostUnit = 'USD' | 'seconds' | 'tokens' | 'provider_calls';
export interface ActionSettings {
  authors: string[]; moves: ActionMove[]; learner_replicates: number;
  pins: ActionPins; surface: NativeSurface; allowed_tools: string[];
  /** W5 canonical hash of the actual Pi context.tools array, not a Python plan seal. */
  tools_sha256: string;
  limits: { max_provider_calls: number; max_tool_calls: number; max_output_tokens: number;
    turn_timeout_ms: number; learner_timeout_ms: number };
  utility: { metric: string; outcome_unit: string; minimum: number; maximum: number;
    costs: Array<{ unit: CostUnit; outcome_units_per_cost_unit: number }> };
}
export interface ActionBranch { id: string; move: ActionMove; replicate: number }
export interface ActionPlan {
  kind: 'native-action-search/v1'; admission: ActionAdmission; settings: ActionSettings;
  horizon: 'one_learner_decision_with_runtime_followup';
  seed_policy: 'uncontrolled_backend_sampling'; branches: ActionBranch[]; comparison_sha256: string;
}
function validateSettings(value: ActionSettings) {
  need(value.authors.length > 0 && value.authors.every(x => typeof x === 'string' && x.trim()), 'action_authors_required');
  need(value.moves.length === 3 && new Set(value.moves).size === 3 && value.moves.every(m => ACTION_MOVES.includes(m)), 'action_three_distinct_moves_required');
  need(Number.isInteger(value.learner_replicates) && value.learner_replicates >= 1 && value.learner_replicates <= 10, 'action_explicit_replicates_1_to_10');
  nativeSurfaceInstruction(value.surface);
  need(new Set(value.allowed_tools).size === value.allowed_tools.length
    && value.allowed_tools.every(t => ['read', 'plan', 'map', 'verify', 'grade_quiz'].includes(t)), 'action_tool_profile');
  const caps = { max_provider_calls: 12, max_tool_calls: 16, max_output_tokens: 16000, turn_timeout_ms: 120000, learner_timeout_ms: 120000 };
  need(same(Object.keys(caps).sort(), Object.keys(value.limits).sort()), 'action_limit_fields');
  for (const key of Object.keys(caps) as Array<keyof typeof caps>) need(Number.isInteger(value.limits[key])
    && value.limits[key] > 0 && value.limits[key] <= caps[key], 'action_bounded_limits_required');
  need(!!value.pins.actor.model && !!value.pins.actor.revision && isHash(value.pins.actor.configuration_sha256), 'action_actor_pins');
  need(value.pins.learner.kind === 'model' && !!value.pins.learner.model && !!value.pins.learner.revision
    && isHash(value.pins.learner.prompt_sha256) && isHash(value.pins.learner.request_contract_sha256), 'action_learner_pins');
  for (const pins of [value.pins.runtime_source_hashes, value.pins.controller_source_hashes]) {
    need(Object.keys(pins).length > 0 && Object.values(pins).every(isHash), 'action_source_pins_required');
  }
  need(isHash(value.tools_sha256), 'action_tool_schema_pin');
  const u = value.utility;
  need(!!u.metric?.trim() && !!u.outcome_unit?.trim() && Number.isFinite(u.minimum) && Number.isFinite(u.maximum)
    && u.minimum < u.maximum, 'action_outcome_scale');
  need(Array.isArray(u.costs) && new Set(u.costs.map(c => c.unit)).size === u.costs.length, 'action_duplicate_cost_unit');
  for (const cost of u.costs) need(['USD', 'seconds', 'tokens', 'provider_calls'].includes(cost.unit)
    && Number.isFinite(cost.outcome_units_per_cost_unit) && cost.outcome_units_per_cost_unit >= 0, 'action_cost_units_or_coefficient');
}
export function createActionPlan(admission: ActionAdmission, settings: ActionSettings): ActionPlan {
  validateSettings(settings);
  need(!!admission.scenario.family && !!admission.scenario.actor.opening_message
    && [admission.bundle_sha256, admission.registry_sha256, admission.scenario_sha256, admission.initial_evidence_sha256].every(isHash), 'action_admitted_source_required');
  const core = { kind: 'native-action-search/v1' as const, admission: structuredClone(admission), settings: structuredClone(settings),
    horizon: 'one_learner_decision_with_runtime_followup' as const, seed_policy: 'uncontrolled_backend_sampling' as const };
  const branches: ActionBranch[] = [];
  for (let replicate = 0; replicate < settings.learner_replicates; replicate++) {
    for (const move of settings.moves) branches.push({ id: `action-${actionHash({ core, replicate, move }).slice(0, 32)}`, move, replicate });
  }
  const body = { ...core, branches };
  return { ...body, comparison_sha256: actionHash(body) };
}
export function validateActionPlan(plan: ActionPlan) {
  need(same(plan, createActionPlan(plan.admission, plan.settings)), 'action_plan_reconstruction_mismatch');
}

/** Parent-owned seam: this object must cross HarnessV3Request and be echoed in real receipts. */
export interface ActionExperimentInstruction {
  kind: 'native-action-search/v1'; comparison_sha256: string; candidate_id: ActionMove;
  instruction: string; instruction_sha256: string;
}
export function experimentFor(plan: ActionPlan, branch: ActionBranch): ActionExperimentInstruction {
  const instruction = actionInstruction(branch.move);
  return { kind: 'native-action-search/v1', comparison_sha256: plan.comparison_sha256, candidate_id: branch.move,
    instruction, instruction_sha256: hashBytes(instruction) };
}
type NativeResult = Awaited<ReturnType<typeof runNativeEpisode>>;
export interface BranchGrant {
  grant_hash: string; reserved_usd: string; enforcement_sha256: string;
}
export interface ActionFunding {
  /** Read-only validation of already reserved grants, including deployment cap evidence. */
  verify(plan: ActionPlan): Promise<void>;
  /** Must claim the logical branch globally and consume funding before any model call. */
  claim(plan: ActionPlan, branch: ActionBranch, signal?: AbortSignal): Promise<BranchGrant>;
}
export interface ActionBranchInput {
  signal?: AbortSignal;
  plan: ActionPlan; branch: ActionBranch; grant: BranchGrant;
  checkpoint(kind: string, payload: unknown): Promise<void>;
}
export interface ActionBackend {
  /** Offline readiness/pin checks. Missing experiment seam must fail here, before funding. */
  preflight(plan: ActionPlan): Promise<void>;
  run(input: ActionBranchInput): Promise<NativeResult>;
}
interface Evidence { uri: string; sha256: string }
function evidence(value: Evidence) { need(typeof value?.uri === 'string' && !!value.uri && isHash(value.sha256), 'action_evidence_reference'); }

/** Real existing BudgetLedger protocol. It does not implement a new provider API.
 * The parent attests/enforces the per-branch backend cap, and prepareBranch below
 * must verify its actual deployment mapping. No reserve() or secret lookup here.
 */
export function parentActionFunding(spec: { ledger: { path: string; project: string; model: string; cap_usd: string };
  grants: Record<string, string>; python?: string }): ActionFunding {
  const call = (plan: ActionPlan, branch?: ActionBranch) => pythonJSON<Record<string, BranchGrant>>(ACTION_FUNDING_PYTHON,
    { spec, comparison_sha256: plan.comparison_sha256, family: plan.admission.scenario.family,
      settings_sha256: actionHash(plan.settings), branches: plan.branches.map(b => b.id), claim: branch?.id ?? null }, spec.python);
  return { verify: async plan => { await call(plan); }, claim: async (plan, branch) => (await call(plan, branch))[branch.id]! };
}
export const ACTION_FUNDING_PYTHON = String.raw`
import sys,json,hashlib,os
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,sys.argv[1])
from native_tinker_update import BudgetLedger,BUDGET_KIND,sealed,dollars
a=json.loads(sys.argv[2]); spec=a['spec']; budget=spec['ledger']; path=Path(budget['path'])
def need(ok,message):
    if not ok: raise ValueError(message)
def read(path): return json.loads(Path(path).read_text())
need(path.is_absolute() and path.is_file(),'Existing parent ledger required')
l=read(path); sealed(l,'ledger_hash')
need(l['kind']==BUDGET_KIND and l['project_id']==budget['project'] and l['model_id']==budget['model']
     and dollars(l['cap_usd'])==dollars(budget['cap_usd']),'Parent identity mismatch')
need(sum((dollars(r['reserved_usd']) for r in l['runs'].values()),Decimal(0))<=dollars(l['cap_usd']),'Parent budget exceeded')
need(set(spec['grants'])==set(a['branches']),'Explicit grant for every branch required')
grants={}; result={}; seen=set()
for bid in a['branches']:
    gp=Path(spec['grants'][bid]); need(gp.is_absolute(),'Absolute grant path required')
    g=read(gp); sealed(g,'plan_hash'); held=l['runs'].get(g['plan_hash'])
    need(g['kind']=='native-action-search-grant/v1' and g['comparison_sha256']==a['comparison_sha256']
         and g['branch_id']==bid and g['source_family']==a['family'] and g['settings_sha256']==a['settings_sha256']
         and g['phases']==['action_branch'],'Action grant binding mismatch')
    need(g['plan_hash'] not in seen,'Duplicate branch grant'); seen.add(g['plan_hash'])
    need(held is not None and held['reserved_usd']==g['cost']['reserved_usd'] and held['phases']==g['phases']
         and dollars(held['reserved_usd'])>0,'Existing monetary reservation required')
    cap=g['enforcement']; ep=Path(cap['path'])
    need(cap['kind']=='parent-verified-backend-cap/v1' and ep.is_absolute() and ep.is_file()
         and hashlib.sha256(ep.read_bytes()).hexdigest()==cap['sha256'],'Backend cap evidence changed')
    need(0<dollars(cap['maximum_usd'])<=dollars(held['reserved_usd']),'Backend cap exceeds reservation')
    grants[bid]=g; result[bid]={'grant_hash':g['plan_hash'],'reserved_usd':held['reserved_usd'],'enforcement_sha256':cap['sha256']}
if a['claim'] is not None:
    bid=a['claim']; need(bid in grants,'Unknown branch claim')
    # Protect branch identity across output directories and replacement grants.
    claims=Path(str(path)+'.native-action-claims')/a['comparison_sha256']
    claims.mkdir(parents=True,exist_ok=True,mode=0o700); (claims/bid).mkdir(mode=0o700)
    for directory in (claims,claims.parent,path.parent):
        fd=os.open(directory,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    BudgetLedger(path,budget['project'],budget['model'],budget['cap_usd']).before(grants[bid],'action_branch')
print(json.dumps(result))
`;

async function syncDir(path: string) { const h = await open(path, 'r'); try { await h.sync(); } finally { await h.close(); } }
async function writeJSON(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`; const h = await open(temp, 'wx', 0o600);
  try { await h.writeFile(canonical(value) + '\n'); await h.sync(); } finally { await h.close(); }
  await rename(temp, path); await syncDir(dirname(path));
}
async function readJSON<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')); }
async function optionalJSON<T>(path: string): Promise<T | null> {
  try { return await readJSON(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
type BranchState = 'started' | 'returned' | 'interrupted' | 'funding_rejected' | 'verification_failed';
export interface ActionReceipt {
  comparison_sha256: string; branch_id: string; source_family: string; scenario_sha256: string;
  state: BranchState; runtime_outcome: string | null; runtime_error: string | null;
  runtime_status: 'completed' | 'failed' | null; horizon_reached: boolean;
  measurement: 'offline_integration' | 'model_episode' | null;
  wall_seconds: number | null; grant: BranchGrant | null; episode: Evidence | null; receipt_sha256: string;
}
function sealReceipt(value: Omit<ActionReceipt, 'receipt_sha256'>): ActionReceipt { return { ...value, receipt_sha256: actionHash(value) }; }
function initialReceipt(plan: ActionPlan, branch: ActionBranch): ActionReceipt {
  return sealReceipt({ comparison_sha256: plan.comparison_sha256, branch_id: branch.id, source_family: plan.admission.scenario.family,
    scenario_sha256: plan.admission.scenario_sha256, state: 'started', runtime_outcome: null, runtime_error: null,
    runtime_status: null, horizon_reached: false,
    measurement: null, wall_seconds: null, grant: null, episode: null });
}
export async function readActionReceipts(output: string, plan: ActionPlan): Promise<ActionReceipt[]> {
  validateActionPlan(plan);
  const ids = await readdir(join(output, 'branches')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  const result: ActionReceipt[] = [];
  for (const id of ids.sort()) {
    const branch = plan.branches.find(b => b.id === id); need(branch, 'action_unknown_branch_directory');
    const receipt = await optionalJSON<ActionReceipt>(join(output, 'branches', id, 'receipt.json')) ?? initialReceipt(plan, branch);
    validateReceipt(plan, receipt);
    if (receipt.episode) {
      const path = join(output, 'branches', id, 'episode.json');
      need(receipt.episode.uri === pathToFileURL(path).href && receipt.episode.sha256 === hashBytes(await readFile(path)), 'action_episode_evidence_changed');
      const episode = await readJSON<NativeResult>(path);
      need(receipt.runtime_status === episode.runtime.status && receipt.runtime_outcome === episode.outcome
        && receipt.horizon_reached === (receipt.state === 'returned' && reachedActionHorizon(episode)), 'action_termination_evidence_changed');
    }
    result.push(receipt);
  }
  return result;
}
function validateReceipt(plan: ActionPlan, receipt: ActionReceipt) {
  const { receipt_sha256, ...body } = receipt;
  need(receipt_sha256 === actionHash(body) && plan.branches.some(b => b.id === receipt.branch_id)
    && receipt.comparison_sha256 === plan.comparison_sha256 && receipt.source_family === plan.admission.scenario.family
    && receipt.scenario_sha256 === plan.admission.scenario_sha256, 'action_receipt_binding');
  need(['started', 'returned', 'interrupted', 'funding_rejected', 'verification_failed'].includes(receipt.state), 'action_receipt_state');
  need([null, 'offline_integration', 'model_episode'].includes(receipt.measurement), 'action_receipt_measurement');
  need([null, 'completed', 'failed'].includes(receipt.runtime_status) && typeof receipt.horizon_reached === 'boolean', 'action_receipt_termination');
  if (receipt.horizon_reached) need(receipt.state === 'returned' && receipt.runtime_status === 'completed'
    && receipt.runtime_outcome === 'budget_exhausted' && receipt.runtime_error === null, 'action_horizon_requires_successful_runtime');
  if (receipt.state === 'returned' || receipt.state === 'verification_failed') {
    need(receipt.episode !== null && receipt.measurement !== null, 'action_returned_evidence_required'); evidence(receipt.episode);
  }
  need(receipt.wall_seconds === null || (Number.isFinite(receipt.wall_seconds) && receipt.wall_seconds >= 0), 'action_invalid_wall_time');
}

interface ActionDependencies {
  replayAdmission(): Promise<ActionAdmission>; funding: ActionFunding; backend: ActionBackend; signal?: AbortSignal;
}
/** One comparison owns cancellation for its entire lifetime, including gaps between branches. */
export async function executeActionSearch(plan: ActionPlan, output: string, deps: ActionDependencies) {
  validateActionPlan(plan); need(isAbsolute(output), 'action_absolute_output_required');
  output = await nativeOutputPath(output);
  const controller = new AbortController(); const abortPath = join(output, 'abort.json');
  const abort = (reason: string) => {
    // Synchronous persistence precedes callbacks which may terminate child processes.
    mkdirSync(output, { recursive: true, mode: 0o700 });
    try {
      const fd = openSync(abortPath, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify({ comparison_sha256: plan.comparison_sha256, reason,
        at: new Date().toISOString(), status: 'aborted_no_automatic_resumption' })); fsyncSync(fd); } finally { closeSync(fd); }
      const directory = openSync(output, 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!controller.signal.aborted) controller.abort(new DOMException('action_comparison_aborted', 'AbortError'));
  };
  const check = () => {
    if (existsSync(abortPath) && !controller.signal.aborted) abort('external_persistent_abort');
    controller.signal.throwIfAborted();
  };
  const term = () => abort('SIGTERM'), interrupt = () => abort('SIGINT'), external = () => abort('external_abort_signal');
  process.on('SIGTERM', term); process.on('SIGINT', interrupt); deps.signal?.addEventListener('abort', external);
  let owner = false;
  try {
    if (deps.signal?.aborted) external(); check();
    const prior = await readActionReceipts(output, plan); check();
    if (existsSync(join(output, 'comparison-started.json'))) {
      // A completed invocation may be read again. A concurrent or dead owner cannot
      // transfer still-unattempted branches to a new process automatically.
      need(existsSync(join(output, 'comparison.json')) && prior.length === plan.branches.length
        && prior.every(r => r.state !== 'started'), 'action_comparison_already_started_no_automatic_resumption');
      return compareActionBranches(plan, prior, []);
    }
    if (prior.length) { abort('unresolved_prior_execution'); check(); }
    await mkdir(output, { recursive: true, mode: 0o700 }); check();
    const start = await open(join(output, 'comparison-started.json'), 'wx', 0o600);
    owner = true;
    try { await start.writeFile(JSON.stringify({ comparison_sha256: plan.comparison_sha256, pid: process.pid })); await start.sync(); }
    finally { await start.close(); }
    await syncDir(output); check();
    return await executeActionBranches(plan, output, deps, { signal: controller.signal, check, abort });
  } finally {
    try {
      if (owner) {
        // Keep all planned candidates in the denominator even when later branches never start.
        const report = compareActionBranches(plan, await readActionReceipts(output, plan), []);
        await writeJSON(join(output, 'comparison.json'), report);
      }
    } finally {
      process.removeListener('SIGTERM', term); process.removeListener('SIGINT', interrupt);
      deps.signal?.removeEventListener('abort', external);
    }
  }
}
async function executeActionBranches(plan: ActionPlan, output: string, deps: ActionDependencies,
  gate: { signal: AbortSignal; check(): void; abort(reason: string): void }) {
  gate.check();
  need(same(await deps.replayAdmission(), plan.admission), 'action_source_admission_changed');
  gate.check(); await deps.backend.preflight(plan); gate.check(); await deps.funding.verify(plan); gate.check();
  await mkdir(output, { recursive: true, mode: 0o700 }); await syncDir(dirname(output));
  try {
    const h = await open(join(output, 'plan.json'), 'wx', 0o600);
    try { await h.writeFile(canonical(plan)); await h.sync(); } finally { await h.close(); }
    await syncDir(output);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  need(same(await readJSON(join(output, 'plan.json')), plan), 'action_output_plan_changed');
  await mkdir(join(output, 'branches'), { recursive: true, mode: 0o700 }); await syncDir(output);
  const previous = new Set((await readActionReceipts(output, plan)).map(r => r.branch_id));
  for (const branch of plan.branches) {
    gate.check();
    if (previous.has(branch.id)) continue;
    // Fresh admission and source pins for every branch, without changing its prefix.
    need(same(await deps.replayAdmission(), plan.admission), 'action_source_admission_changed');
    gate.check(); await deps.backend.preflight(plan); gate.check();
    const directory = join(output, 'branches', branch.id);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    await syncDir(join(output, 'branches'));
    let receipt = initialReceipt(plan, branch); await writeJSON(join(directory, 'receipt.json'), receipt);
    let sequence = 0;
    const checkpoint = (kind: string, payload: unknown) => writeJSON(join(directory, `progress-${String(sequence++).padStart(5, '0')}.json`),
      { branch_id: branch.id, kind, at: new Date().toISOString(), payload });
    let grant: BranchGrant;
    try {
      gate.check(); grant = await deps.funding.claim(plan, branch, gate.signal); gate.check();
      need(isHash(grant.grant_hash) && isHash(grant.enforcement_sha256) && /^\d+(\.\d+)?$/.test(grant.reserved_usd)
        && Number(grant.reserved_usd) > 0 && Number.isFinite(Number(grant.reserved_usd)), 'action_bounded_funding_receipt');
    } catch (error) {
      receipt = sealReceipt({ ...withoutSeal(receipt), state: 'funding_rejected', runtime_error: 'funding_claim_failed_no_runner_call' });
      await writeJSON(join(directory, 'receipt.json'), receipt);
      if (gate.signal.aborted || (error as Error)?.name === 'AbortError') gate.abort('funding_cancelled');
      gate.check(); continue;
    }
    receipt = sealReceipt({ ...withoutSeal(receipt), grant }); await writeJSON(join(directory, 'receipt.json'), receipt);
    await checkpoint('funded_before_call', grant);
    const start = performance.now(); let episode: NativeResult;
    try {
      gate.check(); episode = await deps.backend.run({ plan: structuredClone(plan), branch: structuredClone(branch), grant, checkpoint, signal: gate.signal });
      gate.check();
    } catch (error) {
      receipt = sealReceipt({ ...withoutSeal(receipt), state: 'interrupted', runtime_error: 'runner_interrupted_remote_completion_unknown',
        wall_seconds: (performance.now() - start) / 1000 });
      await writeJSON(join(directory, 'receipt.json'), receipt);
      if (gate.signal.aborted || (error as Error)?.name === 'AbortError') gate.abort('branch_cancelled_or_supervision_failed');
      gate.check(); continue;
    }
    const seconds = (performance.now() - start) / 1000;
    await writeJSON(join(directory, 'episode.json'), episode);
    let verified = true;
    try { verifyActionEpisode(plan, branch, episode); await deps.backend.preflight(plan); } catch { verified = false; }
    receipt = sealReceipt({ ...withoutSeal(receipt), state: verified ? 'returned' : 'verification_failed',
      runtime_outcome: episode.outcome, runtime_status: episode.runtime.status,
      horizon_reached: verified && reachedActionHorizon(episode), runtime_error: episode.runtime.error_code, wall_seconds: seconds,
      measurement: episode.measurement,
      episode: { uri: pathToFileURL(join(directory, 'episode.json')).href, sha256: hashBytes(await readFile(join(directory, 'episode.json'))) } });
    await writeJSON(join(directory, 'receipt.json'), receipt);
    gate.check();
    // A condition/pin violation invalidates the comparison, unlike a recorded provider failure.
    if (!verified) throw new Error('action_actual_condition_mismatch_remaining_branches_blocked');
  }
  const receipts = await readActionReceipts(output, plan);
  const report = compareActionBranches(plan, receipts, []);
  await writeJSON(join(output, 'comparison.json'), report);
  return report;
}
function withoutSeal(receipt: ActionReceipt): Omit<ActionReceipt, 'receipt_sha256'> { const { receipt_sha256: _hash, ...body } = receipt; return body; }

// native_episode currently calls its planned decision horizon budget_exhausted.
// Keep that raw outcome. Distinguish it only when the actual completed follow-up
// and final controller receipt prove one accepted decision, without a limit error.
function reachedActionHorizon(episode: NativeResult): boolean {
  const end = episode.ledger.at(-1);
  const payload = end?.payload as { outcome?: string; decisions?: number; sessions?: number; runtime_error?: unknown } | undefined;
  const intents = episode.ledger.filter(event => event.kind === 'learner_intent');
  const intent = intents[0]?.payload as { intent?: { kind?: string } } | undefined;
  return episode.runtime.status === 'completed' && episode.runtime.error_code === null
    && episode.outcome === 'budget_exhausted' && end?.kind === 'episode_end'
    && payload?.outcome === 'budget_exhausted' && payload.decisions === 1 && payload.sessions === 1 && payload.runtime_error === null
    && episode.runtime.steps.length === 2 && episode.runtime.steps.every(step => step.status === 'completed')
    && intents.length === 1 && ['message', 'ui_action', 'reopen'].includes(intent?.intent?.kind ?? '');
}

export function verifyActionEpisode(plan: ActionPlan, branch: ActionBranch, episode: NativeResult) {
  const expected = experimentFor(plan, branch); const runtime = episode.runtime;
  const actual = runtime.configuration as typeof runtime.configuration & { experiment_instruction?: ActionExperimentInstruction };
  need(episode.id === plan.admission.scenario.id && episode.branch_id === branch.id
    && episode.family === plan.admission.scenario.family && same(episode.source, plan.admission.scenario.source), 'action_actual_source_family');
  need(same(actual.experiment_instruction, expected) && actual.surface === plan.settings.surface
    && actual.surface_instruction_sha256 === hashBytes(nativeSurfaceInstruction(plan.settings.surface)), 'action_actual_experiment_seam');
  const { learner_timeout_ms: _timeout, ...limits } = plan.settings.limits;
  need(same(actual.allowed_tools, plan.settings.allowed_tools) && same(actual.limits, limits), 'action_actual_capability_limits');
  need(same(runtime.source_hashes, plan.settings.pins.runtime_source_hashes)
    && runtime.source_provenance.unchanged_at_end === true && same(episode.learner_policy, plan.settings.pins.learner), 'action_actual_model_or_source_pin');
  const initial = episode.ledger.find(e => e.kind === 'learner_initial_message');
  need(same(initial?.payload, { text: plan.admission.scenario.actor.opening_message }), 'action_modified_learner_prefix');
  for (const request of runtime.requests as any[]) {
    const data = request.data;
    need(data.model.id === plan.settings.pins.actor.model && typeof data.context.systemPrompt === 'string'
      && data.context.systemPrompt.includes(expected.instruction)
      && data.context.systemPrompt.endsWith(nativeSurfaceInstruction(plan.settings.surface))
      && actionHash(data.context.tools ?? []) === plan.settings.tools_sha256, 'action_actual_actor_request');
  }
  if (plan.settings.surface === 'chat') for (const event of episode.ledger) {
    if (event.kind === 'delivered_observation') {
      const observation = event.payload as { documents: unknown[]; availableActions: unknown[] };
      need(observation.documents?.length === 0 && observation.availableActions?.length === 0, 'action_chat_control_leak');
    }
  }
}

export interface ExperimentHarness {
  HARNESS_EXPERIMENT_INSTRUCTION_VERSION?: number;
  runHarnessEpisode: typeof runHarnessEpisode;
}
/** Provider-specific cap/config verification belongs to the parent adapter.
 * prepareBranch must return a FRESH learner and measured/validated deployment
 * pins; copying plan.settings.pins is not verification. It is called only after
 * the branch grant is durably claimed, and before the native episode starts.
 */
export function nativeActionBackend(options: {
  verifyDeployment(plan: ActionPlan): Promise<void>;
  prepareBranch(input: ActionBranchInput): Promise<{ actor_transport: HarnessV3Request['transport']; learner: AdaptiveLearner;
    pins: ActionPins; enforcement_sha256: string }>;
  /** Explicit offline test seam. Default always loads the real production harness. */
  loadHarness?: () => Promise<ExperimentHarness>;
}): ActionBackend {
  const load: () => Promise<ExperimentHarness> = options.loadHarness ?? (() => import('./benchmark_harness_v3.js'));
  const learners = new WeakSet<object>();
  return {
    async preflight(plan) {
      const harness = await load();
      need(harness.HARNESS_EXPERIMENT_INSTRUCTION_VERSION === 1, 'action_parent_experiment_instruction_seam_required');
      await options.verifyDeployment(plan);
    },
    async run(input) {
      input.signal?.throwIfAborted();
      const harness = await load();
      need(harness.HARNESS_EXPERIMENT_INSTRUCTION_VERSION === 1, 'action_parent_experiment_instruction_seam_required');
      input.signal?.throwIfAborted();
      const binding = await options.prepareBranch(input);
      input.signal?.throwIfAborted();
      need(same(binding.pins, input.plan.settings.pins) && binding.enforcement_sha256 === input.grant.enforcement_sha256,
        'action_actual_deployment_binding');
      need(!learners.has(binding.learner) && same(binding.learner.provenance, input.plan.settings.pins.learner), 'action_fresh_pinned_learner_required');
      learners.add(binding.learner);
      if (binding.actor_transport.kind === 'provider') need(binding.actor_transport.model === input.plan.settings.pins.actor.model,
        'action_actual_actor_alias');
      else need(options.loadHarness !== undefined, 'action_live_requires_provider_transport');
      const { runNativeEpisode: native } = await import('./native_episode.js');
      const learner: AdaptiveLearner = { provenance: binding.learner.provenance, async next(observation, context, signal) {
        await input.checkpoint('learner_observation', { observation, context });
        const intent = await binding.learner.next(observation, context, signal);
        await input.checkpoint('learner_response', { observation_hash: observation.observationHash, intent }); return intent;
      } };
      const { learner_timeout_ms, ...limits } = input.plan.settings.limits;
      input.signal?.throwIfAborted();
      return native(structuredClone(input.plan.admission.scenario), binding.actor_transport, learner,
        { branch_id: input.branch.id, max_decisions: 1, max_sessions: 1, learner_timeout_ms, limits,
          allowed_tools: [...input.plan.settings.allowed_tools], surface: input.plan.settings.surface },
        (request, diagnostics, controller) => {
          // The ONLY intervention. No edit to request.steps, scenario or learner context.
          const withExperiment: HarnessV3Request & { experiment_instruction: ActionExperimentInstruction } = {
            ...request, experiment_instruction: experimentFor(input.plan, input.branch),
          };
          input.signal?.throwIfAborted();
          return harness.runHarnessEpisode(withExperiment, diagnostics, controller && { max_steps: controller.max_steps,
            async afterStep(step) {
              await input.checkpoint('runtime_step', step);
              const next = await controller.afterStep(step); await input.checkpoint('next_runtime_step', next); return next;
            } });
        });
    },
  };
}

export interface ActionReview {
  branch_id: string; receipt_sha256: string; reviewer: string; independent: true; evidence: Evidence;
  metric: string; outcome_unit: string; value: number | null;
  /** seconds comes from the recorded branch wall clock; never override it here. */
  costs: Array<{ unit: Exclude<CostUnit, 'seconds'>; value: number | null; evidence: Evidence }>;
}
export function compareActionBranches(plan: ActionPlan, receipts: ActionReceipt[], reviews: ActionReview[]) {
  validateActionPlan(plan);
  need(new Set(receipts.map(r => r.branch_id)).size === receipts.length, 'action_duplicate_receipt');
  receipts.forEach(r => validateReceipt(plan, r));
  const byBranch = new Map(receipts.map(r => [r.branch_id, r])); const ratings = new Map<string, ActionReview>();
  for (const review of reviews) {
    const receipt = byBranch.get(review.branch_id);
    need(receipt?.state === 'returned' && receipt.receipt_sha256 === review.receipt_sha256 && !ratings.has(review.branch_id), 'action_review_branch_or_receipt');
    need(review.independent === true && !!review.reviewer?.trim()
      && ![...plan.settings.authors, plan.settings.pins.actor.model, plan.settings.pins.learner.model].includes(review.reviewer), 'action_independent_review_required');
    evidence(review.evidence);
    const metric = plan.settings.utility;
    need(review.metric === metric.metric && review.outcome_unit === metric.outcome_unit
      && (review.value === null || (Number.isFinite(review.value) && review.value >= metric.minimum && review.value <= metric.maximum)), 'action_outcome_units_or_range');
    need(new Set(review.costs.map(c => c.unit)).size === review.costs.length, 'action_duplicate_cost_measurement');
    for (const cost of review.costs) {
      evidence(cost.evidence);
      need(['USD', 'tokens', 'provider_calls'].includes(cost.unit) && (cost.value === null || (Number.isFinite(cost.value) && cost.value >= 0
        && (cost.unit === 'USD' || Number.isInteger(cost.value)))), 'action_cost_measurement_units');
    }
    ratings.set(review.branch_id, review);
  }
  const candidates = plan.settings.moves.map(move => {
    const branches = plan.branches.filter(b => b.move === move);
    const rows = branches.map(branch => {
      const receipt = byBranch.get(branch.id); const review = ratings.get(branch.id);
      const outcome = review?.value ?? null; let penalty = 0; let known = outcome !== null;
      for (const term of plan.settings.utility.costs) {
        if (term.outcome_units_per_cost_unit === 0) continue;
        const value = term.unit === 'seconds' ? receipt?.wall_seconds : review?.costs.find(c => c.unit === term.unit)?.value;
        if (value === undefined || value === null) known = false;
        else penalty += term.outcome_units_per_cost_unit * value;
      }
      need(Number.isFinite(penalty), 'action_utility_nonfinite');
      const utility = known ? outcome! - penalty : null;
      need(utility === null || Number.isFinite(utility), 'action_utility_nonfinite');
      return { branch_id: branch.id, state: receipt?.state ?? 'unattempted', runtime_outcome: receipt?.runtime_outcome ?? null,
        runtime_status: receipt?.runtime_status ?? null, horizon_reached: receipt?.horizon_reached ?? false,
        measurement: receipt?.measurement ?? null, outcome, utility };
    });
    const utilities = rows.map(r => r.utility).filter((v): v is number => v !== null);
    const complete = utilities.length === branches.length;
    const mean = complete ? utilities.reduce((a, b) => a + b / branches.length, 0) : null;
    need(mean === null || Number.isFinite(mean), 'action_utility_nonfinite');
    return { move, planned: branches.length, attempted: rows.filter(r => r.state !== 'unattempted').length,
      returned: rows.filter(r => r.state === 'returned').length,
      horizon_reached: rows.filter(r => r.horizon_reached).length,
      failed: rows.filter(r => ['funding_rejected', 'interrupted', 'verification_failed'].includes(r.state)
        || r.runtime_status === 'failed'
        || (!r.horizon_reached && ['provider_failure', 'tutor_failure', 'invalid_learner_action', 'delivery_failure', 'budget_exhausted'].includes(r.runtime_outcome ?? ''))).length,
      unresolved: rows.filter(r => r.state === 'started' || r.state === 'interrupted').length,
      reviewed_outcomes: rows.filter(r => r.outcome !== null).length, complete_utility: complete, mean_utility: mean,
      utility_standard_error: mean !== null && utilities.length > 1 ? Math.sqrt(utilities.reduce((sum, x) => sum + (x - mean) ** 2, 0)
        / (utilities.length - 1) / utilities.length) : null, branches: rows };
  });
  const ready = candidates.every(c => c.complete_utility);
  const best = ready ? Math.max(...candidates.map(c => c.mean_utility!)) : null;
  return { kind: 'native-action-comparison/v1', comparison_sha256: plan.comparison_sha256, source_family: plan.admission.scenario.family,
    planned_branches: plan.branches.length, attempted_branches: receipts.length,
    evidence_scopes: [...new Set(receipts.map(r => r.measurement).filter(x => x !== null))],
    utility_unit: plan.settings.utility.outcome_unit, cost_terms: plan.settings.utility.costs, candidates,
    recommendation_status: ready ? 'independently_reviewed_comparison' : 'unknown_pending_complete_reviews_and_costs',
    best_candidates: ready ? candidates.filter(c => c.mean_utility === best).map(c => c.move) : [],
    interpretation: 'Replicates share one source situation and fixed profile. No new human evidence or human learning efficacy is implied.' };
}
