import { describe, expect, test } from 'bun:test';
import {
  decided,
  abstained,
  questionDigest,
  routeJudgement,
  routeJudgements,
  thresholdKey,
  type CalibrationTable,
  type JudgementBackendKey,
  type JudgementCaller,
  type JudgementQuestion,
  type JudgementTier,
  type RoutedQuestion,
  type VerdictReader,
} from '../src/judgement/index.js';

const onDevice: JudgementBackendKey = { backend: 'local', model: 'MiniCPM5-2B', calibrationSha256: 'a'.repeat(64) };
const hosted: JudgementBackendKey = { backend: 'system-one', model: 'jev-1.13', calibrationSha256: 'b'.repeat(64) };

const ask = (topic: string): JudgementQuestion =>
  ({ type: 'noul', instructions: `Is the learner ready for ${topic}?` });

/** Decides when the answer is emphatic, abstains when it is not — the shape every reader has. */
const readNoul: VerdictReader<boolean> = (answer, thresholds, provenance) => {
  if (answer.type !== 'noul') return abstained('backend-error', provenance);
  if (answer.noul >= thresholds.actAtOrAbove) return decided(true, null, provenance);
  if (answer.noul <= 1 - thresholds.actAtOrAbove) return decided(false, null, provenance);
  return abstained('below-confidence-floor', provenance);
};

const routed = (key: string, topic: string, baseline = false): RoutedQuestion<boolean> =>
  ({ key, question: ask(topic), baseline, read: readNoul });

function calibrationFor(backends: readonly JudgementBackendKey[], questions: readonly JudgementQuestion[]): CalibrationTable {
  const entries: Record<string, { deferBelow: number; actAtOrAbove: number }> = {};
  for (const backend of backends) {
    for (const question of questions) {
      entries[thresholdKey(backend, questionDigest(question))] = { deferBelow: 0.5, actAtOrAbove: 0.9 };
    }
  }
  return { entries };
}

/** Records what each tier was actually asked, which is where the cost story lives. */
function spyTier(key: JudgementBackendKey, answers: Record<string, number>, options: {
  isAvailable?: () => boolean;
  fail?: boolean;
} = {}): JudgementTier & { asked: string[][] } {
  const asked: string[][] = [];
  const call: JudgementCaller = async (request) => {
    asked.push(Object.keys(request.questions));
    if (options.fail) return { ok: false, error: { code: 'backend-overloaded', retryable: true } };
    return {
      ok: true,
      response: {
        backend: key,
        answers: Object.fromEntries(Object.keys(request.questions)
          .filter((questionKey) => questionKey in answers)
          .map((questionKey) => [questionKey, { type: 'noul' as const, noul: answers[questionKey] }])),
      },
    };
  };
  return { key, call, isAvailable: options.isAvailable, asked };
}

describe('the ladder stops at the cheapest tier that can answer', () => {
  test('a confident on-device answer never reaches the hosted tier', async () => {
    const cheap = spyTier(onDevice, { algebra: 0.97 });
    const expensive = spyTier(hosted, { algebra: 0.97 });
    const result = await routeJudgement('learner work', routed('algebra', 'algebra'), {
      tiers: [cheap, expensive],
      calibration: calibrationFor([onDevice, hosted], [ask('algebra')]),
    });
    expect(result.verdict.status).toBe('decided');
    expect(result.value).toBe(true);
    expect(cheap.asked).toEqual([['algebra']]);
    expect(expensive.asked).toEqual([]);
  });
  test('an on-device abstention escalates and the hosted answer wins', async () => {
    const cheap = spyTier(onDevice, { algebra: 0.55 });
    const expensive = spyTier(hosted, { algebra: 0.98 });
    const result = await routeJudgement('learner work', routed('algebra', 'algebra'), {
      tiers: [cheap, expensive],
      calibration: calibrationFor([onDevice, hosted], [ask('algebra')]),
    });
    expect(result.value).toBe(true);
    expect(expensive.asked).toEqual([['algebra']]);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['abstained', 'decided']);
  });
  test('only the residue escalates, so the expensive tier is asked once about what is left', async () => {
    const questions = [routed('a', 'sums'), routed('b', 'fractions'), routed('c', 'limits')];
    const cheap = spyTier(onDevice, { a: 0.99, b: 0.5, c: 0.5 });
    const expensive = spyTier(hosted, { b: 0.95, c: 0.02 });
    const result = await routeJudgements('learner work', questions, {
      tiers: [cheap, expensive],
      calibration: calibrationFor([onDevice, hosted], [ask('sums'), ask('fractions'), ask('limits')]),
    });
    expect(cheap.asked).toEqual([['a', 'b', 'c']]);
    expect(expensive.asked).toEqual([['b', 'c']]);
    expect([result.a.value, result.b.value, result.c.value]).toEqual([true, true, false]);
  });
});

describe('a tier is skipped rather than trusted beyond its calibration', () => {
  test('an uncalibrated tier is passed over and the calibrated one answers', async () => {
    const cheap = spyTier(onDevice, { algebra: 0.99 });
    const expensive = spyTier(hosted, { algebra: 0.99 });
    const result = await routeJudgement('learner work', routed('algebra', 'algebra'), {
      tiers: [cheap, expensive],
      calibration: calibrationFor([hosted], [ask('algebra')]),
    });
    expect(cheap.asked).toEqual([]);
    expect(expensive.asked).toEqual([['algebra']]);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['skipped-uncalibrated', 'decided']);
  });
  test('a tier switched off in settings is skipped without being called', async () => {
    const cheap = spyTier(onDevice, { algebra: 0.99 }, { isAvailable: () => false });
    const expensive = spyTier(hosted, { algebra: 0.99 });
    await routeJudgement('learner work', routed('algebra', 'algebra'), {
      tiers: [cheap, expensive],
      calibration: calibrationFor([onDevice, hosted], [ask('algebra')]),
    });
    expect(cheap.asked).toEqual([]);
    expect(expensive.asked).toEqual([['algebra']]);
  });
});

describe('a pinned backend refuses to fall back', () => {
  for (const actual of [
    { ...hosted, backend: 'local' as const },
    { ...hosted, model: 'another-model' },
    { ...hosted, calibrationSha256: 'c'.repeat(64) },
  ]) {
    test(`a response identity mismatch abstains: ${JSON.stringify(actual)}`, async () => {
      const fallback = spyTier(onDevice, { algebra: 0.99 });
      const mismatched = { ...spyTier(actual, { algebra: 0.99 }), key: hosted };
      const result = await routeJudgement('learner work', routed('algebra', 'algebra'), {
        tiers: [mismatched, fallback],
        calibration: calibrationFor([hosted, onDevice], [ask('algebra')]),
        pinnedBackend: hosted,
      });
      expect(result.value).toBe(false);
      expect(result.verdict).toMatchObject({ status: 'abstained', reason: 'backend-error' });
      expect(result.attempts[0]?.detail).toBe('backend-identity-mismatch');
      expect(fallback.asked).toEqual([]);
    });
  }
  test('an experiment stays on its judge even when a cheaper tier is available', async () => {
    const cheap = spyTier(onDevice, { algebra: 0.99 });
    const expensive = spyTier(hosted, { algebra: 0.99 });
    await routeJudgement('learner work', routed('algebra', 'algebra'), {
      tiers: [cheap, expensive],
      calibration: calibrationFor([onDevice, hosted], [ask('algebra')]),
      pinnedBackend: hosted,
    });
    expect(cheap.asked).toEqual([]);
    expect(expensive.asked).toEqual([['algebra']]);
  });
  test('a pinned backend that fails abstains rather than quietly using another judge', async () => {
    const cheap = spyTier(onDevice, { algebra: 0.99 });
    const broken = spyTier(hosted, {}, { fail: true });
    const result = await routeJudgement('learner work', routed('algebra', 'algebra'), {
      tiers: [cheap, broken],
      calibration: calibrationFor([onDevice, hosted], [ask('algebra')]),
      pinnedBackend: hosted,
    });
    expect(cheap.asked).toEqual([]);
    expect(result.verdict).toMatchObject({ status: 'abstained', reason: 'backend-error' });
  });
});

describe('an exhausted ladder returns the baseline, never a low score', () => {
  test('a throwing transport returns a stable error without exposing its body', async () => {
    const result = await routeJudgement('learner work', routed('algebra', 'algebra', true), {
      tiers: [{ key: hosted, call: async () => { throw new Error('private learner work'); } }],
      calibration: calibrationFor([hosted], [ask('algebra')]),
    });
    expect(result.value).toBe(true);
    expect(result.verdict.status).toBe('abstained');
    expect(result.attempts[0]?.detail).toBe('backend-unavailable');
    expect(JSON.stringify(result)).not.toContain('private learner work');
  });
  test('a backend error keeps the deterministic answer intact', async () => {
    const broken = spyTier(hosted, {}, { fail: true });
    const result = await routeJudgement('learner work', routed('algebra', 'algebra', true), {
      tiers: [broken],
      calibration: calibrationFor([hosted], [ask('algebra')]),
    });
    expect(result.value).toBe(true);
    expect(result.verdict).toMatchObject({ status: 'abstained', reason: 'backend-error' });
    expect(result.attempts).toEqual([{ backend: hosted, outcome: 'error', detail: 'backend-overloaded' }]);
  });
  test('a missing answer for one key does not disturb its neighbours', async () => {
    const partial = spyTier(hosted, { a: 0.99 });
    const result = await routeJudgements('learner work', [routed('a', 'sums'), routed('b', 'fractions', true)], {
      tiers: [partial],
      calibration: calibrationFor([hosted], [ask('sums'), ask('fractions')]),
    });
    expect(result.a).toMatchObject({ value: true, verdict: { status: 'decided' } });
    expect(result.b).toMatchObject({ value: true, verdict: { status: 'abstained', reason: 'backend-error' } });
  });
  test('no calibration anywhere abstains on that ground and asks nobody', async () => {
    const cheap = spyTier(onDevice, { algebra: 0.99 });
    const result = await routeJudgement('learner work', routed('algebra', 'algebra'), {
      tiers: [cheap],
      calibration: { entries: {} },
    });
    expect(cheap.asked).toEqual([]);
    expect(result.verdict).toMatchObject({ status: 'abstained', reason: 'no-calibration' });
    expect(result.value).toBe(false);
  });
  test('every routed question comes back, decided or not', async () => {
    const cheap = spyTier(onDevice, { a: 0.99 });
    const result = await routeJudgements('learner work', [routed('a', 'sums'), routed('b', 'fractions')], {
      tiers: [cheap],
      calibration: calibrationFor([onDevice], [ask('sums')]),
    });
    expect(Object.keys(result).sort()).toEqual(['a', 'b']);
    expect(result.b.verdict.provenance.source).toBe('proxy');
  });
});
