import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { OPENUI_JSON_PARITY_FIXTURE, type UiDocument } from '../../src/tui/learner-contracts.js';
import { learnerView, resolveLearnerIntent, nativeHash, maskUnrenderedActivityMarkup, type AdaptiveLearner } from './native_learner.js';
import { runNativeEpisode, type NativeScenario } from './native_episode.js';
import type { HarnessV3Result } from './benchmark_harness_v3.js';
import { nativeSurfaceInstruction, nativeSurfaceSystemPrompt } from './native_surface.js';

const scenario: NativeScenario = { schema_version: 1, id: 'authored-adaptive-fractions', family: 'authored-fractions-v1',
  source: { kind: 'independently-authored', license: 'repository', not_a_dataset_record: true },
  actor: { opening_message: 'I added the numerators and denominators to get 2/7. Please help me think through it without the answer.' },
  learner: { profile_evidence: ['The learner reported adding numerators and denominators.'], assumptions: ['A test policy can respond to a comparison question.'] },
  evaluation_only: { answer_key: 'PRIVATE_SOLUTION', need_label: 'PRIVATE_SCAFFOLDING', future: 'PRIVATE_FUTURE' } };
const doc: UiDocument = { ...structuredClone(OPENUI_JSON_PARITY_FIXTURE), id: 'actually-delivered', revision: 0, lifecycle: 'ready', nodes: [
  { type: 'notes', id: 'attempt', title: 'My reasoning', value: '', placeholder: 'Compare the size of the pieces.' },
  { type: 'question', id: 'magnitude', kind: 'text', prompt: 'Is 2/7 smaller than 1/3?', correctAnswer: 'SECRET_ANSWER', rubric: 'SECRET_RUBRIC', explanation: 'SECRET_EXPLANATION' },
] };
const fenced = `Here is your activity.\n\`\`\`keating-ui\n${JSON.stringify(doc)}\n\`\`\``;
function receipt(content: string): HarnessV3Result['steps'][number] {
  return { index: 0, kind: 'message', status: 'completed', message_start_index: 0, events: [], state: { hidden: 'PRIVATE_STATE' }, files: [],
    messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_THINKING' }, { type: 'text', text: content }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'PRIVATE_TOOL_RESULT' }] }] };
}
const provenance = { kind: 'authored_policy' as const, model: 'responsive-integration-fixture', revision: 'v1' };

test('a completed action receipt survives a failed tutor follow-up', async () => {
  const first = receipt(fenced);
  first.messages = [{ role: 'user', content: scenario.actor.opening_message }, first.messages[0]];
  const failed = { ...first, index: 1, kind: 'ui_action' as const, status: 'failed' as const,
    error_code: 'harness_turn_timeout', message_start_index: first.messages.length,
    action_result: { status: 'completed', resultingDocument: { ...doc, revision: 1 } } };
  const learner: AdaptiveLearner = { provenance, async next(observation) {
    return { kind: 'ui_action', actionId: observation.availableActions.find(a => a.type === 'update-notes')!.actionId,
      payload: { value: 'I compared the sizes.' } };
  } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [] }, learner, {}, async (_request, _diagnostics, controller) => {
    const step = await controller!.afterStep(first);
    expect(step?.kind).toBe('ui_action');
    return { id: scenario.id, status: 'failed', error_code: 'harness_turn_timeout',
      measurement: 'offline_integration', steps: [first, failed], source_hashes: {}, requests: [] } as unknown as HarnessV3Result;
  });
  const receipts = result.ledger.filter(e => e.kind === 'action_receipt');
  expect(receipts).toHaveLength(1);
  expect((receipts[0].payload as any).status).toBe('completed');
  expect(result.ledger.filter(e => e.kind === 'state_snapshot')).toHaveLength(2);
  expect(result.ledger.filter(e => e.kind === 'delivered_observation')).toHaveLength(1);
  expect(result.assessment).toBeNull();
  expect(result.outcome).toBe('tutor_failure');
});

test('learner projection hides keys, private state, thinking, tool internals and explanations', () => {
  const { observation } = learnerView(receipt(fenced));
  const serialized = JSON.stringify(observation);
  for (const secret of ['SECRET_ANSWER', 'SECRET_RUBRIC', 'SECRET_EXPLANATION', 'PRIVATE_STATE', 'PRIVATE_THINKING', 'PRIVATE_TOOL_RESULT']) expect(serialized).not.toContain(secret);
  expect(serialized).toContain('Is 2/7 smaller than 1/3?');
  expect(observation.availableActions).toHaveLength(2);
  const { observationHash, ...value } = observation;
  expect(observationHash).toBe(nativeHash(value));
});

test('chat and interactive expose different real affordances from the same settled output', () => {
  const chat = learnerView(receipt(fenced), 'chat');
  const interactive = learnerView(receipt(fenced), 'interactive');
  expect(chat.observation.visibleText).toContain('Here is your activity.');
  expect(chat.observation.visibleText).toContain('unavailable');
  expect(chat.observation.documents).toHaveLength(0);
  expect(chat.observation.availableActions).toHaveLength(0);
  expect(chat.documents.size).toBe(0);
  expect(interactive.observation.availableActions).toHaveLength(2);
  expect(() => resolveLearnerIntent({ kind: 'ui_action', actionId: interactive.observation.availableActions[0]!.actionId,
    payload: { value: 'Cannot submit here.' } }, chat.observation, chat.documents, 'forbidden')).toThrow('not available');
  expect(chat.observation.observationHash).not.toBe(interactive.observation.observationHash);
  expect(() => learnerView(receipt('plain'), 'invented' as any)).toThrow('native_invalid_surface');
});

test('real chat runtime pins the surface prompt and cannot expose canonical submissions', async () => {
  const learner: AdaptiveLearner = { provenance, async next(observation) {
    expect(observation.documents).toHaveLength(0);
    expect(observation.availableActions).toHaveLength(0);
    return { kind: 'stop' };
  } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [{ text: fenced }] }, learner,
    { surface: 'chat', allowed_tools: [], limits: { turn_timeout_ms: 20_000 } });
  expect(result.outcome).toBe('learner_stop');
  expect(result.runtime.configuration.surface).toBe('chat');
  expect(result.runtime.configuration.allowed_tools).toEqual([]);
  expect(result.runtime.configuration.surface_instruction_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result.runtime.requests)).toContain(nativeSurfaceInstruction('chat'));
  expect(JSON.stringify(result.runtime.requests)).not.toContain('Use a shared OpenUI document for every');
  expect(JSON.stringify(result.runtime.requests)).toContain('Teach for mastery');
  expect(result.ledger.filter(e => e.kind === 'action_receipt')).toHaveLength(0);
}, 30_000);

test('chat policy projection rejects drift and preserves unrelated teaching and learner context', () => {
  const source = 'Teach for mastery. Author learner-facing interactions and artifacts as OpenUI.\n\n'
    + '## OpenUI interaction contract\nEmit canonical documents here.\nCurrent date: 2026-09-13\nSaved evidence.';
  const chat = nativeSurfaceSystemPrompt(source, 'chat');
  expect(chat).toContain('Teach for mastery.');
  expect(chat).toContain('Saved evidence.');
  expect(chat).not.toContain('Emit canonical documents here.');
  expect(chat.endsWith(nativeSurfaceInstruction('chat'))).toBe(true);
  expect(nativeSurfaceSystemPrompt(source, 'interactive')).toBe(source + '\n\n' + nativeSurfaceInstruction('interactive'));
  expect(() => nativeSurfaceSystemPrompt(source.replace('## OpenUI interaction contract', '## New contract'), 'chat'))
    .toThrow('native_chat_policy_projection_drift');
});

for (const invalid of [
  { kind: 'message', text: '/clear' }, { kind: 'message', text: '!echo unsafe' },
  { kind: 'message', text: '' }, { kind: 'message', text: 'hello', score: 1 },
  { kind: 'stop', result: 'success' }, { kind: 'tool_result', status: 'complete' },
  { kind: 'ui_action', actionId: 'invented', payload: { answer: 'yes' } },
]) test(`rejects unavailable or privileged learner input ${JSON.stringify(invalid)}`, () => {
  const { observation, documents } = learnerView(receipt(fenced));
  expect(() => resolveLearnerIntent(invalid, observation, documents, 'event-1')).toThrow();
});

test('learner cannot submit grading metadata or a stale document', () => {
  const { observation, documents } = learnerView(receipt(fenced));
  const actionId = observation.availableActions[1]!.actionId;
  expect(() => resolveLearnerIntent({ kind: 'ui_action', actionId, payload: { answer: 'yes', score: 1 } }, observation, documents, 'event-1')).toThrow();
  documents.get(doc.id)!.revision++;
  expect(() => resolveLearnerIntent({ kind: 'ui_action', actionId, payload: { answer: 'yes' } }, observation, documents, 'event-1')).toThrow('Stale');
});

test('malformed activity metadata is not exposed as plain learner text', () => {
  const value = learnerView(receipt('Try this.\n```keating-ui\n{"answer_key":"PRIVATE_MALFORMED"}\n```')).observation;
  expect(JSON.stringify(value)).not.toContain('PRIVATE_MALFORMED');
  expect(value.availableActions).toHaveLength(0);
});

test('unsupported tagged activities stay unavailable instead of leaking their machine payload', () => {
  for (const wrapper of ['keating-ui', 'openui', 'openui-json']) {
    for (const closed of [true, false]) {
      const source = `Before. <${wrapper}>${JSON.stringify({ ...doc, answer_key: 'PRIVATE_TAGGED' })}${closed ? `</${wrapper}> After.` : ''}`;
      const observation = learnerView(receipt(source)).observation;
      for (const hidden of ['PRIVATE_TAGGED', 'SECRET_ANSWER', 'schemaVersion', doc.id])
        expect(JSON.stringify(observation)).not.toContain(hidden);
      expect(observation.availableActions).toHaveLength(0);
      expect(observation.documents).toHaveLength(0);
      expect(observation.visibleText).toContain('Before.');
      expect(observation.visibleText).toContain('could not be presented');
      if (closed) expect(observation.visibleText).toContain('After.');
    }
  }
  expect(maskUnrenderedActivityMarkup('Before <keating-ui>PRIVATE <openui>INNER</openui> STILL_PRIVATE</keating-ui> After'))
    .toBe('Before [An activity could not be presented on this surface.] After');
  expect(maskUnrenderedActivityMarkup('Before <KEATING-UI>PRIVATE</openui> MORE_PRIVATE'))
    .toBe('Before [An activity could not be presented on this surface.]');
  expect(maskUnrenderedActivityMarkup('Plain mathematical text: x < 3 and y > 2.'))
    .toBe('Plain mathematical text: x < 3 and y > 2.');
});

test('responsive learner follows actual tutor text and canonical delivered notes through real Pi', async () => {
  const observations: string[] = [];
  const learner: AdaptiveLearner = { provenance, async next(observation, context) {
    observations.push(JSON.stringify({ observation, context }));
    expect(context.initial_material).toBe(scenario.actor.opening_message);
    if (!context.history.length) {
      expect(observation.visibleText).toContain('compare');
      return { kind: 'message', text: '2/7 is smaller than 1/3. My addition should not make it smaller.' };
    }
    if (context.history.length === 1) {
      const control = observation.availableActions.find(a => a.type === 'update-notes');
      expect(control).toBeDefined();
      return { kind: 'ui_action', actionId: control!.actionId, payload: { value: 'The pieces must have equal units.' } };
    }
    expect(JSON.stringify(observation.documents)).toContain('The pieces must have equal units.');
    return { kind: 'stop' };
  } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [
    { text: 'Can you compare 2/7 with 1/3 before adding?' }, { text: fenced },
  ] }, learner, { limits: { turn_timeout_ms: 20_000 } });
  expect(result.outcome).toBe('learner_stop');
  expect(result.runtime.status).toBe('completed');
  expect(result.runtime.requests).toHaveLength(2);
  expect(JSON.stringify(result.runtime.requests[1])).toContain('My addition should not make it smaller');
  expect((result.runtime.steps[2]!.action_result as any).status).toBe('completed');
  expect(JSON.stringify(result.runtime.files)).toContain('The pieces must have equal units.');
  expect(result.training.eligible).toBe(false);
  expect(result.assessment).toBeNull();
  for (const privateValue of Object.values(scenario.evaluation_only)) {
    expect(observations.join('\n')).not.toContain(privateValue as string);
    expect(JSON.stringify(result.runtime.requests)).not.toContain(privateValue as string);
  }
  result.ledger.forEach((event, index) => {
    const { hash, ...value } = event;
    expect(hash).toBe(nativeHash(value));
    expect(event.previous_hash).toBe(index ? result.ledger[index-1]!.hash : null);
    expect(event.payload_hash).toBe(nativeHash(event.payload));
  });
  await mkdir('.keating/native-learning', { recursive: true });
  await writeFile('.keating/native-learning/authored-golden-episode.json', JSON.stringify(result, null, 2));
}, 90_000);

test('same learner policy takes a different branch for a different delivered prompt and really reopens', async () => {
  const learner: AdaptiveLearner = { provenance, async next(observation, context) {
    if (!context.history.length) return observation.visibleText.includes('reopen') ? { kind: 'reopen' } : { kind: 'message', text: 'What size are the pieces?' };
    return { kind: 'stop' };
  } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [{ text: 'Please reopen this session before continuing.' }] }, learner,
    { limits: { turn_timeout_ms: 20_000 } });
  expect(result.outcome).toBe('learner_stop');
  expect(result.runtime.steps[1]!.kind).toBe('reopen');
  expect(result.runtime.steps[1]!.state.sessionId).toBe(result.runtime.steps[0]!.state.sessionId);
}, 60_000);

test('one invalid response gets a bounded repair; second invalid response ends with explicit failure', async () => {
  let calls = 0;
  const learner: AdaptiveLearner = { provenance, async next(_observation, context) {
    calls++;
    if (calls === 2) expect(context.repair).toBeDefined();
    return { kind: 'invent-result', score: 1 };
  } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [{ text: 'What is your next step?' }] }, learner,
    { limits: { turn_timeout_ms: 20_000 } });
  expect(result.outcome).toBe('invalid_learner_action');
  expect(calls).toBe(2);
  expect(result.ledger.filter(e => e.kind === 'invalid_learner_intent')).toHaveLength(2);
  expect(result.runtime.requests).toHaveLength(1);
}, 60_000);

test('learner provider timeout preserves the real valid prefix without fabricated assessment', async () => {
  const learner: AdaptiveLearner = { provenance, async next() { return new Promise(() => {}); } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [{ text: 'Try comparing sizes.' }] }, learner,
    { learner_timeout_ms: 10, limits: { turn_timeout_ms: 20_000 } });
  expect(result.outcome).toBe('provider_failure');
  expect(result.runtime.steps).toHaveLength(1);
  expect(result.assessment).toBeNull();
}, 60_000);
