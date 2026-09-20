/** Offline fixtures plus actual Pi integration; no hosted model or paid calls. */
import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { HarnessV3Request, HarnessV3Result } from './benchmark_harness_v3.js';
import type { AdaptiveLearner } from './native_learner.js';
import { nativeSurfaceInstruction } from './native_surface.js';
import { ACTION_MOVES, actionHash, actionInstruction, admitActionScenario, compareActionBranches, createActionPlan,
  executeActionSearch, experimentFor, nativeActionBackend, parentActionFunding, readActionReceipts, validateActionPlan,
  type ActionAdmission, type ActionBackend, type ActionBranchInput, type ActionExperimentInstruction, type ActionFunding,
  type ActionPlan, type ActionReceipt, type ActionReview, type ActionSettings, type ExperimentHarness } from './native_action_search.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const ROOT = resolve(import.meta.dir, '../..');
const TEST_ROOT = join(ROOT, '.keating/native-learning/action-search-tests');
const command = promisify(execFile);
let directory: string, output: string, admission: ActionAdmission, settings: ActionSettings, plan: ActionPlan;
beforeEach(async () => {
  await mkdir(TEST_ROOT, { recursive: true }); directory = await mkdtemp(join(TEST_ROOT, 'authored-')); output = join(directory, 'run');
  admission = { scenario: { schema_version: 1, id: 'authored-fractions', family: 'authored-family-keep-together',
    source: { dataset: 'authored-test-only', record_id: 'fixture-1' },
    actor: { opening_message: 'I added 1/3 + 1/4 and got 2/7. Please help me think through it.' },
    learner: { profile_evidence: [{ wrong_attempt: '2/7' }], assumptions: [{ authored: 'may ask for a hint' }] },
    evaluation_only: { private_result: 'PRIVATE_AFTERWARD', answer_key: 'PRIVATE_GOLD' } },
    bundle_sha256: hash('authored bundle'), registry_sha256: hash('authored registry'), scenario_sha256: hash('authored source'),
    initial_evidence_sha256: hash('authored public views') };
  settings = { authors: ['fixture-author'], moves: ['diagnose', 'hint', 'worked_example'], learner_replicates: 2,
    pins: { actor: { model: 'authored-actor', revision: 'fixed-checkpoint', configuration_sha256: hash('actor') },
      learner: { kind: 'model', model: 'authored-learner', revision: 'fixed-learner-checkpoint', prompt_sha256: hash('learner-prompt'), request_contract_sha256: hash('learner-contract') },
      runtime_source_hashes: { 'SYSTEM.md': hash('authored system') }, controller_source_hashes: { fixture: hash('authored controller') } },
    surface: 'chat', allowed_tools: [], tools_sha256: actionHash([]),
    limits: { max_provider_calls: 4, max_tool_calls: 4, max_output_tokens: 128, turn_timeout_ms: 1000, learner_timeout_ms: 1000 },
    utility: { metric: 'authored_quality', outcome_unit: 'rubric_points', minimum: 0, maximum: 1,
      costs: [{ unit: 'USD', outcome_units_per_cost_unit: 0.5 }] } };
  plan = createActionPlan(admission, settings);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function fixtureFunding(onClaim?: () => void): ActionFunding {
  return { verify: async () => {}, claim: async (_plan, branch) => {
    onClaim?.(); return { grant_hash: hash(branch.id), reserved_usd: '0.50', enforcement_sha256: hash('authored cap') };
  } };
}
function fixtureHarness(record?: (request: HarnessV3Request & { experiment_instruction?: ActionExperimentInstruction }) => void): ExperimentHarness {
  let count = 0;
  return { HARNESS_EXPERIMENT_INSTRUCTION_VERSION: 1, async runHarnessEpisode(request, _diagnostics, controller) {
    record?.(structuredClone(request));
    const instruction = (request as HarnessV3Request & { experiment_instruction?: ActionExperimentInstruction }).experiment_instruction;
    const step: HarnessV3Result['steps'][number] = { index: 0, kind: 'message', status: 'completed', message_start_index: 0,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Are thirds and fourths pieces of equal size?' }] }],
      events: [], state: { sessionId: `authored-isolated-workspace-${count++}` }, files: [] };
    const next = await controller?.afterStep(step);
    const steps = [step];
    if (next) {
      const followup = { ...step, index: 1, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Try drawing the pieces.' }] }] };
      steps.push(followup); await controller?.afterStep(followup);
    }
    return { id: request.id, status: 'completed', error_code: null, runtime: 'keating-tui-pi-rpc', measurement: 'offline_integration',
      fidelity: { entrypoint: 'authored harness seam', model_loop: 'authored', tool_handlers: 'authored', persistence: 'authored', limitations: ['Not a model or real Pi episode'] },
      configuration: { surface: request.surface, surface_instruction_sha256: hash(nativeSurfaceInstruction(request.surface!)),
        experiment_instruction: instruction, allowed_tools: request.allowed_tools!, limits: request.limits!, transport_kind: 'tape', profile_name: null },
      source_hashes: plan.settings.pins.runtime_source_hashes,
      source_provenance: { scope: 'authored', unresolved_optional_imports: [], unchanged_at_end: true, changed_paths: [] },
      steps, requests: [{ kind: 'provider_request', data: { model: { id: plan.settings.pins.actor.model }, context: {
        tools: [], systemPrompt: 'Authored system\n\n' + instruction?.instruction + '\n\n' + nativeSurfaceInstruction(request.surface!) } } }],
      receipts: [], files: [], initial_files: [], session_files: [],
    } as HarnessV3Result;
  } };
}
function backend(options: { harness?: ExperimentHarness; learner?: AdaptiveLearner; observations?: unknown[]; prepared?: string[] } = {}) {
  const harness = options.harness ?? fixtureHarness();
  return nativeActionBackend({ loadHarness: async () => harness, verifyDeployment: async () => {},
    prepareBranch: async input => {
      options.prepared?.push(input.branch.id);
      const learner: AdaptiveLearner = options.learner ?? { provenance: structuredClone(plan.settings.pins.learner), async next(observation, context) {
        options.observations?.push(structuredClone({ observation, context }));
        // Deliberately mutate the passed copy: siblings must retain the original profile.
        context.profile_evidence.push({ injected: 'must not persist' });
        return { kind: 'message', text: 'The pieces have different sizes.' };
      } };
      return { actor_transport: { kind: 'tape', responses: [] }, learner, pins: structuredClone(input.plan.settings.pins),
        enforcement_sha256: input.grant.enforcement_sha256 };
    } });
}
const deps = (runtime: ActionBackend = backend(), funding = fixtureFunding()) => ({ replayAdmission: async () => structuredClone(admission), backend: runtime, funding });
function review(receipt: ActionReceipt, value: number | null, usd: number | null = 0): ActionReview {
  return { branch_id: receipt.branch_id, receipt_sha256: receipt.receipt_sha256, reviewer: 'authored-independent-reviewer', independent: true,
    evidence: { uri: 'authored:review-only', sha256: hash('review') }, metric: settings.utility.metric, outcome_unit: settings.utility.outcome_unit,
    value, costs: [{ unit: 'USD', value: usd, evidence: { uri: 'authored:cost-only', sha256: hash('cost') } }] };
}

describe('bounded plans and source admission', () => {
  test('three distinct typed moves, explicit replicates and stable family are mandatory', () => {
    expect(plan.branches).toHaveLength(6);
    expect(new Set(plan.branches.map(b => b.id)).size).toBe(6);
    expect(plan.branches.map(b => [b.move, b.replicate])).toEqual([
      ['diagnose', 0], ['hint', 0], ['worked_example', 0], ['diagnose', 1], ['hint', 1], ['worked_example', 1],
    ]);
    for (const move of ACTION_MOVES) expect(actionInstruction(move)).toContain('FIRST tutor move');
    expect(() => createActionPlan(admission, { ...settings, moves: ['hint', 'hint', 'diagnose'] })).toThrow();
    expect(() => createActionPlan(admission, { ...settings, learner_replicates: 0 })).toThrow();
    expect(() => createActionPlan(admission, { ...settings, learner_replicates: 11 })).toThrow();
  });
  test('plan tampering and source admission drift are rejected before funding', async () => {
    const changed = structuredClone(plan); changed.admission.scenario.family = 'different';
    expect(() => validateActionPlan(changed)).toThrow('reconstruction');
    let claims = 0;
    await expect(executeActionSearch(plan, output, { ...deps(backend(), fixtureFunding(() => { claims++; })),
      replayAdmission: async () => ({ ...admission, initial_evidence_sha256: hash('changed') }) })).rejects.toThrow('admission_changed');
    expect(claims).toBe(0);
  });
  test('public admission has no missing-cache fallback or source fabrication', async () => {
    const bundlePath = join(directory, 'unadmitted.json');
    await writeFile(bundlePath, JSON.stringify({ purpose: 'development', scenarios: [admission.scenario] }));
    await expect(admitActionScenario({ scenarios: bundlePath, scenario_id: admission.scenario.id, cache: join(directory, 'missing-cache') })).rejects.toThrow();
  });
});

describe('native instruction boundary and isolation', () => {
  test('real Pi executes every candidate through nativeActionBackend and the stable shared seam', async () => {
    const harness = await import('./benchmark_harness_v3.js');
    const { captureHarnessSources } = await import('./benchmark_harness_v3_provenance.js');
    const actorTransport: HarnessV3Request['transport'] = { kind: 'tape', responses: [
      { text: 'Are thirds and fourths pieces of equal size?' }, { text: 'Try drawing the pieces.' },
    ] };
    const pins = structuredClone(settings.pins);
    pins.actor = { model: 'scripted', revision: 'authored-offline-tape/v1', configuration_sha256: actionHash(actorTransport) };
    pins.runtime_source_hashes = (await captureHarnessSources(ROOT)).hashes;
    pins.controller_source_hashes = { 'scripts/training/native_action_search.ts': hash(await readFile(join(import.meta.dir, 'native_action_search.ts'), 'utf8')) };
    settings = { ...settings, pins, learner_replicates: 1,
      limits: { ...settings.limits, max_provider_calls: 2, turn_timeout_ms: 30_000 } };
    plan = createActionPlan(admission, settings);
    const contexts: unknown[] = [];
    let prepared = 0, deploymentChecks = 0;
    const verifyDeployment = async () => {
      expect((await captureHarnessSources(ROOT)).hashes).toEqual(pins.runtime_source_hashes);
      expect(actionHash(actorTransport)).toBe(pins.actor.configuration_sha256);
      deploymentChecks++;
    };
    const prepareBranch = async (input: ActionBranchInput) => {
      // Authored funding fixture, but a real durable claim must precede Pi launch.
      const receipt = JSON.parse(await readFile(join(output, 'branches', input.branch.id, 'receipt.json'), 'utf8'));
      expect(receipt.state).toBe('started'); expect(receipt.grant).toEqual(input.grant);
      prepared++;
      const learner: AdaptiveLearner = { provenance: structuredClone(pins.learner), next: async (observation, context) => {
        contexts.push(structuredClone(context));
        expect(observation.visibleText).toContain('Are thirds and fourths pieces of equal size?');
        expect(observation.availableActions).toEqual([]); expect(observation.documents).toEqual([]);
        return { kind: 'message', text: 'The pieces have different sizes.' };
      } };
      return { actor_transport: structuredClone(actorTransport), learner, pins: structuredClone(pins),
        enforcement_sha256: input.grant.enforcement_sha256 };
    };
    // Exercise default shared-module discovery without supplying a fake capability.
    await nativeActionBackend({ verifyDeployment, prepareBranch }).preflight(plan);
    expect(prepared).toBe(0);
    // Explicit tape permission; this is the ACTUAL harness function, not fabricated receipts.
    const runtime = nativeActionBackend({ verifyDeployment, prepareBranch, loadHarness: async () => harness });
    const report = await executeActionSearch(plan, output, deps(runtime));
    expect(prepared).toBe(3); expect(deploymentChecks).toBeGreaterThanOrEqual(8);
    expect(contexts).toHaveLength(3);
    for (const context of contexts) {
      expect(context).toMatchObject({ initial_material: admission.scenario.actor.opening_message,
        profile_evidence: admission.scenario.learner.profile_evidence, assumptions: admission.scenario.learner.assumptions, history: [] });
      expect(JSON.stringify(context)).not.toContain('PRIVATE_');
      expect(JSON.stringify(context)).not.toContain('Native candidate comparison');
    }
    const sessions = new Set<string>();
    for (const branch of plan.branches) {
      const episode = JSON.parse(await readFile(join(output, 'branches', branch.id, 'episode.json'), 'utf8'));
      expect(episode.runtime.status).toBe('completed');
      expect(episode.runtime.source_provenance.unchanged_at_end).toBe(true);
      expect(episode.runtime.configuration.experiment_instruction).toEqual(experimentFor(plan, branch));
      expect(episode.runtime.configuration.transport_kind).toBe('tape');
      expect(episode.runtime.steps).toHaveLength(2);
      const session = episode.runtime.steps[0].state.sessionId;
      expect(typeof session).toBe('string'); sessions.add(session);
      expect(episode.runtime.session_files.length).toBeGreaterThan(0);
      expect(episode.runtime.requests).toHaveLength(2);
      for (const request of episode.runtime.requests) {
        expect(request.data.context.systemPrompt).toContain(actionInstruction(branch.move));
        expect(request.data.context.systemPrompt.endsWith(nativeSurfaceInstruction('chat'))).toBe(true);
        const messages = JSON.stringify(request.data.context.messages);
        expect(messages).toContain(admission.scenario.actor.opening_message);
        expect(messages).not.toContain('Native candidate comparison');
        expect(messages).not.toContain('PRIVATE_');
      }
      const promptReceipts = episode.runtime.receipts.filter((r: any) => r.kind === 'system_prompt');
      expect(promptReceipts.length).toBeGreaterThanOrEqual(2);
      for (const receipt of promptReceipts) expect(receipt.data.experiment_instruction).toEqual(experimentFor(plan, branch));
    }
    expect(sessions.size).toBe(3);
    expect(report.evidence_scopes).toEqual(['offline_integration']);
    expect(report.candidates.every(c => c.horizon_reached === 1 && c.failed === 0 && c.reviewed_outcomes === 0)).toBe(true);
    expect(report.best_candidates).toEqual([]);
    const durable = await readActionReceipts(output, plan);
    expect(durable.every(r => r.state === 'returned' && r.measurement === 'offline_integration')).toBe(true);
  }, 90_000);
  test('missing parent seam blocks the actual production adapter before claims or preparation', async () => {
    let claims = 0, prepared = 0;
    const runtime = nativeActionBackend({ loadHarness: async () => ({ runHarnessEpisode: fixtureHarness().runHarnessEpisode }),
      verifyDeployment: async () => {}, prepareBranch: async () => { prepared++; throw new Error('must not prepare'); } });
    await expect(executeActionSearch(plan, output, deps(runtime, fixtureFunding(() => { claims++; })))).rejects.toThrow('parent_experiment_instruction_seam');
    expect([claims, prepared]).toEqual([0, 0]);
  });
  test('real native controller gets a fresh branch; only the actor experiment field changes', async () => {
    const requests: any[] = [], observations: any[] = [], prepared: string[] = [];
    const runtime = backend({ harness: fixtureHarness(r => requests.push(r)), observations, prepared });
    const result = await executeActionSearch(plan, output, deps(runtime));
    expect(requests).toHaveLength(6); expect(new Set(prepared).size).toBe(6);
    for (const [index, request] of requests.entries()) {
      expect(request.steps).toEqual([{ kind: 'message', text: admission.scenario.actor.opening_message }]);
      expect(request.experiment_instruction).toEqual(experimentFor(plan, plan.branches[index]!));
      expect(request.surface).toBe('chat');
    }
    expect(observations).toHaveLength(6);
    for (const { observation, context } of observations) {
      expect(context.initial_material).toBe(admission.scenario.actor.opening_message);
      expect(context.profile_evidence).toEqual(admission.scenario.learner.profile_evidence);
      expect(context.assumptions).toEqual(admission.scenario.learner.assumptions);
      expect(context.history).toEqual([]);
      expect(observation.availableActions).toEqual([]);
      expect(JSON.stringify({ observation, context })).not.toContain('PRIVATE_');
      expect(JSON.stringify({ observation, context })).not.toContain('Native candidate comparison');
    }
    expect(result.recommendation_status).toBe('unknown_pending_complete_reviews_and_costs');
    expect(result.best_candidates).toEqual([]);
    expect(result.source_family).toBe(admission.scenario.family);
    expect(result.candidates.every(candidate => candidate.horizon_reached === 2 && candidate.failed === 0)).toBe(true);
    const receipts = await readActionReceipts(output, plan);
    expect(receipts.every(receipt => receipt.horizon_reached && receipt.runtime_outcome === 'budget_exhausted'
      && receipt.runtime_status === 'completed')).toBe(true);
  });
  test('reusing a stateful learner object fails instead of carrying history across branches', async () => {
    const shared: AdaptiveLearner = { provenance: plan.settings.pins.learner, next: async () => ({ kind: 'stop' }) };
    const result = await executeActionSearch(plan, output, deps(backend({ learner: shared })));
    const receipts = await readActionReceipts(output, plan);
    expect(receipts.filter(r => r.state === 'returned')).toHaveLength(1);
    expect(receipts.filter(r => r.state === 'interrupted')).toHaveLength(5);
    expect(result.best_candidates).toEqual([]);
  });
  test('missing actual instruction receipt blocks remaining branches and preserves the returned trace', async () => {
    const good = fixtureHarness();
    const bad: ExperimentHarness = { ...good, async runHarnessEpisode(...args) {
      const result = await good.runHarnessEpisode(...args);
      delete (result.configuration as any).experiment_instruction; return result;
    } };
    await expect(executeActionSearch(plan, output, deps(backend({ harness: bad })))).rejects.toThrow('remaining_branches_blocked');
    const receipts = await readActionReceipts(output, plan);
    expect(receipts).toHaveLength(1); expect(receipts[0]?.state).toBe('verification_failed');
    expect(receipts[0]?.episode).not.toBeNull();
  });
  test('prepared deployment must prove the fixed model pins and funded cap binding', async () => {
    let calls = 0;
    const h = fixtureHarness(() => { calls++; });
    const runtime = nativeActionBackend({ loadHarness: async () => h, verifyDeployment: async () => {},
      prepareBranch: async () => ({ actor_transport: { kind: 'tape', responses: [] },
        learner: { provenance: plan.settings.pins.learner, next: async () => ({ kind: 'stop' }) },
        pins: { ...plan.settings.pins, actor: { ...plan.settings.pins.actor, revision: 'changed' } }, enforcement_sha256: hash('wrong cap') }) });
    const result = await executeActionSearch(plan, output, deps(runtime));
    expect(calls).toBe(0); expect(result.candidates.every(c => c.failed === 2)).toBe(true);
  });
});

describe('durable branch accounting', () => {
  test('a real provider limit remains a failure even after a learner decision', async () => {
    const good = fixtureHarness();
    const capped: ExperimentHarness = { ...good, async runHarnessEpisode(...args) {
      const result = await good.runHarnessEpisode(...args);
      return { ...result, status: 'failed', error_code: 'harness_provider_call_limit' };
    } };
    const report = await executeActionSearch(plan, output, deps(backend({ harness: capped })));
    expect(report.candidates.every(candidate => candidate.failed === 2 && candidate.horizon_reached === 0)).toBe(true);
    const receipts = await readActionReceipts(output, plan);
    expect(receipts.every(receipt => receipt.runtime_outcome === 'budget_exhausted'
      && receipt.runtime_status === 'failed' && receipt.runtime_error === 'harness_provider_call_limit')).toBe(true);
  });
  test('refused new-session intent is a resource failure, not the planned horizon', async () => {
    const runtime = nativeActionBackend({ loadHarness: async () => fixtureHarness(), verifyDeployment: async () => {},
      prepareBranch: async input => ({ actor_transport: { kind: 'tape', responses: [] },
        learner: { provenance: plan.settings.pins.learner, next: async () => ({ kind: 'new_session' }) },
        pins: input.plan.settings.pins, enforcement_sha256: input.grant.enforcement_sha256 }) });
    const report = await executeActionSearch(plan, output, deps(runtime));
    expect(report.candidates.every(candidate => candidate.failed === 2 && candidate.horizon_reached === 0)).toBe(true);
    expect((await readActionReceipts(output, plan)).every(receipt => receipt.runtime_status === 'completed'
      && receipt.runtime_outcome === 'budget_exhausted' && !receipt.horizon_reached)).toBe(true);
  });
  test('every runner call sees its funded claim on disk; interruption retains all other candidates', async () => {
    const good = backend(); let calls = 0;
    const runtime: ActionBackend = { preflight: good.preflight, async run(input) {
      const receipt = JSON.parse(await readFile(join(output, 'branches', input.branch.id, 'receipt.json'), 'utf8'));
      expect(receipt.state).toBe('started'); expect(receipt.grant.grant_hash).toBe(input.grant.grant_hash);
      calls++;
      if (input.branch === plan.branches[0]) throw new Error('reference identity must not be shared');
      if (input.branch.id === plan.branches[0]!.id) { await input.checkpoint('authored_valid_prefix', { present: true }); throw new Error('unknown network completion'); }
      return good.run(input);
    } };
    await executeActionSearch(plan, output, deps(runtime));
    expect(calls).toBe(6);
    let receipts = await readActionReceipts(output, plan);
    expect(receipts.filter(r => r.state === 'interrupted')).toHaveLength(1);
    expect(receipts.filter(r => r.state === 'returned')).toHaveLength(5);
    await executeActionSearch(plan, output, deps(runtime)); expect(calls).toBe(6);
    receipts = await readActionReceipts(output, plan);
    expect(receipts.every(r => r.source_family === admission.scenario.family)).toBe(true);
  });
  test('funding refusal cannot invoke that branch and is not silently dropped', async () => {
    let calls = 0; const good = backend(); const funding = fixtureFunding();
    const result = await executeActionSearch(plan, output, deps({ ...good, run: input => { calls++; return good.run(input); } }, {
      verify: funding.verify, claim: async (p, b) => { if (b.id === plan.branches[0]!.id) throw new Error('not funded'); return funding.claim(p, b); },
    }));
    expect(calls).toBe(5); expect(result.attempted_branches).toBe(6);
    expect(result.candidates.find(c => c.move === 'diagnose')?.failed).toBe(1);
  });
  test('a crash after the directory claim is unresolved and never redispatched', async () => {
    await mkdir(join(output, 'branches', plan.branches[0]!.id), { recursive: true });
    await writeFile(join(output, 'plan.json'), JSON.stringify(plan));
    let calls = 0; const good = backend();
    await expect(executeActionSearch(plan, output, deps({ ...good, run: input => { calls++; return good.run(input); } }))).rejects.toThrow();
    expect(calls).toBe(0);
    expect((await readActionReceipts(output, plan)).find(r => r.branch_id === plan.branches[0]!.id)?.state).toBe('started');
  });
  test('an OS-killed runner preserves the funded started branch and resumption blocks every sibling', async () => {
    const planPath = join(directory, 'child-plan.json'); await writeFile(planPath, JSON.stringify(plan));
    const child = Bun.spawn([process.execPath, '--eval', `
      import {executeActionSearch} from ${JSON.stringify(join(import.meta.dir, 'native_action_search.ts'))};
      const p=await Bun.file(process.env.W5_PLAN).json();
      await executeActionSearch(p,process.env.W5_OUTPUT,{
        replayAdmission:async()=>p.admission,
        funding:{verify:async()=>{},claim:async()=>({grant_hash:'a'.repeat(64),reserved_usd:'0.5',enforcement_sha256:'b'.repeat(64)})},
        backend:{preflight:async()=>{},run:async(input)=>{await input.checkpoint('authored_before_kill',{});process.kill(process.pid,'SIGKILL');}}
      });
    `], { env: { ...process.env, W5_PLAN: planPath, W5_OUTPUT: output }, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).not.toBe(0);
    const before = await readActionReceipts(output, plan);
    expect(before).toHaveLength(1); expect(before[0]?.state).toBe('started'); expect(before[0]?.grant).not.toBeNull();
    let calls = 0; const good = backend();
    await expect(executeActionSearch(plan, output, deps({ ...good, run: input => { calls++; return good.run(input); } }))).rejects.toThrow();
    expect(calls).toBe(0);
  });
  test('a concurrent executor cannot acquire siblings while the comparison owner is inflight', async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(r => { entered = r; }); const held = new Promise<void>(r => { release = r; });
    const seen: string[] = []; const good = backend();
    const runtime: ActionBackend = { ...good, async run(input) {
      seen.push(input.branch.id);
      if (input.branch.id === plan.branches[0]!.id) { entered(); await held; }
      return good.run(input);
    } };
    const first = executeActionSearch(plan, output, deps(runtime)); await started;
    try { await expect(executeActionSearch(plan, output, deps(runtime))).rejects.toThrow('no_automatic_resumption'); }
    finally { release(); }
    await first;
    expect(seen).toHaveLength(6); expect(new Set(seen).size).toBe(6);
  });
  test('AbortError from a branch persists comparison abort and prevents all later claims', async () => {
    let claims = 0, runs = 0; const fund = fixtureFunding();
    const execution = deps({ preflight: async () => {}, run: async () => { runs++; throw new DOMException('cancelled', 'AbortError'); } },
      { verify: fund.verify, claim: async (p, b) => { claims++; return fund.claim(p, b); } });
    await expect(executeActionSearch(plan, output, execution)).rejects.toThrow('action_comparison_aborted');
    expect({ claims, runs }).toEqual({ claims: 1, runs: 1 });
    expect(JSON.parse(await readFile(join(output, 'abort.json'), 'utf8')).comparison_sha256).toBe(plan.comparison_sha256);
    const report = JSON.parse(await readFile(join(output, 'comparison.json'), 'utf8'));
    expect(report.planned_branches).toBe(6); expect(report.attempted_branches).toBe(1);
    await expect(executeActionSearch(plan, output, execution)).rejects.toThrow('action_comparison_aborted');
    expect(claims).toBe(1);
  });
  test.each(['preflight', 'claim', 'run'] as const)('external cancellation during %s cannot cross the next dispatch boundary', async phase => {
    const controller = new AbortController(); let claims = 0, runs = 0;
    const fund = fixtureFunding();
    const execution = { ...deps({ preflight: async () => { if (phase === 'preflight') controller.abort(); },
      run: async () => { runs++; controller.abort(); throw new Error('backend caught cancellation'); } },
      { verify: fund.verify, claim: async (p, b) => { claims++; if (phase === 'claim') controller.abort(); return fund.claim(p, b); } }), signal: controller.signal };
    await expect(executeActionSearch(plan, output, execution)).rejects.toThrow();
    expect(claims).toBe(phase === 'preflight' ? 0 : 1); expect(runs).toBe(phase === 'run' ? 1 : 0);
    expect(JSON.parse(await readFile(join(output, 'abort.json'), 'utf8')).status).toBe('aborted_no_automatic_resumption');
  });
  test('cancellation after a returned branch but before its sibling preflight keeps later grants untouched', async () => {
    const controller = new AbortController(); const good = backend(); const fund = fixtureFunding();
    let runs = 0, claims = 0, checks = 0;
    const execution = { ...deps({ preflight: async p => {
      await good.preflight(p); if (++checks === 3) controller.abort(); // postflight of the first returned branch
    }, run: input => { runs++; return good.run(input); } },
    { verify: fund.verify, claim: async (p,b) => { claims++; return fund.claim(p,b); } }), signal: controller.signal };
    await expect(executeActionSearch(plan, output, execution)).rejects.toThrow();
    expect({claims,runs}).toEqual({claims:1,runs:1});
    const receipts = await readActionReceipts(output,plan);
    expect(receipts).toHaveLength(1); expect(receipts[0]?.state).toBe('returned');
    expect(JSON.parse(await readFile(join(output,'comparison.json'),'utf8')).planned_branches).toBe(6);
  });
  test('SIGTERM survives a backend catch and stops the actual child comparison before a sibling claim', async () => {
    const path = join(directory, 'signal-plan.json'); await writeFile(path, JSON.stringify(plan));
    const child = Bun.spawn([process.execPath, '--eval', `
      import {executeActionSearch} from ${JSON.stringify(join(import.meta.dir, 'native_action_search.ts'))};
      const p=await Bun.file(process.env.W5_PLAN).json();let claims=0,runs=0;
      try { await executeActionSearch(p,process.env.W5_OUTPUT,{
        replayAdmission:async()=>p.admission,
        funding:{verify:async()=>{},claim:async()=>{claims++;return {grant_hash:'a'.repeat(64),reserved_usd:'1',enforcement_sha256:'b'.repeat(64)}}},
        backend:{preflight:async()=>{},run:async()=>{runs++;process.kill(process.pid,'SIGTERM');await Bun.sleep(30);throw new Error('caught transport cancellation')}}
      }); } catch {} console.log(JSON.stringify({claims,runs}));
    `], { env: { ...process.env, W5_PLAN: path, W5_OUTPUT: output }, stdout: 'pipe', stderr: 'pipe' });
    const result = JSON.parse(await new Response(child.stdout).text()); expect(await child.exited).toBe(0);
    expect(result).toEqual({ claims: 1, runs: 1 });
    expect(JSON.parse(await readFile(join(output, 'abort.json'), 'utf8')).reason).toBe('SIGTERM');
  });
  test('changed retained episode bytes block reporting/resumption', async () => {
    await executeActionSearch(plan, output, deps());
    await writeFile(join(output, 'branches', plan.branches[0]!.id, 'episode.json'), '{}');
    await expect(readActionReceipts(output, plan)).rejects.toThrow('evidence_changed');
    await expect(executeActionSearch(plan, output, deps())).rejects.toThrow('evidence_changed');
  });
});

describe('independent outcomes and utility units', () => {
  test('no recommendation before full reviews, even if one candidate has an attractive score', async () => {
    await executeActionSearch(plan, output, deps()); const receipts = await readActionReceipts(output, plan);
    const report = compareActionBranches(plan, receipts, [review(receipts[0]!, 1, 0)]);
    expect(report.best_candidates).toEqual([]);
    expect(report.candidates.every(c => c.mean_utility === null)).toBe(true);
  });
  test('USD is converted into outcome units; ties retain all best candidates', async () => {
    await executeActionSearch(plan, output, deps()); const receipts = await readActionReceipts(output, plan);
    const reviews = receipts.map(r => {
      const move = plan.branches.find(b => b.id === r.branch_id)!.move;
      return review(r, move === 'worked_example' ? 0.9 : 0.8, move === 'worked_example' ? 0.6 : 0.1);
    });
    const result = compareActionBranches(plan, receipts, reviews);
    expect(result.utility_unit).toBe('rubric_points');
    expect(result.best_candidates).toEqual(['diagnose', 'hint']);
    expect(result.candidates.find(c => c.move === 'worked_example')?.mean_utility).toBeCloseTo(0.6);
    expect(result.candidates.find(c => c.move === 'hint')?.mean_utility).toBeCloseTo(0.75);
  });
  test('positive weighted unknown cost abstains; zero coefficient needs no cost evidence', async () => {
    await executeActionSearch(plan, output, deps()); const receipts = await readActionReceipts(output, plan);
    const reviews = receipts.map(r => review(r, 0.7, null));
    expect(compareActionBranches(plan, receipts, reviews).best_candidates).toEqual([]);
    // A different scoring rule defines a different plan, so it cannot reuse the old receipts.
    const freePlan = createActionPlan(admission, { ...settings, utility: { ...settings.utility, costs: [{ unit: 'USD', outcome_units_per_cost_unit: 0 }] } });
    expect(() => compareActionBranches(freePlan, receipts, reviews)).toThrow('receipt_binding');
    plan = freePlan;
    const freeOutput = join(directory, 'free-cost-condition'); await executeActionSearch(plan, freeOutput, deps());
    const freeReceipts = await readActionReceipts(freeOutput, plan);
    const result = compareActionBranches(plan, freeReceipts, freeReceipts.map(r => review(r, 0.7, null)));
    expect(result.best_candidates).toEqual(settings.moves);
    expect(result.evidence_scopes).toEqual(['offline_integration']);
  });
  test('self-review, altered receipt, wrong outcome units and fractional call counts are rejected', async () => {
    await executeActionSearch(plan, output, deps()); const receipts = await readActionReceipts(output, plan);
    for (const mutation of [
      (r: ActionReview) => { r.reviewer = settings.pins.actor.model; },
      (r: ActionReview) => { r.receipt_sha256 = hash('wrong'); },
      (r: ActionReview) => { r.outcome_unit = 'seconds'; },
      (r: ActionReview) => { r.costs = [{ unit: 'provider_calls', value: 1.5, evidence: r.evidence }]; },
    ]) {
      const r = review(receipts[0]!, 0.5); mutation(r);
      expect(() => compareActionBranches(plan, receipts, [r])).toThrow();
    }
  });
});

describe('real parent ledger protocol with authored temporary funds', () => {
  async function funded() {
    const planPath = join(directory, 'authored-plan.json'); await writeFile(planPath, JSON.stringify(plan));
    const code = String.raw`
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import native_training as n
from native_tinker_update import BudgetLedger
root=Path(sys.argv[2]);p=json.loads((root/'authored-plan.json').read_text()); settings=sys.argv[3]
e=root/'authored-enforcement.json';e.write_text('Authored cap evidence; not a deployed provider.')
cap_hash=hashlib.sha256(e.read_bytes()).hexdigest()
ledger=BudgetLedger(root/'parent.json','authored-project','shared','100'); grants={}
for branch in p['branches']:
    g=n.seal({'kind':'native-action-search-grant/v1','comparison_sha256':p['comparison_sha256'],
        'source_family':p['admission']['scenario']['family'],'settings_sha256':settings,'branch_id':branch['id'],
        'phases':['action_branch'],'cost':{'reserved_usd':'0.5'},
        'enforcement':{'kind':'parent-verified-backend-cap/v1','path':str(e),'sha256':cap_hash,'maximum_usd':'0.5'}},'plan_hash')
    path=root/(branch['id']+'-grant.json');path.write_text(json.dumps(g));grants[branch['id']]=str(path);ledger.reserve(g)
print(json.dumps({'ledger':{'path':str(root/'parent.json'),'project':'authored-project','model':'shared','cap_usd':'100'},'grants':grants}))
`;
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }; delete env.PYTHONHOME; delete env.PYTHONPATH;
    const { stdout } = await command('python3', ['-c', code, import.meta.dir, directory, actionHash(plan.settings)], { env });
    return parentActionFunding(JSON.parse(stdout));
  }
  test('verify is read-only, global branch claim is once-only, changed enforcement evidence fails', async () => {
    const funding = await funded(); const before = await readFile(join(directory, 'parent.json'), 'utf8');
    await funding.verify(plan); expect(await readFile(join(directory, 'parent.json'), 'utf8')).toBe(before);
    const claimed = await funding.claim(plan, plan.branches[0]!); expect(claimed.reserved_usd).toBe('0.5');
    await expect(funding.claim(plan, plan.branches[0]!)).rejects.toThrow();
    await writeFile(join(directory, 'authored-enforcement.json'), 'Changed');
    await expect(funding.verify(plan)).rejects.toThrow('evidence changed');
  });
});
