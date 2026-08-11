import { describe, expect, test } from "bun:test";
import {
  ContractValidationError,
  MergeConflictError,
  PORTABLE_LEARNER_DATA_KIND,
  createPortableLearnerEnvelope,
  mergePortableLearnerData,
  parsePortableLearnerEnvelope,
  validateBenchmarkHistoryRecord,
  validateEvolutionHistoryRecord,
} from "../src/index.js";
import { portableLearnerFixture } from "./fixtures.js";

describe("portable evaluation history", () => {
  test("accepts only finite percentage scores and explicit actual-run provenance", () => {
    const benchmark = portableLearnerFixture().benchmarks[0]!;
    const evolution = portableLearnerFixture().evolutions[0]!;
    expect(validateBenchmarkHistoryRecord(benchmark)).toBe(true);
    expect(validateEvolutionHistoryRecord(evolution)).toBe(true);

    for (const score of [-0.01, 100.01, Number.NaN, Infinity]) {
      expect(validateBenchmarkHistoryRecord({ ...benchmark, score })).toBe(false);
      expect(validateEvolutionHistoryRecord({ ...evolution, bestScore: score })).toBe(false);
    }
    expect(validateBenchmarkHistoryRecord({ ...benchmark, provenance: "estimated" })).toBe(false);
    expect(validateEvolutionHistoryRecord({ ...evolution, provenance: "benchmark-run" })).toBe(false);
  });

  test("keeps optional topic and session linkage literal and referential", () => {
    const unlinked = portableLearnerFixture();
    delete unlinked.benchmarks[0]!.topic;
    delete unlinked.benchmarks[0]!.sessionId;
    expect(createPortableLearnerEnvelope(unlinked).payload.benchmarks[0]).toEqual(unlinked.benchmarks[0]);

    const dangling = portableLearnerFixture();
    dangling.evolutions[0]!.sessionId = "session-missing";
    expect(() => createPortableLearnerEnvelope(dangling)).toThrow(ContractValidationError);
  });

  test("migrates v2 without inventing benchmark or evolution history", () => {
    const v2Payload = structuredClone(portableLearnerFixture()) as unknown as Record<string, unknown>;
    delete v2Payload.benchmarks;
    delete v2Payload.evolutions;
    const migrated = parsePortableLearnerEnvelope({
      kind: PORTABLE_LEARNER_DATA_KIND,
      schemaVersion: 2,
      payload: v2Payload,
    });
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.payload.benchmarks).toEqual([]);
    expect(migrated.payload.evolutions).toEqual([]);
  });

  test("unions immutable runs and fails closed on same-id divergence", () => {
    const left = portableLearnerFixture();
    const right = portableLearnerFixture();
    right.benchmarks.push({
      id: "benchmark-2", createdAt: "2026-08-11T00:00:00.000Z", score: 90,
      report: "Second completed benchmark.", provenance: "benchmark-run",
    });
    const merged = mergePortableLearnerData(left, right);
    expect(merged.benchmarks.map((record) => record.id)).toEqual(["benchmark-1", "benchmark-2"]);

    const conflict = portableLearnerFixture();
    conflict.evolutions[0]!.report = "Conflicting claim.";
    expect(() => mergePortableLearnerData(portableLearnerFixture(), conflict)).toThrow(MergeConflictError);
  });
});
