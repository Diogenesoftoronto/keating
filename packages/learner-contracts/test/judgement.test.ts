import { describe, expect, test } from 'bun:test';
import {
  abstained,
  candidateSelection,
  choiceMargin,
  compositeScore,
  confidenceBand,
  confidenceOf,
  isBimodal,
  judgementProvenance,
  judgementRequestProblem,
  modalLevel,
  noulDecision,
  normalizedScore,
  questionDigest,
  resolveSelection,
  resolveThresholds,
  scoreVerdict,
  validateClassifierManifest,
  type CalibrationTable,
  type ChoiceAnswer,
  type JudgementBackendKey,
  type JudgementRequest,
  type ScoreAnswer,
} from '../src/judgement/index.js';

const jev: JudgementBackendKey = { backend: 'system-one', model: 'jev-1.13', calibrationSha256: 'a'.repeat(64) };
const local: JudgementBackendKey = { backend: 'local', model: 'MiniCPM5-2B', calibrationSha256: 'b'.repeat(64) };
const uncalibrated: JudgementBackendKey = { backend: 'local', model: 'MiniCPM5-2B', calibrationSha256: null };

const legend = { '0': 'absent', '1': 'weak', '2': 'partial', '3': 'solid', '4': 'expert' };
const score = (probabilities: Record<string, number>, confidence = 0.95): ScoreAnswer => ({
  type: 'score',
  score: Object.entries(probabilities).reduce((total, [level, p]) => total + Number(level) * p, 0),
  legend,
  probabilities,
  confidence,
});
const choice = (choice: string, probabilities: Record<string, number>, confidence = 0.9): ChoiceAnswer =>
  ({ type: 'choice', choice, probabilities, confidence });

describe('primitives report uncertainty honestly', () => {
  test('a Noul carries no confidence and none is invented for it', () => {
    expect(confidenceOf({ type: 'noul', noul: 0.92 })).toBeNull();
    expect(confidenceOf(score({ '0': 0.1, '1': 0.9 }, 0.77))).toBe(0.77);
  });
  test('a Noul near 0.5 is a refusal to commit, not a half-strength yes', () => {
    const band = { yesAtOrAbove: 0.8, noAtOrBelow: 0.2 };
    expect(noulDecision({ type: 'noul', noul: 0.51 }, band)).toBe('uncertain');
    expect(noulDecision({ type: 'noul', noul: 0.85 }, band)).toBe('yes');
    expect(noulDecision({ type: 'noul', noul: 0.05 }, band)).toBe('no');
  });
  test('a missing confidence defers rather than acting', () => {
    expect(confidenceBand(null)).toBe('defer');
    expect(confidenceBand(0.95)).toBe('act');
    expect(confidenceBand(0.7)).toBe('review');
    expect(confidenceBand(0.3)).toBe('defer');
  });
});

describe('a weighted mean is never trusted as a magnitude', () => {
  const split = score({ '0': 0.45, '1': 0.03, '2': 0.04, '3': 0.03, '4': 0.45 });
  test('detects the trough case where the mean names a level nobody chose', () => {
    expect(split.score).toBeCloseTo(2, 10);
    expect(normalizedScore(split)).toBeCloseTo(0.5, 10);
    expect(split.probabilities['2']).toBe(0.04);
    expect(isBimodal(split)).toBe(true);
    expect(modalLevel(split)).toBe(0);
  });
  test('a concentrated distribution is not bimodal', () => {
    expect(isBimodal(score({ '0': 0.02, '1': 0.03, '2': 0.05, '3': 0.8, '4': 0.1 }))).toBe(false);
    expect(modalLevel(score({ '0': 0.02, '1': 0.03, '2': 0.05, '3': 0.8, '4': 0.1 }))).toBe(3);
  });
  test('adjacent peaks are ordinary disagreement, not bimodality', () => {
    expect(isBimodal(score({ '0': 0.05, '1': 0.05, '2': 0.42, '3': 0.43, '4': 0.05 }))).toBe(false);
  });
  test('level order is read from the keys, not from insertion order', () => {
    const shuffled = score({ '4': 0.6, '0': 0.1, '2': 0.1, '1': 0.1, '3': 0.1 });
    expect(modalLevel(shuffled)).toBe(4);
  });
});

describe('calibration never leaks across backends', () => {
  const digest = questionDigest({ type: 'score', instructions: 'Rate scaffolding.', criteria: ['none', 'some', 'clear'] });
  const table: CalibrationTable = {
    entries: { [`system-one\u0000jev-1.13\u0000${'a'.repeat(64)}\u0000${digest}`]: { deferBelow: 0.4, actAtOrAbove: 0.8 } },
  };
  test('a calibrated backend resolves its own fitted thresholds', () => {
    expect(resolveThresholds(table, jev, digest)).toEqual({ deferBelow: 0.4, actAtOrAbove: 0.8 });
  });
  test('another backend gets null instead of borrowing those numbers', () => {
    expect(resolveThresholds(table, local, digest)).toBeNull();
  });
  test('an uncalibrated backend has nothing to resolve', () => {
    expect(resolveThresholds(table, uncalibrated, digest)).toBeNull();
  });
  test('editing the question invalidates the calibration filed against it', () => {
    const edited = questionDigest({ type: 'score', instructions: 'Rate scaffolding harshly.', criteria: ['none', 'some', 'clear'] });
    expect(edited).not.toBe(digest);
    expect(resolveThresholds(table, jev, edited)).toBeNull();
  });
});

describe('abstention is a first-class outcome, never a low score', () => {
  const digest = 'digest';
  const table: CalibrationTable = {
    entries: { [`system-one\u0000jev-1.13\u0000${'a'.repeat(64)}\u0000${digest}`]: { deferBelow: 0.5, actAtOrAbove: 0.9 } },
  };
  test('an uncalibrated pairing abstains rather than scoring zero', () => {
    const verdict = scoreVerdict(score({ '0': 0.9, '1': 0.1 }), local, digest, table);
    expect(verdict).toMatchObject({ status: 'abstained', reason: 'no-calibration' });
    expect(verdict).not.toHaveProperty('value');
  });
  test('a bimodal answer abstains even when confidence is high', () => {
    const split = score({ '0': 0.45, '1': 0.03, '2': 0.04, '3': 0.03, '4': 0.45 }, 0.99);
    expect(scoreVerdict(split, jev, digest, table)).toMatchObject({ status: 'abstained', reason: 'bimodal-distribution' });
  });
  test('low confidence abstains instead of reporting the modal level', () => {
    const unsure = score({ '0': 0.3, '1': 0.25, '2': 0.2, '3': 0.15, '4': 0.1 }, 0.2);
    expect(scoreVerdict(unsure, jev, digest, table)).toMatchObject({ status: 'abstained', reason: 'below-confidence-floor' });
  });
  test('a confident unimodal answer decides on the modal level', () => {
    expect(scoreVerdict(score({ '0': 0.02, '1': 0.03, '2': 0.05, '3': 0.85, '4': 0.05 }, 0.95), jev, digest, table))
      .toMatchObject({ status: 'decided', value: 3, confidence: 0.95 });
  });
  test('every verdict is provenanced as a projection, never as an observation', () => {
    for (const verdict of [
      scoreVerdict(score({ '0': 0.9, '1': 0.1 }), jev, digest, table),
      abstained('backend-error', judgementProvenance(local, digest)),
    ]) {
      expect(verdict.provenance.source).toBe('proxy');
    }
  });
});

describe('evidence by selection cannot produce an unlocatable quote', () => {
  const spans = ['You carry the 1 into the tens column.', 'So the answer is 42.', 'You carry the 1 into the tens column.'];
  test('candidates are deduped and keep document order', () => {
    const selection = candidateSelection(spans);
    expect(selection.candidates).toEqual(['You carry the 1 into the tens column.', 'So the answer is 42.']);
  });
  test('a selected option resolves to a byte-identical span', () => {
    const selection = candidateSelection(spans);
    const resolved = resolveSelection(selection, choice('So the answer is 42.', { 'So the answer is 42.': 0.95 }));
    expect(resolved).toEqual({ index: 1, text: 'So the answer is 42.' });
    expect(spans).toContain(resolved!.text);
  });
  test('the escape hatch is a real answer, not a forced pick', () => {
    const selection = candidateSelection(spans);
    expect(resolveSelection(selection, choice(selection.noMatchOption, { [selection.noMatchOption]: 0.8 }))).toBeNull();
  });
  test('a span that was never offered resolves to nothing instead of being repaired', () => {
    const selection = candidateSelection(spans);
    expect(resolveSelection(selection, choice('The learner said something profound.', {}))).toBeNull();
  });
  test('a candidate that literally reads "none" does not collide with the sentinel', () => {
    const selection = candidateSelection(['none', 'something']);
    expect(selection.noMatchOption).not.toBe('none');
    expect(Object.keys(selection.criteria)).toContain('none');
    expect(resolveSelection(selection, choice('none', { none: 0.9 }))).toEqual({ index: 0, text: 'none' });
  });
  test('the option ceiling forces two-stage narrowing rather than a truncated ballot', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => `span ${index}`);
    expect(candidateSelection(many(254)).candidates).toHaveLength(254);
    expect(() => candidateSelection(many(255))).toThrow(/two stages/);
  });
});

describe('request guardrails are enforced before anything is sent', () => {
  const base = (questions: JudgementRequest['questions']): JudgementRequest => ({ state: 'learner work', questions });
  test('accepts a well-formed batch', () => {
    expect(judgementRequestProblem(base({ ready: { type: 'noul', instructions: 'Ready for the assessment?' } }))).toBeNull();
  });
  test('rejects an empty or oversized batch', () => {
    expect(judgementRequestProblem(base({}))).toMatch(/at least one question/);
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, index) =>
      [`q${index}`, { type: 'noul' as const, instructions: 'Correct?' }]));
    expect(judgementRequestProblem(base(many))).toMatch(/at most 64/);
  });
  test('rejects state large enough to invite context rot', () => {
    const request: JudgementRequest = { state: 'x'.repeat(96_001), questions: { a: { type: 'noul', instructions: 'Correct?' } } };
    expect(judgementRequestProblem(request)).toMatch(/exceeds 96000 characters/);
  });
  test('rejects a Score with too few levels and a Choice with too many options', () => {
    expect(judgementRequestProblem(base({ s: { type: 'score', instructions: 'Rate.', criteria: ['only'] } })))
      .toMatch(/at least 2 ordered levels/);
    const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`o${index}`, null]));
    expect(judgementRequestProblem(base({ c: { type: 'choice', instructions: 'Pick.', criteria } })))
      .toMatch(/narrow in two stages/);
  });
  test('counts structured state as its serialized length', () => {
    expect(judgementRequestProblem({ state: { answer: 'ok' }, questions: { a: { type: 'noul', instructions: 'Correct?' } } })).toBeNull();
  });
});

describe('composition stays in code', () => {
  test('re-weighting uses the cached answers and needs no new inference', () => {
    const answers = {
      mastery: score({ '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 }),
      confusion: score({ '0': 1, '1': 0, '2': 0, '3': 0, '4': 0 }),
    };
    const heavyMastery = compositeScore([
      { answer: answers.mastery, weight: 3 },
      { answer: answers.confusion, weight: 1 },
    ]);
    const balanced = compositeScore([
      { answer: answers.mastery, weight: 1 },
      { answer: answers.confusion, weight: 1 },
    ]);
    expect(heavyMastery).toBeCloseTo(0.75, 10);
    expect(balanced).toBeCloseTo(0.5, 10);
  });
  test('ignores non-positive weights and survives an empty basket', () => {
    expect(compositeScore([])).toBe(0);
    expect(compositeScore([{ answer: score({ '0': 0, '1': 1 }), weight: 0 }])).toBe(0);
  });
  test('choice margin reports distance to the runner-up', () => {
    expect(choiceMargin(choice('a', { a: 0.6, b: 0.3, c: 0.1 }))).toBeCloseTo(0.3, 10);
  });
});

describe('backend identity matches the Python classifier manifest', () => {
  const manifest = {
    kind: 'model_api',
    id: 'jev',
    revision: '1.13',
    protocol: 'contextual-tutor-response/v1',
    artifact_sha256: 'c'.repeat(64),
    calibration_sha256: null,
    minimum_confidence: 0.6,
  };
  test('accepts a hosted model backend with no calibration yet', () => {
    expect(validateClassifierManifest(manifest)).toBe(true);
  });
  test('requires a pinned artifact, a known kind, a matching protocol, and a positive floor', () => {
    expect(validateClassifierManifest({ ...manifest, artifact_sha256: 'short' })).toBe(false);
    expect(validateClassifierManifest({ ...manifest, kind: 'vibes' })).toBe(false);
    expect(validateClassifierManifest({ ...manifest, protocol: 'other/v1' })).toBe(false);
    expect(validateClassifierManifest({ ...manifest, minimum_confidence: 0 })).toBe(false);
  });
  test('an activation probe must be calibrated and name its observer', () => {
    const probe = { ...manifest, kind: 'activation_probe' };
    expect(validateClassifierManifest(probe)).toBe(false);
    expect(validateClassifierManifest({ ...probe, calibration_sha256: 'd'.repeat(64) })).toBe(false);
    expect(validateClassifierManifest({
      ...probe,
      calibration_sha256: 'd'.repeat(64),
      observer_manifest_sha256: 'e'.repeat(64),
    })).toBe(true);
  });
  test('rejects unknown fields so the two languages cannot drift apart', () => {
    expect(validateClassifierManifest({ ...manifest, temperature: 0.1 })).toBe(false);
  });
});
