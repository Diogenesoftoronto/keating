import { describe, expect, test } from 'bun:test';
import { summarizeQuizTimingMs } from '../src/judgement/index.js';

describe('summarizeQuizTimingMs consumes perQuestionMs numerically', () => {
  test('summarizes count, total, mean, and max', () => {
    expect(summarizeQuizTimingMs({ a: 4_000, b: 8_000 })).toEqual({
      answeredCount: 2,
      totalMs: 12_000,
      meanMs: 6_000,
      maxMs: 8_000,
      quickFraction: null,
    });
  });

  test('invalid entries are absent, never zero', () => {
    const summary = summarizeQuizTimingMs({
      ok: 5_000,
      negative: -3,
      nan: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
    });
    expect(summary.answeredCount).toBe(1);
    expect(summary.totalMs).toBe(5_000);
    expect(summary.meanMs).toBe(5_000);
    expect(summary.maxMs).toBe(5_000);
  });

  test('empty or missing timings summarize to zero with no quick fraction', () => {
    expect(summarizeQuizTimingMs({})).toMatchObject({ answeredCount: 0, totalMs: 0, meanMs: 0, maxMs: 0, quickFraction: null });
    expect(summarizeQuizTimingMs(undefined)).toMatchObject({ answeredCount: 0, quickFraction: null });
  });

  test('quick fraction counts answers within a quarter of their budget', () => {
    // 10s of a 60s budget is quick; 20s of a 60s budget is not; c has no budget.
    const summary = summarizeQuizTimingMs(
      { a: 10_000, b: 20_000, c: 1_000 },
      { a: 60, b: 60 },
    );
    expect(summary.quickFraction).toBeCloseTo(0.5, 5);
  });

  test('zero and unknown budgets never count as quick or budgeted', () => {
    expect(summarizeQuizTimingMs({ a: 0 }, { a: 0 }).quickFraction).toBeNull();
    expect(summarizeQuizTimingMs({ a: 100 }, { other: 60 }).quickFraction).toBeNull();
  });
});
