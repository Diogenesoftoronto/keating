import { expect, test } from 'bun:test';
import { runNativeEpisode, validateNativeScenario, type NativeScenario } from './native_episode.js';
import { runHarnessEpisode, validateHarnessRequest, type HarnessV3Step } from './benchmark_harness_v3.js';
import { learnerView, nativeHash, type AdaptiveLearner } from './native_learner.js';
import { decodeNativeSourceDelivery, deliveredNativeSource, encodeNativeSourceDelivery, NATIVE_SOURCE_MESSAGE, validateNativeSourceDocument } from './native_source_document.js';
import type { UiAction, UiDocument } from '../../src/tui/learner-contracts.js';

// Independently authored, with a future clock and mixed precision to exercise the prior timestamp fixes.
const document: UiDocument = { schemaVersion: 1, id: 'authored-source', revision: 0, lifecycle: 'ready',
  supportedSurfaces: ['terminal', 'web'], title: 'Equal pieces',
  createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00.000Z', nodes: [
    { type: 'question', id: 'compare', kind: 'choice', allowText: false, prompt: 'Which fraction is larger?',
      choices: [{ id: 'third', label: '1/3' }, { id: 'quarter', label: '1/4' }] },
    { type: 'question', id: 'reason', kind: 'text', prompt: 'Explain using equal-sized wholes.' },
  ] };
const scenario: NativeScenario = { schema_version: 1, id: 'authored-source-episode', family: 'authored-source-v1',
  source: { kind: 'independently-authored', private_original: 'PRIVATE_ORIGINAL_SCREEN' },
  actor: { opening_message: 'I am comparing pieces of the same whole. Help me explain my choice.' },
  initial_document: document, learner: { profile_evidence: [], assumptions: [] },
  evaluation_only: { gold: 'PRIVATE_GOLD', explanation: 'PRIVATE_EXPLANATION', rubric: 'PRIVATE_RUBRIC', hint: 'PRIVATE_HINT' } };
const provenance = { kind: 'authored_policy' as const, model: 'source-integration-policy', revision: 'v1' };
const sourceStep: HarnessV3Step = { kind: 'source_document', document, opening_message: scenario.actor.opening_message };

test('source admission is bounded, canonical, ready revision zero, and strictly key-free', () => {
  validateNativeScenario(scenario);
  const withoutAllowText = structuredClone(document);
  if (withoutAllowText.nodes[0]?.type === 'question') delete withoutAllowText.nodes[0].allowText;
  expect(() => validateNativeSourceDocument(withoutAllowText)).not.toThrow();
  const delivery = { document, opening_message: scenario.actor.opening_message, surface: 'interactive' as const };
  expect(decodeNativeSourceDelivery(encodeNativeSourceDelivery(delivery))).toEqual(delivery);
  const invalid: unknown[] = [null, { ...document, revision: 1 }, { ...document, lifecycle: 'submitted' },
    { ...document, nodes: [] }, { ...document, nodes: Array.from({ length: 17 }, (_, i) => ({ ...document.nodes[0], id: `q${i}` })) },
    { ...document, supportedSurfaces: ['web'] }, { ...document, gold: '' },
    { ...document, nodes: [{ type: 'notes', id: 'notes', value: '' }] },
    { ...document, nodes: [{ ...document.nodes[0], choices: [{ id: 'a', label: 'a', correct: true }] }] },
    { ...document, nodes: [{ ...document.nodes[0], allowText: true }] },
    { ...document, nodes: [{ ...document.nodes[1], allowText: false }] },
    { ...document, nodes: [{ ...document.nodes[1], kind: 'slider' }] }];
  for (const key of ['correctAnswer', 'correctAnswers', 'explanation', 'rubric', 'hint', 'answer', 'selected', 'gold', 'mathProblem'])
    invalid.push({ ...document, nodes: [{ ...document.nodes[0], [key]: '' }] });
  invalid.push({ ...document, nodes: Array.from({ length: 16 }, (_, i) => ({ ...document.nodes[1], id: `q${i}`, prompt: 'x'.repeat(4096) })) });
  for (const initial_document of invalid) {
    expect(() => validateNativeSourceDocument(initial_document)).toThrow('native_invalid_source_document');
    expect(() => validateNativeScenario({ ...scenario, initial_document } as NativeScenario)).toThrow();
    expect(() => validateHarnessRequest({ id: 'invalid', transport: { kind: 'tape', responses: [] },
      steps: [{ ...sourceStep, document: initial_document } as HarnessV3Step] })).toThrow();
  }
  expect(() => decodeNativeSourceDelivery('x'.repeat(300_000))).toThrow();
});

test('source is actually delivered before decisions; real Pi choice and text receipts trigger only subsequent tutor turns', async () => {
  const seen: string[] = [];
  const learner: AdaptiveLearner = { provenance, async next(observation, context) {
    seen.push(JSON.stringify({ observation, context }));
    expect(context.initial_material).toBe(scenario.actor.opening_message);
    if (!context.history.length) {
      expect(observation.visibleText).toContain('Which fraction is larger?');
      expect(observation.documents[0]?.revision).toBe(0);
      expect(observation.availableActions).toHaveLength(2);
      return { kind: 'ui_action', actionId: observation.availableActions.find(a => a.nodeId === 'compare')!.actionId,
        payload: { optionIds: ['third'] } };
    }
    if (context.history.length === 1) {
      expect(observation.visibleText).toContain('Explain your comparison.');
      expect(observation.documents[0]?.revision).toBe(1);
      return { kind: 'ui_action', actionId: observation.availableActions.find(a => a.nodeId === 'reason')!.actionId,
        payload: { answer: 'Cutting the same whole into fewer equal pieces makes each piece larger.' } };
    }
    expect(observation.visibleText).toContain('Your reasoning is recorded.');
    expect(observation.availableActions).toHaveLength(0);
    return { kind: 'stop' };
  } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [
    { text: 'Explain your comparison.' }, { text: 'Your reasoning is recorded.' },
  ] }, learner, { allowed_tools: [], limits: { turn_timeout_ms: 20_000 } });
  expect(result.runtime.error_code).toBeNull();
  expect<string>(result.outcome).toBe('learner_stop');
  expect(result.runtime.requests).toHaveLength(2);
  const seed = result.runtime.steps[0]!;
  expect(seed.kind).toBe('source_document');
  expect(seed.message_start_index).toBe(0);
  expect(seed.messages).toHaveLength(1);
  expect(deliveredNativeSource(seed.messages[0])?.details.document).toEqual(document);
  expect(seed.events.some((event: any) => event.type === 'message_end' && event.message.role === 'custom')).toBe(true);
  expect(seed.events.some((event: any) => event.type === 'agent_start')).toBe(false);
  const receipt = result.runtime.receipts.find((entry: any) => entry.kind === 'source_document_delivered') as any;
  expect(receipt.data.entry.type).toBe('custom_message');
  expect(receipt.data.entry.details.document).toEqual(document);
  expect(receipt.data.entry.id).toBeTruthy();
  for (const step of result.runtime.steps.slice(1)) {
    expect((step.action_result as any).status).toBe('completed');
    expect(step.action_followup).toBe('completed');
    expect(JSON.stringify(step.action_result)).toContain('This response requires tutor review.');
  }
  const persisted = result.runtime.session_files.flatMap(file => file.content.trim().split('\n').map(line => JSON.parse(line)));
  const custom = persisted.filter(entry => entry.type === 'custom_message' && entry.customType === NATIVE_SOURCE_MESSAGE);
  expect(custom).toHaveLength(1);
  expect(custom[0]).toEqual(receipt.data.entry);
  expect(result.ledger[1]?.kind).toBe('learner_initial_message');
  expect(result.ledger[1]?.payload).toEqual({ text: scenario.actor.opening_message });
  expect(result.ledger.filter(e => e.kind === 'source_observation')).toHaveLength(1);
  expect(result.ledger.find(e => e.kind === 'source_observation')?.visibility).toBe('learner');
  expect(result.ledger.filter(e => e.kind === 'delivered_observation')).toHaveLength(2);
  const actorEvents = result.ledger.filter(e => e.kind === 'actor_message');
  expect(actorEvents).toHaveLength(2);
  expect(actorEvents.every(e => (e.payload as any).step > 0 && (e.payload as any).message.role === 'assistant')).toBe(true);
  for (const request of result.runtime.requests) {
    expect(JSON.stringify(request)).toContain(scenario.actor.opening_message);
    expect(JSON.stringify(request)).toContain('Which fraction is larger?');
  }
  for (const secret of ['PRIVATE_ORIGINAL_SCREEN', ...Object.values(scenario.evaluation_only)]) {
    expect(JSON.stringify(result.runtime)).not.toContain(secret as string);
    expect(seen.join('\n')).not.toContain(secret as string);
  }
  expect(result.runtime.source_hashes['scripts/training/native_source_document.ts']).toMatch(/^[a-f0-9]{64}$/);
  expect(result.runtime.source_provenance.unchanged_at_end).toBe(true);
  result.ledger.forEach(event => { const { hash, ...body } = event; expect(hash).toBe(nativeHash(body)); });
}, 60_000);

test('chat receives the same source question/options as text and no controls before its first reply', async () => {
  const learner: AdaptiveLearner = { provenance, async next(observation, context) {
    expect(observation.availableActions).toHaveLength(0);
    expect(observation.documents).toHaveLength(0);
    if (!context.history.length) {
      for (const text of ['Which fraction is larger?', '(third) 1/3', '(quarter) 1/4', 'Explain using equal-sized wholes.'])
        expect(observation.visibleText).toContain(text);
      return { kind: 'message', text: 'I choose 1/3 because the pieces are larger.' };
    }
    expect(observation.visibleText).toContain('Tell me more.');
    return { kind: 'stop' };
  } };
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [{ text: 'Tell me more.' }] }, learner,
    { surface: 'chat', allowed_tools: [], limits: { turn_timeout_ms: 20_000 } });
  expect(result.runtime.error_code).toBeNull();
  expect<string>(result.outcome).toBe('learner_stop');
  expect(result.runtime.requests).toHaveLength(1);
  expect(JSON.stringify(result.runtime.requests[0])).toContain(scenario.actor.opening_message);
  expect(result.ledger.filter(e => e.kind === 'action_receipt')).toHaveLength(0);
}, 40_000);

test('a source-only episode persists real delivery evidence without any actor response', async () => {
  const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [] }, { provenance, async next() { return { kind: 'stop' }; } },
    { allowed_tools: [], limits: { turn_timeout_ms: 20_000 } });
  expect(result.runtime.error_code).toBeNull();
  expect<string>(result.outcome).toBe('learner_stop');
  expect(result.runtime.requests).toHaveLength(0);
  expect(result.ledger.filter(e => e.kind === 'actor_message' || e.kind === 'delivered_observation')).toHaveLength(0);
  expect(result.runtime.receipts.some((receipt: any) => receipt.kind === 'source_document_delivered' && receipt.data.entry.type === 'custom_message')).toBe(true);
  expect(learnerView(result.runtime.steps[0]!).observation.availableActions).toHaveLength(2);
}, 40_000);

test('source redelivery and exact submission retry after reopen preserve a single source and tutor turn', async () => {
  const action: UiAction = { schemaVersion: 1, type: 'choose-option', documentId: document.id, documentRevision: 0,
    nodeId: 'compare', optionIds: ['third'], idempotencyKey: 'source-retry-action' };
  const submit: HarnessV3Step = { kind: 'ui_action', action, sourceDocument: document };
  const result = await runHarnessEpisode({ id: 'source-retry', allowed_tools: [], transport: { kind: 'tape', responses: [{ text: 'Explain the size of each piece.' }] },
    steps: [sourceStep, sourceStep, submit, { kind: 'reopen' }, submit], limits: { turn_timeout_ms: 20_000 } });
  expect(result.error_code).toBeNull();
  expect(result.requests).toHaveLength(1);
  expect(result.receipts.filter((receipt: any) => receipt.kind === 'source_document_delivered')).toHaveLength(1);
  expect(result.receipts.filter((receipt: any) => receipt.kind === 'source_document_reused')).toHaveLength(1);
  expect(result.steps[2]?.action_followup).toBe('completed');
  expect(result.steps[4]?.action_followup).toBe('already_delivered');
  expect(result.steps[4]?.action_result).toEqual(result.steps[2]?.action_result);
}, 60_000);
