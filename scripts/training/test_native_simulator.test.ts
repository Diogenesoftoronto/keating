import { test, expect, afterEach } from 'bun:test';
import { JsonChatLearner, learnerMessages, type JsonLearnerConfig } from './native_simulator.js';
import type { LearnerObservation } from './native_learner.js';

const keyName = 'KEATING_SIMULATOR_FIXTURE_KEY';
afterEach(() => { delete process.env[keyName]; });
const config = () => ({ endpoint: 'https://fixture.invalid/chat/completions', api_key_env: keyName,
  model: 'authored-fixture', revision: 'test-v1', max_tokens: 100 });
const observation: LearnerObservation = { schema_version: 1, observationHash: 'fixture',
  step: 0, visibleText: 'Which step is unclear?', documents: [], availableActions: [] };
const context = { initial_material: 'Shared task: add 1/3 and 1/4. I tried 2/7.', profile_evidence: [], assumptions: [], history: [] };

test('invalid JSON remains invalid learner output for the bounded controller repair', async () => {
  process.env[keyName] = 'test-only';
  const learner = new JsonChatLearner(config(), (async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'not valid JSON' } }],
  }))) as typeof fetch);
  expect(await learner.next(observation, context, new AbortController().signal)).toBe('not valid JSON');
});

test('valid output passes through and request configuration cannot be changed after validation', async () => {
  process.env[keyName] = 'test-only';
  const original = config();
  let requested = '', body: any;
  const learner = new JsonChatLearner(original, (async (url, init) => {
    requested = String(url); body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"stop"}' } }] }));
  }) as typeof fetch);
  original.endpoint = 'https://different.invalid/';
  expect(await learner.next(observation, context, new AbortController().signal)).toEqual({ kind: 'stop' });
  expect(requested).toBe('https://fixture.invalid/chat/completions');
  expect(body.max_tokens).toBe(100);
  expect(JSON.parse(body.messages[1].content)).toEqual({ observation, context: {
    initial_material: context.initial_material, profile_evidence: [], assumptions: [] } });
});

test('oversized output records a bounded invalid-output diagnostic', async () => {
  process.env[keyName] = 'test-only';
  const learner = new JsonChatLearner(config(), (async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'x'.repeat(65537) } }],
  }))) as typeof fetch);
  expect(await learner.next(observation, context, new AbortController().signal)).toEqual({
    invalid_output: 'oversized_text_content', characters: 65537,
  });
});

test('HTTP failures expose a status but never provider error bodies', async () => {
  process.env[keyName] = 'test-only';
  const learner = new JsonChatLearner(config(), (async () => new Response('private provider error details', { status: 429 })) as typeof fetch);
  await expect(learner.next(observation, context, new AbortController().signal)).rejects.toThrow('native_simulator_http_429');
});

test('credentials and bounds fail before any request', async () => {
  let calls = 0;
  const learner = new JsonChatLearner(config(), (async () => { calls++; return new Response(); }) as typeof fetch);
  await expect(learner.next(observation, context, new AbortController().signal)).rejects.toThrow('native_missing_simulator_key');
  expect(calls).toBe(0);
  expect(() => new JsonChatLearner({ ...config(), max_tokens: 0 })).toThrow('native_invalid_simulator_config');
  expect(() => new JsonChatLearner({ ...config(), endpoint: 'https://fixture.invalid/?api_key=unwanted' })).toThrow('native_invalid_simulator_config');
});

test('missing initial task fails before provider dispatch and prompt changes are identifiable', async () => {
  process.env[keyName] = 'test-only';
  let calls = 0;
  const learner = new JsonChatLearner(config(), (async () => { calls++; return new Response(); }) as typeof fetch);
  await expect(learner.next(observation, { ...context, initial_material: '' }, new AbortController().signal))
    .rejects.toThrow('native_missing_learner_initial_material');
  expect(calls).toBe(0);
  expect(learner.provenance.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(learner.provenance.request_contract_sha256).not.toBe(new JsonChatLearner({ ...config(), max_tokens: 101 }).provenance.request_contract_sha256);
});

test('prompt-only JSON omits only response_format and preserves exact evidence and sampler settings', async () => {
  process.env[keyName] = 'test-only';
  const bodies: Array<Record<string, any>> = [];
  const request = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"stop"}' } }] }));
  }) as typeof fetch;
  const base: JsonLearnerConfig = { ...config(), model: 'Qwen/Qwen3.5-9B-Base', temperature: 1, max_tokens: 2048 };
  for (const mode of [undefined, 'response_format', 'prompt_only'] as const) {
    const learner = new JsonChatLearner({ ...base, json_mode: mode }, request);
    expect(await learner.next(observation, context, new AbortController().signal)).toEqual({ kind: 'stop' });
  }
  const [defaultBody, explicitBody, promptBody] = bodies;
  expect(defaultBody).toEqual(explicitBody);
  expect(defaultBody!.response_format).toEqual({ type: 'json_object' });
  const { response_format: _format, ...unconstrainedBody } = defaultBody!;
  expect(promptBody).toEqual(unconstrainedBody);
  expect(Object.keys(promptBody!).sort()).toEqual(['max_tokens', 'messages', 'model', 'temperature']);
  expect(promptBody!.model).toBe('Qwen/Qwen3.5-9B-Base');
  expect(promptBody!.temperature).toBe(1);
  expect(promptBody!.max_tokens).toBe(2048);
  expect(promptBody!.messages[0].content).toContain('Return one JSON object:');
  expect(JSON.parse(promptBody!.messages[1].content)).toEqual({ observation, context: {
    initial_material: context.initial_material, profile_evidence: [], assumptions: [] } });
});

test('multi-turn learner requests retain speaker roles, exact observations and repair boundary', () => {
  const priorIntent = { kind: 'message' as const, text: 'I still think the pieces have different sizes.' };
  const current = { ...observation, step: 1, visibleText: 'Can you compare thirds and fourths?' };
  const history = [{ observation, intent: priorIntent }];
  const messages = learnerMessages(current, { ...context, history, repair: 'Invalid JSON' });
  expect(messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(JSON.parse(messages[1]!.content).observation).toEqual(observation);
  expect(JSON.parse(messages[1]!.content).context.initial_material).toBe(context.initial_material);
  expect(JSON.parse(messages[2]!.content)).toEqual(priorIntent);
  expect(JSON.parse(messages[3]!.content).observation).toEqual(current);
  expect(JSON.parse(messages[3]!.content).repair.instruction).toContain('still the learner');
  expect(JSON.stringify(messages).match(/Shared task:/g)).toHaveLength(1);
  expect(history).toEqual([{ observation, intent: priorIntent }]);
});

test('prompt-only mode retains malformed output verbatim for controller repair', async () => {
  process.env[keyName] = 'test-only';
  const raw = '```json\n{"kind":"message", "text":\n```';
  const original: JsonLearnerConfig = { ...config(), json_mode: 'prompt_only' };
  let body: any;
  const learner = new JsonChatLearner(original, (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: raw } }] }));
  }) as typeof fetch);
  original.json_mode = 'response_format';
  expect(await learner.next(observation, context, new AbortController().signal)).toBe(raw);
  expect(Object.hasOwn(body, 'response_format')).toBe(false);
});

test('prompt-only mode preserves bounded invalid-output diagnostics', async () => {
  process.env[keyName] = 'test-only';
  for (const [content, expected] of [
    [null, { invalid_output: 'missing_text_content' }],
    ['x'.repeat(65537), { invalid_output: 'oversized_text_content', characters: 65537 }],
  ] as const) {
    const learner = new JsonChatLearner({ ...config(), json_mode: 'prompt_only' }, (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }))) as typeof fetch);
    expect(await learner.next(observation, context, new AbortController().signal)).toEqual(expected);
  }
});

test('unknown JSON modes fail config validation before any request', () => {
  let calls = 0;
  const request = (async () => { calls++; return new Response(); }) as typeof fetch;
  for (const mode of ['auto', '', null, false]) {
    expect(() => new JsonChatLearner({ ...config(), json_mode: mode } as unknown as JsonLearnerConfig, request))
      .toThrow('native_invalid_simulator_config');
  }
  expect(calls).toBe(0);
});
