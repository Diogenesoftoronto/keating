/** Exact-scope calibration and abstention properties for cached judgements. */
import { expect, test } from "bun:test";
import * as fc from "fast-check";

import type { JudgementBackendKey } from "../packages/learner-contracts/src/judgement/contracts.js";
import {
  resolveThresholds,
  scoreVerdict,
  type JudgementThresholds,
} from "../packages/learner-contracts/src/judgement/projections.js";

const arbBackend = fc.record({
  backend: fc.constantFrom("system-one", "local", "fixture"),
  model: fc.string({ minLength: 1, maxLength: 16 }),
  calibrationSha256: fc.constant("a".repeat(64)),
}) as fc.Arbitrary<JudgementBackendKey>;
const arbDigest = fc.string({
  unit: fc.constantFrom(..."0123456789abcdef"),
  minLength: 16,
  maxLength: 64,
});

function independentKey(backend: JudgementBackendKey, digest: string): string {
  return `${backend.backend}\u0000${backend.model}\u0000${backend.calibrationSha256 ?? ""}\u0000${digest}`;
}

test("resolveThresholds requires the exact backend, model, calibration, and question digest", () => {
  const thresholds: JudgementThresholds = { deferBelow: 0.55, actAtOrAbove: 0.91 };
  fc.assert(fc.property(arbBackend, arbDigest, (backend, digest) => {
    const table = { entries: { [independentKey(backend, digest)]: thresholds } };
    expect(resolveThresholds(table, backend, digest)).toEqual(thresholds);
    expect(resolveThresholds(table, { ...backend, model: `${backend.model}-other` }, digest)).toBeNull();
    expect(resolveThresholds(table, {
      ...backend,
      calibrationSha256: backend.calibrationSha256 === "a".repeat(64) ? "b".repeat(64) : "a".repeat(64),
    }, digest)).toBeNull();
    expect(resolveThresholds(table, backend, `${digest}-other`)).toBeNull();
    expect(resolveThresholds(table, { ...backend, calibrationSha256: null }, digest)).toBeNull();
  }), { numRuns: 80 });
});

test("scoreVerdict never decides when calibration is absent", () => {
  const answer = {
    type: "score" as const,
    score: 0.9,
    legend: { "0": "not yet", "1": "ready" },
    probabilities: { "0": 0.01, "1": 0.99 },
    confidence: 0.99,
  };
  const thresholds = { deferBelow: 0, actAtOrAbove: 0 };
  fc.assert(fc.property(
    fc.constantFrom("system-one", "local", "fixture"),
    fc.string({ minLength: 1, maxLength: 16 }),
    arbDigest,
    (backend, model, digest) => {
      const key: JudgementBackendKey = { backend, model, calibrationSha256: null };
      const verdict = scoreVerdict(answer, key, digest, { entries: { [independentKey(key, digest)]: thresholds } });
      expect(verdict.status).toBe("abstained");
      if (verdict.status === "abstained") expect(verdict.reason).toBe("no-calibration");
      expect(verdict.provenance).toEqual({ source: "proxy", backend: key, questionDigest: digest });
    },
  ), { numRuns: 60 });
});
