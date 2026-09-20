import { describe, expect, test } from 'bun:test';
import {
  createLocalJudgementCaller,
  createSystemOneCaller,
  decodeAnswer,
  decodeSystemOneResponse,
  distributionConfidence,
  encodeSystemOneRequest,
  errorForStatus,
  type FetchLike,
  type JudgementQuestion,
  type JudgementRequest,
} from '../src/judgement/index.js';

const noul: JudgementQuestion = { type: 'noul', instructions: 'Ready?' };
const choice: JudgementQuestion = { type: 'choice', instructions: 'Which?', criteria: { algebra: null, limits: 'Calculus.' } };
const scored: JudgementQuestion = { type: 'score', instructions: 'Rate.', criteria: ['absent', 'partial', 'solid'] };
const request: JudgementRequest = { state: 'learner work', questions: { r: noul, w: choice, s: scored } };

function jsonFetch(status: number, payload: unknown, calls: unknown[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
}

describe('the wire codec respects the protocol asymmetries', () => {
  test('Choice criteria is a map and Score criteria is an ordered array', () => {
    const body = encodeSystemOneRequest(request);
    const questions = body.questions as Record<string, Record<string, unknown>>;
    expect(questions.w.criteria).toEqual({ algebra: null, limits: 'Calculus.' });
    expect(questions.s.criteria).toEqual(['absent', 'partial', 'solid']);
    expect(body.model).toBe('jev-latest');
  });
  test('an absent Noul rubric is omitted rather than sent empty', () => {
    const body = encodeSystemOneRequest({ state: 's', questions: { r: noul } });
    expect(body.questions.r).toEqual({ type: 'noul', instructions: 'Ready?' });
    const withPoles = encodeSystemOneRequest({
      state: 's',
      questions: { r: { type: 'noul', instructions: 'Ready?', criteria: { true: 'is ready', false: 'not ready' } } },
    });
    expect(withPoles.questions.r).toHaveProperty('criteria');
  });
  test('question keys survive the round trip unchanged', () => {
    const decoded = decodeSystemOneResponse(request, {
      answers: { r: { type: 'noul', noul: 0.8 }, s: { type: 'score', score: 1.5, legend: { '0': 'a' }, probabilities: { '0': 0.5, '1': 0.5 }, confidence: 0.6 } },
    });
    expect(Object.keys(decoded!.answers).sort()).toEqual(['r', 's']);
  });
});

describe('a malformed answer is rejected rather than coerced', () => {
  test('the primitive must match what was asked', () => {
    expect(decodeAnswer(noul, { type: 'score', score: 1, legend: {}, probabilities: { '0': 1 }, confidence: 1 })).toBeNull();
    expect(decodeAnswer(scored, { type: 'noul', noul: 0.5 })).toBeNull();
  });
  test('a Choice naming an option we never declared cannot be resolved', () => {
    expect(decodeAnswer(choice, { type: 'choice', choice: 'geometry', probabilities: { geometry: 1 }, confidence: 0.9 })).toBeNull();
    expect(decodeAnswer(choice, { type: 'choice', choice: 'algebra', probabilities: { algebra: 1 }, confidence: 0.9 })).not.toBeNull();
  });
  test('out-of-range probabilities and missing confidence are malformed', () => {
    expect(decodeAnswer(noul, { type: 'noul', noul: 1.4 })).toBeNull();
    expect(decodeAnswer(noul, { type: 'noul', noul: -0.1 })).toBeNull();
    expect(decodeAnswer(choice, { type: 'choice', choice: 'algebra', probabilities: { algebra: 1 } })).toBeNull();
  });
  test('one bad answer does not discard its well-formed neighbours', () => {
    const decoded = decodeSystemOneResponse(request, {
      answers: { r: { type: 'noul', noul: 0.8 }, w: { type: 'choice', choice: 'nonsense', probabilities: {}, confidence: 2 } },
    });
    expect(Object.keys(decoded!.answers)).toEqual(['r']);
  });
  test('usage is read only when both counters are present', () => {
    const withUsage = decodeSystemOneResponse(request, { answers: {}, usage: { input_tokens: 10, output_tokens: 2 } });
    expect(withUsage!.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(decodeSystemOneResponse(request, { answers: {}, usage: { input_tokens: 10 } })!.usage).toBeUndefined();
    expect(decodeSystemOneResponse(request, { notAnswers: {} })).toBeNull();
  });
});

describe('http statuses map to stable codes without reading the body', () => {
  test('auth and validation failures are terminal, pressure is retryable', () => {
    expect(errorForStatus(401)).toEqual({ code: 'backend-unauthorized', retryable: false });
    expect(errorForStatus(422)).toEqual({ code: 'request-invalid', retryable: false });
    expect(errorForStatus(429)).toEqual({ code: 'backend-rate-limited', retryable: true });
    expect(errorForStatus(529)).toEqual({ code: 'backend-overloaded', retryable: true });
    expect(errorForStatus(500)).toEqual({ code: 'backend-unavailable', retryable: true });
  });
});

describe('the hosted caller returns failures instead of throwing', () => {
  const sleep = async () => {};
  test('gateway alias is distinct from the concrete response identity', async () => {
    const calls: any[] = [];
    const call = createSystemOneCaller({
      fetch: jsonFetch(200, { model: 'jev-1.13', answers: { r: { type: 'noul', noul: 0.9 } } }, calls),
      model: 'jev-1.13', requestModel: 'judgement', requireResolvedModel: true,
      calibrationSha256: 'f'.repeat(64), sleep,
    });
    const result = await call({ state: 's', questions: { r: noul } });
    expect(JSON.parse(calls[0].init.body).model).toBe('judgement');
    expect(result).toMatchObject({ ok: true, response: { backend: {
      model: 'jev-1.13', calibrationSha256: 'f'.repeat(64),
    } } });
  });
  test('a changed upstream model cannot inherit the requested model calibration', async () => {
    const call = createSystemOneCaller({
      fetch: jsonFetch(200, { model: 'jev-2.0', answers: {} }),
      model: 'jev-1.13', calibrationSha256: 'f'.repeat(64), sleep,
    });
    expect(await call({ state: 's', questions: { r: noul } })).toMatchObject({
      ok: true, response: { backend: { model: 'jev-2.0', calibrationSha256: null } },
    });
  });
  test('strict provenance refuses a missing or unresolved model identity', async () => {
    for (const model of [undefined, '', 'judgement', 'jev-latest']) {
      const call = createSystemOneCaller({
        fetch: jsonFetch(200, { model, answers: {} }), requireResolvedModel: true, sleep,
      });
      expect(await call({ state: 's', questions: { r: noul } })).toEqual({
        ok: false, error: { code: 'response-malformed', retryable: false },
      });
    }
  });
  test('a successful call carries its backend identity and usage', async () => {
    const call = createSystemOneCaller({
      fetch: jsonFetch(200, { answers: { r: { type: 'noul', noul: 0.91 } }, usage: { input_tokens: 40, output_tokens: 3 } }),
      apiKey: 'secret', sleep, calibrationSha256: 'f'.repeat(64),
    });
    const outcome = await call({ state: 's', questions: { r: noul } });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.response.answers.r).toEqual({ type: 'noul', noul: 0.91 });
    expect(outcome.response.backend).toEqual({ backend: 'system-one', model: 'jev-latest', calibrationSha256: 'f'.repeat(64) });
    expect(outcome.response.usage).toEqual({ inputTokens: 40, outputTokens: 3 });
  });
  test('the credential travels as a bearer header and nowhere else', async () => {
    const calls: any[] = [];
    const call = createSystemOneCaller({ fetch: jsonFetch(200, { answers: {} }, calls), apiKey: 'secret', sleep });
    await call({ state: 's', questions: { r: noul } });
    expect(calls[0].init.headers.authorization).toBe('Bearer secret');
    expect(calls[0].init.body).not.toContain('secret');
  });
  test('a gateway deployment sends no credential at all', async () => {
    const calls: any[] = [];
    const call = createSystemOneCaller({ fetch: jsonFetch(200, { answers: {} }, calls), endpoint: 'https://gateway.example/v1/judgement', sleep });
    await call({ state: 's', questions: { r: noul } });
    expect(calls[0].init.headers).not.toHaveProperty('authorization');
    expect(calls[0].url).toBe('https://gateway.example/v1/judgement');
  });
  test('a terminal status is not retried', async () => {
    const calls: any[] = [];
    const call = createSystemOneCaller({ fetch: jsonFetch(401, {}, calls), apiKey: 'k', sleep });
    const outcome = await call({ state: 's', questions: { r: noul } });
    expect(outcome).toEqual({ ok: false, error: { code: 'backend-unauthorized', retryable: false } });
    expect(calls).toHaveLength(1);
  });
  test('a retryable status is retried up to the cap then reported', async () => {
    const calls: any[] = [];
    const call = createSystemOneCaller({ fetch: jsonFetch(429, {}, calls), apiKey: 'k', sleep, retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 } });
    const outcome = await call({ state: 's', questions: { r: noul } });
    expect(outcome).toEqual({ ok: false, error: { code: 'backend-rate-limited', retryable: true } });
    expect(calls).toHaveLength(3);
  });
  test('a thrown network error becomes a returned code, never an exception', async () => {
    const call = createSystemOneCaller({
      fetch: async () => { throw new Error('ECONNREFUSED 10.0.0.1 with secret body'); },
      apiKey: 'k', sleep, retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
    });
    const outcome = await call({ state: 's', questions: { r: noul } });
    expect(outcome).toEqual({ ok: false, error: { code: 'backend-unavailable', retryable: true } });
  });
  test('an oversized batch is refused before any request is made', async () => {
    const calls: any[] = [];
    const call = createSystemOneCaller({ fetch: jsonFetch(200, { answers: {} }, calls), apiKey: 'k', sleep });
    const outcome = await call({ state: 'x'.repeat(96_001), questions: { r: noul } });
    expect(outcome).toEqual({ ok: false, error: { code: 'request-invalid', retryable: false } });
    expect(calls).toHaveLength(0);
  });
  test('an already-aborted signal short-circuits', async () => {
    const controller = new AbortController();
    controller.abort();
    const calls: any[] = [];
    const call = createSystemOneCaller({ fetch: jsonFetch(200, { answers: {} }, calls), apiKey: 'k', sleep });
    expect(await call({ state: 's', questions: { r: noul } }, controller.signal))
      .toEqual({ ok: false, error: { code: 'cancelled', retryable: false } });
    expect(calls).toHaveLength(0);
  });
  test('unparseable json is malformed, not retried forever', async () => {
    const call = createSystemOneCaller({
      fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
      apiKey: 'k', sleep,
    });
    expect(await call({ state: 's', questions: { r: noul } }))
      .toEqual({ ok: false, error: { code: 'response-malformed', retryable: false } });
  });
});

describe('the offline backend answers in the same shape', () => {
  const local = (scores: Record<string, readonly number[] | null>) => createLocalJudgementCaller({
    model: 'MiniCPM5-2B',
    scoreLabels: async ({ instructions }) => scores[instructions] ?? null,
  });

  test('a Noul reports P(yes) from the yes pole', async () => {
    const outcome = await local({ 'Ready?': [1, 3] })({ state: 's', questions: { r: noul } });
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.response.answers.r).toEqual({ type: 'noul', noul: 0.75 });
  });
  test('opaque Choice identifiers retain their distinct option descriptions', async () => {
    const call = createLocalJudgementCaller({
      model: 'rubric-aware-fixture',
      scoreLabels: async ({ state, question, instructions, labels }) => {
        expect(instructions).toBe('Select the matching evidence.');
        expect(labels).toEqual(['candidate_0', 'candidate_1']);
        if (question.type !== 'choice') throw new Error('expected Choice rubric');
        return labels.map((label) => question.criteria[label] === state ? 1 : 0);
      },
    });
    const outcome = await call({ state: 'solved independently', questions: {
      first: { type: 'choice', instructions: 'Select the matching evidence.', criteria: { candidate_0: 'solved independently', candidate_1: 'needed help' } },
      second: { type: 'choice', instructions: 'Select the matching evidence.', criteria: { candidate_0: 'needed help', candidate_1: 'solved independently' } },
    } });
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.response.answers.first).toMatchObject({ type: 'choice', choice: 'candidate_0' });
    expect(outcome.response.answers.second).toMatchObject({ type: 'choice', choice: 'candidate_1' });
  });
  test('identical Score indices retain the definitions of their ordered levels', async () => {
    const call = createLocalJudgementCaller({
      model: 'rubric-aware-fixture',
      scoreLabels: async ({ state, question, labels }) => {
        expect(labels).toEqual(['0', '1']);
        if (question.type !== 'score') throw new Error('expected Score rubric');
        return question.criteria.map((description) => description === state ? 1 : 0);
      },
    });
    const outcome = await call({ state: 'partial evidence', questions: {
      permissive: { type: 'score', instructions: 'Rate the evidence.', criteria: ['no evidence', 'partial evidence'] },
      demanding: { type: 'score', instructions: 'Rate the evidence.', criteria: ['partial evidence', 'complete evidence'] },
    } });
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.response.answers.permissive).toMatchObject({ type: 'score', score: 1 });
    expect(outcome.response.answers.demanding).toMatchObject({ type: 'score', score: 0 });
  });
  test('Noul no/yes labels retain their false/true pole definitions', async () => {
    const call = createLocalJudgementCaller({
      model: 'rubric-aware-fixture',
      calibrationSha256: 'a'.repeat(64),
      scoreLabels: async ({ state, question, labels }) => {
        expect(labels).toEqual(['no', 'yes']);
        if (question.type !== 'noul' || !question.criteria) throw new Error('expected Noul poles');
        return [question.criteria.false, question.criteria.true].map((pole) => pole === state ? 1 : 0);
      },
    });
    const outcome = await call({ state: 'one independent solution', questions: {
      practice: { type: 'noul', instructions: 'Enough evidence?', criteria: { false: 'no independent solutions', true: 'one independent solution' } },
      mastery: { type: 'noul', instructions: 'Enough evidence?', criteria: { false: 'one independent solution', true: 'several independent solutions' } },
    } });
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.response.answers.practice).toEqual({ type: 'noul', noul: 1 });
    expect(outcome.response.answers.mastery).toEqual({ type: 'noul', noul: 0 });
    expect(outcome.response.backend).toEqual({ backend: 'local', model: 'rubric-aware-fixture', calibrationSha256: 'a'.repeat(64) });
  });
  test('a Choice picks the heaviest declared option and normalizes the rest', async () => {
    const outcome = await local({ 'Which?': [1, 4] })({ state: 's', questions: { w: choice } });
    if (!outcome.ok) throw new Error('expected success');
    const answer = outcome.response.answers.w;
    expect(answer).toMatchObject({ type: 'choice', choice: 'limits' });
    if (answer.type !== 'choice') throw new Error('expected choice');
    expect(answer.probabilities).toEqual({ algebra: 0.2, limits: 0.8 });
    expect(Object.values(answer.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  test('a Score builds its own legend and weighted value from the levels asked', async () => {
    const outcome = await local({ 'Rate.': [0, 0, 1] })({ state: 's', questions: { s: scored } });
    if (!outcome.ok) throw new Error('expected success');
    const answer = outcome.response.answers.s;
    if (answer.type !== 'score') throw new Error('expected score');
    expect(answer.score).toBeCloseTo(2, 10);
    expect(answer.legend).toEqual({ '0': 'absent', '1': 'partial', '2': 'solid' });
    expect(answer.confidence).toBe(1);
  });
  test('a scorer that cannot answer omits the key instead of guessing', async () => {
    const outcome = await local({})({ state: 's', questions: { r: noul, s: scored } });
    if (!outcome.ok) throw new Error('expected success');
    expect(Object.keys(outcome.response.answers)).toEqual([]);
  });
  test('cancellation during the final question rejects late scores, abstention and failure without cancelling another call', async () => {
    for (const settlement of ['weights', 'null', 'error'] as const) {
      const controller = new AbortController();
      let started!: () => void;
      const waiting = new Promise<void>(resolve => { started = resolve; });
      let settle!: () => void;
      const finalScores = new Promise<readonly number[] | null>((resolve, reject) => {
        settle = () => settlement === 'error' ? reject(new Error('cancelled runtime'))
          : resolve(settlement === 'null' ? null : [0, 1]);
      });
      const call = createLocalJudgementCaller({
        model: 'cancellation-fixture',
        scoreLabels: async ({ state, instructions }) => {
          if (state === 'cancelled batch' && instructions === 'Final?') {
            started();
            return finalScores;
          }
          return [0, 1];
        },
      });
      const pending = call({ state: 'cancelled batch', questions: {
        first: noul, final: { type: 'noul', instructions: 'Final?' },
      } }, controller.signal);
      await waiting;
      controller.abort();
      const unrelated = await call({ state: 'independent batch', questions: { r: noul } });
      expect(unrelated.ok).toBe(true);
      if (unrelated.ok) expect(unrelated.response.answers.r).toEqual({ type: 'noul', noul: 1 });
      settle();
      expect(await pending).toEqual({ ok: false, error: { code: 'cancelled', retryable: false } });
    }
  });
  test('degenerate weights are dropped rather than becoming a uniform answer', async () => {
    for (const weights of [[0, 0], [1], [-1, 2], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1]]) {
      const outcome = await local({ 'Ready?': weights })({ state: 's', questions: { r: noul } });
      if (!outcome.ok) throw new Error('expected success');
      expect(outcome.response.answers).toEqual({});
    }
  });
  test('finite weights normalize even when their unscaled sum overflows', async () => {
    const outcome = await local({ 'Which?': [Number.MAX_VALUE, Number.MAX_VALUE / 2] })({ state: 's', questions: { w: choice } });
    if (!outcome.ok) throw new Error('expected success');
    const answer = outcome.response.answers.w;
    if (answer.type !== 'choice') throw new Error('expected Choice');
    expect(answer.choice).toBe('algebra');
    expect(answer.probabilities.algebra).toBeCloseTo(2 / 3, 10);
    expect(answer.probabilities.limits).toBeCloseTo(1 / 3, 10);
    expect(Object.values(answer.probabilities).reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 10);
    expect(Number.isFinite(answer.confidence)).toBe(true);
  });
  test('a scorer that throws on one question keeps the others', async () => {
    const call = createLocalJudgementCaller({
      model: 'MiniCPM5-2B',
      scoreLabels: async ({ instructions }) => {
        if (instructions === 'Ready?') throw new Error('runtime out of memory');
        return [0, 0, 1];
      },
    });
    const outcome = await call({ state: 's', questions: { r: noul, s: scored } });
    if (!outcome.ok) throw new Error('expected success');
    expect(Object.keys(outcome.response.answers)).toEqual(['s']);
  });
  test('confidence reads as concentration, not correctness', () => {
    expect(distributionConfidence([1, 0, 0])).toBe(1);
    expect(distributionConfidence([1 / 3, 1 / 3, 1 / 3])).toBeCloseTo(0, 10);
    expect(distributionConfidence([0.5, 0.5])).toBeCloseTo(0, 10);
    expect(distributionConfidence([0.9, 0.1])).toBeGreaterThan(0.5);
  });
  test('the offline backend declares itself local so thresholds cannot be shared', async () => {
    const outcome = await local({ 'Ready?': [1, 1] })({ state: 's', questions: { r: noul } });
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.response.backend).toEqual({ backend: 'local', model: 'MiniCPM5-2B', calibrationSha256: null });
  });
});
