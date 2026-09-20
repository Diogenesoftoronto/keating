import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  boostingTrainingRows,
  predictBoostingLogit,
  predictBoostingProbability,
  prepareBoostingArtifact,
  serializeBoostingArtifact,
  validateBoostingArtifact,
  validateBoostingDataset,
  verifyBoostingText,
  type BoostingArtifact,
} from '../src/judgement/boosting-artifact.js';

// Frozen synthetic fixture, not learner evidence. See scripts/training/boosting_fixture.py.
const FIXTURE = join(import.meta.dir, '../../../test/fixtures/boosting');
const read = (name: string): any => JSON.parse(readFileSync(join(FIXTURE, name), 'utf8'));
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function fitted(): BoostingArtifact {
  const prepared = prepareBoostingArtifact({
    ...read('dataset.json'),
    framework: read('expected.json').framework,
    model: read('catboost-model.json'),
  });
  return prepared.complete(hash(prepared.identityInput));
}

describe('an adopted CatBoost ensemble is exact and its numbers are recomputed', () => {
  test('the portable walk reproduces CatBoost probabilities on every fixture row', () => {
    const artifact = fitted();
    const dataset = read('dataset.json');
    const expected = read('expected.json').probabilities;
    expect(artifact.model.trees).toHaveLength(100);
    expect(artifact.model.nanMode).toBe('min');
    let missing = 0;
    for (const row of dataset.observations) {
      if (row.features.hint === undefined) missing += 1;
      expect(predictBoostingProbability(artifact.model, row.features)).toBeCloseTo(expected[row.rowId], 9);
    }
    expect(missing).toBeGreaterThan(0);
  });

  test('a logit below zero still exponentiates rather than losing precision', () => {
    const artifact = fitted();
    const row = read('dataset.json').observations[0];
    const logit = predictBoostingLogit(artifact.model, row.features);
    expect(Number.isFinite(logit)).toBe(true);
    expect(predictBoostingProbability(artifact.model, { ...row.features, missing: undefined })).toBeGreaterThan(0);
  });

  test('an absent feature is treated as NaN, not as zero', () => {
    const artifact = fitted();
    const row = read('dataset.json').observations.find((candidate: any) => candidate.features.hint === undefined);
    const withoutHint = predictBoostingProbability(artifact.model, { prediction: row.features.prediction, timing: row.features.timing });
    const withZero = predictBoostingProbability(artifact.model, { prediction: row.features.prediction, timing: row.features.timing, hint: 0 });
    expect(withoutHint).toBeCloseTo(read('expected.json').probabilities[row.rowId], 9);
    expect(withoutHint).not.toBeCloseTo(withZero, 9);
  });

  test('metrics follow the model rather than the trainer, and a wrong model cannot validate', () => {
    const artifact = fitted();
    expect(artifact.status).toBe('validated');
    expect(artifact.metrics.validationRows).toBe(60);
    expect(artifact.metrics.validationGroups).toBe(8);
    expect(artifact.metrics.brier).toBeLessThan(artifact.metrics.baselineBrier!);
    expect(artifact.metrics.beatsBaseline).toBe(true);
    expect(artifact.metrics.auc).toBeGreaterThan(0.9);
    expect(artifact.reliability.reduce((sum, bin) => sum + bin.count, 0)).toBe(artifact.metrics.validationRows);
    const shifted = read('catboost-model.json');
    shifted.scale_and_bias[1][0] = 6;
    const prepared = prepareBoostingArtifact({ ...read('dataset.json'), framework: read('expected.json').framework, model: shifted });
    const worse = prepared.complete(hash(prepared.identityInput));
    expect(worse.status).toBe('failed-validation');
    expect(worse.metrics.brier).toBeGreaterThan(artifact.metrics.brier);
    expect(worse.model.bias).toBe(6);
  });

  test('observed rows alone may validate a model when no incumbent number exists', () => {
    const dataset = read('dataset.json');
    for (const row of dataset.observations) delete row.baseline;
    const prepared = prepareBoostingArtifact({ ...dataset, framework: read('expected.json').framework, model: read('catboost-model.json') });
    const artifact = prepared.complete(hash(prepared.identityInput));
    expect(artifact.metrics.baselineBrier).toBeNull();
    expect(artifact.metrics.beatsBaseline).toBeNull();
    expect(artifact.status).toBe('validated');
  });

  test('too few independent rows abstain instead of claiming a validated model', () => {
    const dataset = read('dataset.json');
    dataset.observations = dataset.observations.slice(0, 6);
    const prepared = prepareBoostingArtifact({ ...dataset, framework: read('expected.json').framework, model: read('catboost-model.json') });
    const artifact = prepared.complete(hash(prepared.identityInput));
    expect(artifact.status).toBe('insufficient');
    expect(artifact.input.dataset.fitRows).toBeLessThanOrEqual(6);
  });

  test('held-out rows are marked for the shared comparison', () => {
    const artifact = fitted();
    const rows = boostingTrainingRows(artifact);
    expect(rows.filter(row => row.heldOut === true)).toHaveLength(artifact.metrics.validationRows);
    expect(rows.filter(row => row.heldOut !== true)).toHaveLength(artifact.input.dataset.fitRows);
  });
});

describe('the fitted identity pins the ensemble, the policy and the rows', () => {
  test('a changed leaf, policy, label or framework is a different fitted identity', () => {
    const artifact = fitted();
    const identity = (mutate: (value: any) => void): string => {
      const value = { ...read('dataset.json'), framework: read('expected.json').framework, model: read('catboost-model.json') };
      mutate(value);
      const prepared = prepareBoostingArtifact(value);
      return prepared.complete(hash(prepared.identityInput)).boostingSha256;
    };
    expect(identity(() => {})).toBe(artifact.boostingSha256);
    expect(identity(value => { value.model.oblivious_trees[0].leaf_values[0] += 0.001; })).not.toBe(artifact.boostingSha256);
    expect(identity(value => { value.policy.maxValidationEce = 0.2; })).not.toBe(artifact.boostingSha256);
    expect(identity(value => { value.observations[1].label = 1 - value.observations[1].label; })).not.toBe(artifact.boostingSha256);
    expect(identity(value => { value.framework.version = '1.2.11'; })).not.toBe(artifact.boostingSha256);
    expect(identity(value => { value.model.scale_and_bias[0] = 0.5; })).not.toBe(artifact.boostingSha256);
  });

  test('a stored artifact rebuilds from its own rows and verifies with an injected digest', async () => {
    const artifact = fitted();
    const serialized = serializeBoostingArtifact(artifact);
    const stored = JSON.parse(serialized);
    const rebuilt = validateBoostingArtifact(stored);
    expect(rebuilt.complete(hash(rebuilt.identityInput))).toEqual(artifact);
    const asyncDigest = async (text: string): Promise<string> => hash(text);
    const verified = await verifyBoostingText(serialized, hash(serialized), asyncDigest);
    expect(verified.artifact).toEqual(artifact);
    await expect(verifyBoostingText(serialized, 'f'.repeat(64), asyncDigest)).rejects.toThrow('Invalid boosting artifact');
    stored.metrics.brier = 0;
    await expect(verifyBoostingText(JSON.stringify(stored), hash(JSON.stringify(stored)), asyncDigest)).rejects.toThrow('Invalid boosting artifact');
    stored.metrics.brier = artifact.metrics.brier;
    stored.status = 'insufficient';
    await expect(verifyBoostingText(JSON.stringify(stored), hash(JSON.stringify(stored)), asyncDigest)).rejects.toThrow('Invalid boosting artifact');
  });
});

describe('a trainer export that does not match the contract is refused', () => {
  test('malformed rows are rejected before fitting', () => {
    const mutations: ((value: any) => void)[] = [
      value => { value.observations[0].features.unexpected = 0.5; },
      value => { value.observations[0].rowId = value.observations[1].rowId; },
      value => { value.observations[0].groupId = value.observations[1].groupId; },
      value => { value.observations[0].features.prediction = Number.NaN; },
      value => { value.observations[0].label = 2; },
      value => { value.observations[0].baseline = 1.5; },
      value => { value.observations[0].split = 'test'; },
      value => { value.features = ['prediction', 'prediction']; },
      value => { value.features = []; },
      value => { value.observations[0].features = {}; },
      value => { value.observations = []; },
      value => { value.schemaVersion = 2; },
      value => { value.invented = true; },
    ];
    for (const mutate of mutations) {
      const value = { ...read('dataset.json'), framework: read('expected.json').framework, model: read('catboost-model.json') };
      mutate(value);
      expect(() => prepareBoostingArtifact(value)).toThrow('Invalid boosting artifact');
    }
  });

  test('a dataset validates independently of any model', () => {
    const dataset = validateBoostingDataset({ ...read('dataset.json') });
    expect(dataset.features).toEqual(['prediction', 'timing', 'hint']);
    expect(dataset.observations).toHaveLength(180);
    const unknown = { ...read('dataset.json'), framework: read('expected.json').framework };
    expect(() => validateBoostingDataset(unknown)).toThrow('Invalid boosting artifact');
  });

  test('a categorical, non-float, oversized or unsupported export is refused', () => {
    const mutations: ((value: any) => void)[] = [
      value => { value.model.features_info.categorical_features = [{ feature_index: 0 }]; },
      value => { value.model.features_info.ctrs = [{ identifier: 'x' }]; },
      value => { value.model.oblivious_trees[0].splits[0].split_type = 'OneHotFeature'; },
      value => { value.model.oblivious_trees[0].splits[0].float_feature_index = 9; },
      value => { value.model.oblivious_trees[0].leaf_values.pop(); },
      value => { value.model.scale_and_bias = [1]; },
      value => { value.model.scale_and_bias = [1, [0], [0]]; },
      value => { value.model.model_info.params.flat_params.nan_mode = 'Median'; },
      value => { value.model.features_info.float_features.pop(); },
      value => { value.model.oblivious_trees[0].splits = []; },
      value => { delete value.model.oblivious_trees; },
      value => { value.policy.maxTreeDepth = 2; },
    ];
    for (const mutate of mutations) {
      const value = { ...read('dataset.json'), framework: read('expected.json').framework, model: read('catboost-model.json') };
      mutate(value);
      expect(() => prepareBoostingArtifact(value)).toThrow('Invalid boosting artifact');
    }
  });

  test('an unknown framework or a wrong version shape is refused', () => {
    for (const framework of [{ name: 'lightgbm', version: '1.0', parameters: {} }, { name: 'catboost', version: '1.0', parameters: { iterations: { nested: 1 } } }, { name: 'catboost', version: '1.0' }]) {
      expect(() => prepareBoostingArtifact({ ...read('dataset.json'), framework, model: read('catboost-model.json') })).toThrow('Invalid boosting artifact');
    }
  });
});