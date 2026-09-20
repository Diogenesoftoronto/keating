/** Responsive learner controller around the production Pi harness. No fake receipts. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runHarnessEpisode, type HarnessV3Request, type HarnessV3Result } from './benchmark_harness_v3.js';
import { learnerView, nativeHash, resolveLearnerIntent, type AdaptiveLearner, type LearnerContext, type LearnerIntent } from './native_learner.js';
import { nativeOutputPath } from './native_paths.js';
import { nativeSurfaceInstruction, type NativeSurface } from './native_surface.js';
import { validateNativeSourceDocument } from './native_source_document.js';
import type { UiDocument } from '../../src/tui/learner-contracts.js';

export interface NativeScenario {
  schema_version: 1; id: string; family: string;
  source: Record<string, unknown>;
  actor: { opening_message: string };
  initial_document?: UiDocument;
  learner: { profile_evidence: unknown[]; assumptions: unknown[] };
  evaluation_only: Record<string, unknown>;
}
export type NativeOutcome = 'complete' | 'learner_stop' | 'tutor_failure' | 'provider_failure'
  | 'invalid_learner_action' | 'delivery_failure' | 'budget_exhausted' | 'assessment_unavailable';
export interface NativeEvent {
  event_id: string; episode_id: string; branch_id: string; parent_event_id: string | null;
  sequence: number; timestamp: string; origin: 'runtime' | 'learner' | 'controller';
  kind: string; visibility: 'learner' | 'evaluator'; payload: unknown;
  payload_hash: string; previous_hash: string | null; hash: string;
}
export function validateNativeScenario(value: NativeScenario): void {
  if (!value || value.schema_version !== 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    || typeof value.family !== 'string' || !value.family || typeof value.actor?.opening_message !== 'string'
    || !value.actor.opening_message.trim() || !Array.isArray(value.learner?.profile_evidence)
    || !Array.isArray(value.learner?.assumptions) || !value.source || !value.evaluation_only) throw new Error('native_invalid_scenario');
  if (value.initial_document !== undefined) validateNativeSourceDocument(value.initial_document);
}

/** Offline actor tokenization and weights are deliberately not inferred from rendered strings. */
export async function runNativeEpisode(scenario: NativeScenario, transport: HarnessV3Request['transport'], learner: AdaptiveLearner,
  options: { branch_id?: string; max_decisions?: number; max_sessions?: number; learner_timeout_ms?: number;
    allowed_tools?: string[]; surface?: NativeSurface; limits?: HarnessV3Request['limits'] } = {},
  runner: typeof runHarnessEpisode = runHarnessEpisode) {
  validateNativeScenario(scenario);
  if (options.surface !== undefined) nativeSurfaceInstruction(options.surface);
  const maxDecisions = options.max_decisions ?? 6;
  const maxSessions = options.max_sessions ?? 2;
  const timeout = options.learner_timeout_ms ?? 30_000;
  if (!Number.isInteger(maxDecisions) || maxDecisions < 1 || maxDecisions > 20
    || !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 2
    || !Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) throw new Error('native_invalid_limits');
  const branch = options.branch_id ?? 'branch-0';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(branch)) throw new Error('native_invalid_branch');
  const ledger: NativeEvent[] = [];
  const append = (kind: string, origin: NativeEvent['origin'], payload: unknown, visibility: NativeEvent['visibility'] = 'evaluator') => {
    const previous = ledger.at(-1);
    const event = { event_id: `${scenario.id}-${branch}-${ledger.length}`, episode_id: scenario.id, branch_id: branch,
      parent_event_id: previous?.event_id ?? null, sequence: ledger.length, timestamp: new Date().toISOString(),
      origin, kind, visibility, payload: structuredClone(payload), payload_hash: nativeHash(payload), previous_hash: previous?.hash ?? null };
    ledger.push({ ...event, hash: nativeHash(event) });
    return event.event_id;
  };
  append('scenario_admitted', 'controller', { family: scenario.family, source: scenario.source,
    scenario_hash: nativeHash(scenario), learner_policy: learner.provenance });
  append('learner_initial_message', 'learner', { text: scenario.actor.opening_message }, 'learner');
  const context: LearnerContext = { initial_material: scenario.actor.opening_message,
    profile_evidence: structuredClone(scenario.learner.profile_evidence),
    assumptions: structuredClone(scenario.learner.assumptions), history: [] };
  let decisions = 0, sessions = 1, repairs = 0;
  let outcome: NativeOutcome = 'complete';
  let lastIntent: LearnerIntent | null = null;
  const request: HarnessV3Request = { id: scenario.id, transport,
    ...(options.surface === undefined ? {} : { surface: options.surface }),
    steps: [scenario.initial_document === undefined ? { kind: 'message', text: scenario.actor.opening_message }
      : { kind: 'source_document', document: structuredClone(scenario.initial_document), opening_message: scenario.actor.opening_message }],
    allowed_tools: options.allowed_tools ?? ['read', 'plan', 'map', 'verify', 'grade_quiz'],
    limits: { max_provider_calls: 12, max_tool_calls: 16, ...options.limits } };
  const recordStep = (receipt: HarnessV3Result['steps'][number]) => {
      append('runtime_step', 'runtime', receipt);
      if (receipt.kind === 'message' || receipt.kind === 'ui_action') {
        for (const message of receipt.messages.slice(receipt.message_start_index) as any[]) {
          if (message?.role === 'assistant') {
            append('actor_message', 'runtime', { step: receipt.index, message });
            for (const block of Array.isArray(message.content) ? message.content : []) {
              if (block?.type === 'toolCall') append('tool_call', 'runtime', { step: receipt.index, call: block });
            }
          } else if (message?.role === 'toolResult') append('tool_result', 'runtime', { step: receipt.index, message });
        }
      }
      append('state_snapshot', 'runtime', { step: receipt.index, session_id: receipt.state.sessionId ?? null,
        files: receipt.files.map(file => ({ path: file.path, sha256: file.sha256 })) });
      if (receipt.kind === 'ui_action' && receipt.action_result !== undefined) {
        const status = (receipt.action_result as any)?.status;
        append('action_receipt', 'runtime', { status: status ?? 'unavailable', result: receipt.action_result ?? null });
      }
  };
  const runtime = await runner(request, undefined, { max_steps: maxDecisions + 1,
    async afterStep(receipt) {
      recordStep(receipt);
      if (receipt.kind === 'ui_action') {
        const status = (receipt.action_result as any)?.status;
        if (status !== 'completed' && status !== 'accepted') { outcome = 'delivery_failure'; return null; }
      }
      const { observation, documents } = learnerView(receipt, options.surface);
      append(receipt.kind === 'source_document' ? 'source_observation' : 'delivered_observation', 'runtime', observation, 'learner');
      if (decisions >= maxDecisions) { outcome = 'budget_exhausted'; return null; }
      let resolved: ReturnType<typeof resolveLearnerIntent> | undefined;
      while (!resolved) {
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let raw: unknown;
        try {
          // Clone every view so a learner implementation cannot mutate ledger evidence or future requests.
          raw = await Promise.race([learner.next(structuredClone(observation), structuredClone(context), abort.signal),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('learner_timeout')); }, timeout); })]);
        } catch {
          append('learner_provider_failure', 'controller', { reason: abort.signal.aborted ? 'timeout' : 'request_failed' });
          outcome = 'provider_failure'; return null;
        } finally { if (timer) clearTimeout(timer); }
        const eventId = `${scenario.id}-${branch}-decision-${decisions}`;
        try {
          resolved = resolveLearnerIntent(raw, observation, documents, eventId);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Invalid learner intent';
          append('invalid_learner_intent', 'learner', { observation_hash: observation.observationHash, raw, reason });
          if (repairs >= 1) { outcome = 'invalid_learner_action'; return null; }
          repairs++;
          context.repair = reason;
        }
      }
      delete context.repair;
      lastIntent = resolved.intent;
      append('learner_intent', 'learner', { observation_hash: observation.observationHash, intent: lastIntent }, 'learner');
      if (lastIntent.kind === 'stop') { outcome = 'learner_stop'; return null; }
      if (lastIntent.kind === 'new_session') {
        if (sessions >= maxSessions) { outcome = 'budget_exhausted'; return null; }
        sessions++;
      }
      context.history.push({ observation, intent: lastIntent });
      decisions++;
      return resolved.step;
    } });
  // A failed step never reaches afterStep; retain that valid/failed prefix too.
  const last = runtime.steps.at(-1);
  if (last?.status === 'failed') recordStep(last);
  if (runtime.status === 'failed') outcome = /limit/.test(runtime.error_code ?? '') ? 'budget_exhausted'
    : /provider|tape/.test(runtime.error_code ?? '') ? 'provider_failure' : 'tutor_failure';
  append('episode_end', 'controller', { outcome, decisions, repairs, sessions, runtime_error: runtime.error_code,
    assessment: null, assessment_status: 'unavailable', runtime_source_hash: nativeHash(runtime.source_hashes) });
  return { schema_version: 1, id: scenario.id, branch_id: branch, family: scenario.family, source: scenario.source,
    outcome, measurement: runtime.measurement, learner_policy: learner.provenance, ledger, runtime,
    evaluation_only: scenario.evaluation_only,
    training: { eligible: false, reason: 'Actor token IDs and actual behavior logprobs require a separate verified capture.' },
    assessment: null };
}

if (import.meta.main) {
  const [scenarioPath, configPath, outputPath] = process.argv.slice(2);
  if (!scenarioPath || !configPath || !outputPath) throw new Error('Usage: bun native_episode.ts SCENARIO CONFIG NEW_OUTPUT_DIR');
  const scenario = JSON.parse(await readFile(resolve(scenarioPath), 'utf8'));
  const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  const output = await nativeOutputPath(outputPath);
  const { JsonChatLearner } = await import('./native_simulator.js');
  validateNativeScenario(scenario);
  const learner = new JsonChatLearner(config.learner);
  await mkdir(output, { recursive: false });
  const result = await runNativeEpisode(scenario, config.actor_transport, learner, config.limits);
  await writeFile(resolve(output, 'episode.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ id: result.id, outcome: result.outcome, events: result.ledger.length }) + '\n');
}
