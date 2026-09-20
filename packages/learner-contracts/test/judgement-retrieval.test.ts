import { describe, expect, test } from 'bun:test';
import {
  MEMORY_CATEGORIES,
  MEMORY_FACT_CAP,
  OBSERVED_CONFIDENCE_CEILING,
  buildMemoryProposal,
  calibrateSimilarity,
  cosineSimilarity,
  memoryCategoryQuestion,
  rankBySimilarity,
  relevanceQuestion,
  rerank,
  selectMemoryFacts,
  similarityZScore,
  worthRememberingQuestion,
  type ScoreAnswer,
} from '../src/judgement/index.js';

const score = (level: number, confidence = 0.9): ScoreAnswer => {
  const probabilities: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 };
  probabilities[String(level)] = 1;
  return { type: 'score', score: level, legend: {}, probabilities, confidence };
};

describe('similarity is judged in calibrated units, never raw cosine', () => {
  test('cosine is computed only for comparable, non-degenerate vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([0, 0], [1, 0])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
    expect(cosineSimilarity([Number.NaN, 1], [1, 1])).toBeNull();
  });
  test('an anisotropic corpus is separated by z-score where raw cosine cannot', () => {
    // Every pair looks "highly similar" on raw cosine; only the spread informs.
    const cosines = [0.9309, 0.9421, 0.9455, 0.9468, 0.9599];
    const calibration = calibrateSimilarity(cosines)!;
    expect(calibration.mean).toBeGreaterThan(0.93);
    expect(calibration.standardDeviation).toBeLessThan(0.02);
    expect(cosines.every((cosine) => cosine > 0.8)).toBe(true);
    expect(similarityZScore(0.9599, calibration)!).toBeGreaterThan(1);
    expect(similarityZScore(0.9309, calibration)!).toBeLessThan(-1);
  });
  test('a degenerate corpus yields no z-score rather than a fabricated one', () => {
    expect(calibrateSimilarity([0.95])).toBeNull();
    expect(calibrateSimilarity([])).toBeNull();
    expect(similarityZScore(0.95, { mean: 0.95, standardDeviation: 0, sampleSize: 4 })).toBeNull();
  });
});

describe('ranking reports margin, not just position', () => {
  const embeddings = [
    { item: 'a', embedding: [1, 0, 0] },
    { item: 'b', embedding: [0.9, 0.1, 0] },
    { item: 'c', embedding: [0, 1, 0] },
  ];
  test('candidates come back best first with a margin to the runner-up', () => {
    const ranked = rankBySimilarity([1, 0, 0], embeddings);
    expect(ranked.map((entry) => entry.item)).toEqual(['a', 'b', 'c']);
    expect(ranked[0].marginToNext).not.toBeNull();
    expect(ranked[0].marginToNext!).toBeGreaterThan(0);
    expect(ranked[ranked.length - 1].marginToNext).toBeNull();
  });
  test('a z-score floor filters relative to the corpus, not to an absolute cosine', () => {
    const ranked = rankBySimilarity([1, 0, 0], embeddings, { minimumZScore: 0 });
    expect(ranked.length).toBeLessThan(embeddings.length);
    expect(ranked.every((entry) => entry.zScore === null || entry.zScore >= 0)).toBe(true);
  });
  test('unusable embeddings are skipped without failing the search', () => {
    const ranked = rankBySimilarity([1, 0, 0], [
      { item: 'good', embedding: [1, 0, 0] },
      { item: 'wrong-size', embedding: [1, 0] },
      { item: 'zero', embedding: [0, 0, 0] },
    ]);
    expect(ranked.map((entry) => entry.item)).toEqual(['good']);
  });
  test('an empty candidate set returns nothing rather than throwing', () => {
    expect(rankBySimilarity([1, 0], [])).toEqual([]);
  });
  test('limit truncates after ranking, not before', () => {
    expect(rankBySimilarity([1, 0, 0], embeddings, { limit: 2 }).map((entry) => entry.item)).toEqual(['a', 'b']);
  });
});

describe('reranking degrades to the deterministic order, never below it', () => {
  const shortlist = ['first', 'second', 'third'];
  test('a confident judgement reorders the shortlist', () => {
    const reranked = rerank(shortlist, new Map([[0, score(0)], [1, score(4)], [2, score(2)]]), 0.6);
    expect(reranked.map((entry) => entry.item)).toEqual(['second', 'third', 'first']);
    expect(reranked.every((entry) => entry.fellBack)).toBe(false);
  });
  test('with no judgement at all the original order survives intact', () => {
    const reranked = rerank(shortlist, new Map(), 0.6);
    expect(reranked.map((entry) => entry.item)).toEqual(shortlist);
    expect(reranked.every((entry) => entry.fellBack)).toBe(true);
  });
  test('unjudged items keep their relative order below the judged ones', () => {
    const reranked = rerank(shortlist, new Map([[2, score(4)]]), 0.6);
    expect(reranked.map((entry) => entry.item)).toEqual(['third', 'first', 'second']);
    expect(reranked[1].fellBack).toBe(true);
    expect(reranked[2].fellBack).toBe(true);
  });
  test('a low-confidence score is treated as no judgement, not as low relevance', () => {
    const reranked = rerank(shortlist, new Map([[0, score(4, 0.1)]]), 0.6);
    expect(reranked.map((entry) => entry.item)).toEqual(shortlist);
    expect(reranked[0].fellBack).toBe(true);
  });
  test('equal relevance keeps the deterministic tie-break, so reranking is stable', () => {
    const reranked = rerank(shortlist, new Map([[0, score(3)], [1, score(3)], [2, score(3)]]), 0.6);
    expect(reranked.map((entry) => entry.item)).toEqual(shortlist);
  });
  test('the relevance question is a Score over ordered levels', () => {
    const question = relevanceQuestion('how do I factor a quadratic');
    expect(question.type).toBe('score');
    expect(question.criteria.length).toBeGreaterThanOrEqual(2);
  });
});

describe('memory proposals must be grounded in the learner own words', () => {
  const messages = ['I get anxious before timed tests.', 'I like worked examples first.'];
  const base = {
    category: 'motivation' as const,
    value: 'Anxious about timed tests',
    noulProbability: 0.9,
    learnerMessages: messages,
  };
  test('an exact substring of a learner message is accepted', () => {
    const proposal = buildMemoryProposal({ ...base, evidence: 'anxious before timed tests' });
    expect(proposal).not.toBeNull();
    expect(proposal!.source).toBe('observed');
  });
  test('a paraphrase is rejected outright rather than repaired', () => {
    expect(buildMemoryProposal({ ...base, evidence: 'The learner feels nervous about exams' })).toBeNull();
  });
  test('text the assistant said, not the learner, cannot ground a fact', () => {
    expect(buildMemoryProposal({ ...base, evidence: 'Let us try a worked example', learnerMessages: messages })).toBeNull();
  });
  test('confidence is clamped to the observed ceiling, never claiming explicit certainty', () => {
    const proposal = buildMemoryProposal({ ...base, evidence: 'anxious before timed tests', noulProbability: 0.99 });
    expect(proposal!.confidence).toBe(OBSERVED_CONFIDENCE_CEILING);
    const modest = buildMemoryProposal({ ...base, evidence: 'anxious before timed tests', noulProbability: 0.3 });
    expect(modest!.confidence).toBeCloseTo(0.3, 10);
  });
  test('empty evidence, empty value, or a broken probability produce nothing', () => {
    expect(buildMemoryProposal({ ...base, evidence: '   ' })).toBeNull();
    expect(buildMemoryProposal({ ...base, evidence: 'anxious before timed tests', value: '  ' })).toBeNull();
    expect(buildMemoryProposal({ ...base, evidence: 'anxious before timed tests', noulProbability: Number.NaN })).toBeNull();
  });
  test('the category vocabulary matches the store', () => {
    expect([...MEMORY_CATEGORIES]).toEqual([
      'motivation', 'communication-preference', 'learning-preference', 'interest', 'study-context',
    ]);
    expect(Object.keys(memoryCategoryQuestion().criteria)).toEqual([...MEMORY_CATEGORIES]);
    expect(worthRememberingQuestion().type).toBe('noul');
  });
});

describe('the fact cap forces ranked eviction', () => {
  const fact = (confidence: number) => ({ confidence });
  test('the strongest facts are kept when the cap is exceeded', () => {
    const existing = Array.from({ length: MEMORY_FACT_CAP }, () => fact(0.2));
    const { kept, evicted } = selectMemoryFacts(existing, [fact(0.65)]);
    expect(kept).toHaveLength(MEMORY_FACT_CAP);
    expect(kept[0].confidence).toBe(0.65);
    expect(evicted).toHaveLength(1);
    expect(evicted[0].confidence).toBe(0.2);
  });
  test('nothing is evicted while under the cap', () => {
    const { kept, evicted } = selectMemoryFacts([fact(0.5)], [fact(0.4)]);
    expect(kept).toHaveLength(2);
    expect(evicted).toEqual([]);
  });
  test('ties keep the earlier fact so repeated runs do not churn the store', () => {
    const existing = [{ confidence: 0.5, id: 'old' }];
    const { kept } = selectMemoryFacts(existing, [{ confidence: 0.5, id: 'new' }], 1);
    expect(kept).toEqual([{ confidence: 0.5, id: 'old' }]);
  });
  test('a weaker proposal loses to what is already stored', () => {
    const existing = Array.from({ length: MEMORY_FACT_CAP }, () => fact(0.6));
    const { kept, evicted } = selectMemoryFacts(existing, [fact(0.1)]);
    expect(kept.every((entry) => entry.confidence === 0.6)).toBe(true);
    expect(evicted[0].confidence).toBe(0.1);
  });
});
