import { describe, expect, test } from 'bun:test';
import {
  compareAgainstBaseline,
  fitDecisionTree,
  predictTree,
  treeDepth,
  treeFeatures,
  withHoldout,
  type TrainingRow,
} from '../src/judgement/index.js';

/** A clean separable signal plus a pure-noise feature the fitter should ignore. */
function separableRows(count: number): TrainingRow[] {
  return Array.from({ length: count }, (_, index) => {
    const mastery = index / count;
    return { features: { mastery, noise: (index % 7) / 7 }, label: mastery > 0.5 };
  });
}

describe('a shallow tree is fitted before anything more elaborate', () => {
  test('it recovers a separable threshold from the data', () => {
    const tree = fitDecisionTree(separableRows(100), { minimumSamplesPerLeaf: 5 });
    expect(tree.kind).toBe('split');
    if (tree.kind !== 'split') throw new Error('expected a split');
    expect(tree.feature).toBe('mastery');
    expect(tree.threshold).toBeGreaterThan(0.45);
    expect(tree.threshold).toBeLessThan(0.55);
  });
  test('predictions land on the correct side of that threshold', () => {
    const tree = fitDecisionTree(separableRows(100), { minimumSamplesPerLeaf: 5 });
    expect(predictTree(tree, { mastery: 0.9, noise: 0.5 })).toBeGreaterThan(0.5);
    expect(predictTree(tree, { mastery: 0.1, noise: 0.5 })).toBeLessThan(0.5);
  });
  test('depth is capped so the model stays readable', () => {
    const tree = fitDecisionTree(separableRows(200), { maxDepth: 2, minimumSamplesPerLeaf: 4 });
    expect(treeDepth(tree)).toBeLessThanOrEqual(2);
  });
  test('a noise-only feature earns no split', () => {
    const tree = fitDecisionTree(separableRows(100), { minimumSamplesPerLeaf: 5 });
    expect(treeFeatures(tree)).toContain('mastery');
    expect(treeFeatures(tree)).not.toContain('noise');
  });
  test('unlearnable data collapses to a single honest leaf', () => {
    // A constant feature offers no candidate threshold, so greedy fitting
    // provably cannot split: the only honest output is the base rate.
    // (Alternating labels on an ordered feature DO yield tiny positive gains;
    // that case is governed by the holdout comparison, not by structure.)
    const rows: TrainingRow[] = Array.from({ length: 40 }, (_, index) => ({
      features: { x: 0 },
      label: index % 2 === 0,
    }));
    const tree = fitDecisionTree(rows, { minimumSamplesPerLeaf: 5 });
    expect(tree.kind).toBe('leaf');
    expect(predictTree(tree, { x: 0.3 })).toBeCloseTo(0.5, 1);
  });
  test('too little data yields a leaf rather than an overfitted split', () => {
    const tree = fitDecisionTree([
      { features: { x: 0 }, label: false },
      { features: { x: 1 }, label: true },
    ]);
    expect(tree.kind).toBe('leaf');
  });
  test('an empty dataset produces a leaf, not a crash', () => {
    expect(fitDecisionTree([])).toEqual({ kind: 'leaf', probability: 0, sampleSize: 0 });
  });
  test('a missing feature is absent rather than imputed to zero', () => {
    const tree = fitDecisionTree(separableRows(100), { minimumSamplesPerLeaf: 5 });
    const withoutFeature = predictTree(tree, { noise: 0.5 });
    expect(withoutFeature).toBeGreaterThan(0);
    expect(withoutFeature).toBeLessThan(1);
    expect(withoutFeature).not.toBe(predictTree(tree, { mastery: 0 }));
  });
});

describe('the holdout keeps the loop from confirming itself', () => {
  test('held-out rows are excluded from fitting', () => {
    const rows = withHoldout(separableRows(100), 0.5).map((row, index) =>
      // Poison only the held-out rows: a tree that learned from them would
      // pick up the inverted labels.
      row.heldOut ? { ...row, label: !row.label } : row);
    const tree = fitDecisionTree(rows, { minimumSamplesPerLeaf: 5 });
    expect(predictTree(tree, { mastery: 0.9, noise: 0 })).toBeGreaterThan(0.5);
  });
  test('the split is deterministic so two runs stay comparable', () => {
    const first = withHoldout(separableRows(20), 0.25).map((row) => row.heldOut);
    const second = withHoldout(separableRows(20), 0.25).map((row) => row.heldOut);
    expect(first).toEqual(second);
    expect(first.filter(Boolean).length).toBeGreaterThan(0);
  });
  test('a non-positive fraction holds nothing out', () => {
    expect(withHoldout(separableRows(10), 0).every((row) => row.heldOut === false)).toBe(true);
    expect(withHoldout(separableRows(10), -1).every((row) => row.heldOut === false)).toBe(true);
  });
});

describe('a fitted model must beat the constants it would replace', () => {
  const rows = withHoldout(separableRows(120), 0.25);
  const tree = fitDecisionTree(rows, { minimumSamplesPerLeaf: 5 });

  test('it is scored only on rows it never saw', () => {
    const comparison = compareAgainstBaseline(
      rows,
      (features) => predictTree(tree, features),
      () => 0.5,
    )!;
    expect(comparison.sampleSize).toBeLessThan(rows.length);
    expect(comparison.beatsBaseline).toBe(true);
    expect(comparison.improvement).toBeGreaterThan(0);
  });
  test('a model that does not beat the incumbent is reported as such', () => {
    const comparison = compareAgainstBaseline(rows, () => 0.5, (features) => predictTree(tree, features))!;
    expect(comparison.beatsBaseline).toBe(false);
    expect(comparison.improvement).toBeLessThan(0);
  });
  test('with no holdout there is no score, rather than a flattering one', () => {
    expect(compareAgainstBaseline(separableRows(10), () => 1, () => 0)).toBeNull();
  });
  test('brier is an error, so lower is better and a perfect model scores zero', () => {
    const perfect = compareAgainstBaseline(
      withHoldout(separableRows(40), 0.5),
      (features) => (features.mastery > 0.5 ? 1 : 0),
      () => 0.5,
    )!;
    expect(perfect.candidateBrier).toBeCloseTo(0, 6);
    expect(perfect.baselineBrier).toBeCloseTo(0.25, 6);
  });
});
