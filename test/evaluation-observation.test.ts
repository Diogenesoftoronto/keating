import { describe, expect, test } from "bun:test";
import {
  evaluationSpanAttributes,
  exportEvaluationObservation,
  setEvaluationObservationExporterForTests,
} from "../src/observability/arize.js";
import {
  EVALUATION_OBSERVATION_VERSION,
  type EvaluationObservationV1,
} from "../src/observability/types.js";

const CALIBRATION = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

function baseObservation(): EvaluationObservationV1 {
  return {
    schemaVersion: EVALUATION_OBSERVATION_VERSION,
    operation: "benchmark",
    engine: "typed-judgement",
    status: "success",
    suite: "core",
    duration_ms: 12,
    app_version: "3.0.0",
    surface: "cli",
  };
}

describe("typed-judgement evaluation telemetry (§7)", () => {
  test("observation version bumped for the new engine", () => {
    expect(EVALUATION_OBSERVATION_VERSION).toBe(2);
  });

  test("EVALUATOR spans carry backend and calibration_sha256", () => {
    const attributes = evaluationSpanAttributes({
      ...baseObservation(),
      backend: "system-one",
      calibration_sha256: CALIBRATION,
    });
    expect(attributes["openinference.span.kind"]).toBe("EVALUATOR");
    expect(attributes["keating.schema.version"]).toBe(2);
    expect(attributes["keating.evidence.engine"]).toBe("typed-judgement");
    expect(attributes["keating.evidence.backend"]).toBe("system-one");
    expect(attributes["keating.evidence.calibration_sha256"]).toBe(CALIBRATION);
  });

  test("backend attributes are absent for non-judgement engines", () => {
    const attributes = evaluationSpanAttributes({ ...baseObservation(), engine: "deterministic" });
    expect(attributes["keating.evidence.engine"]).toBe("deterministic");
    expect(attributes).not.toHaveProperty("keating.evidence.backend");
    expect(attributes).not.toHaveProperty("keating.evidence.calibration_sha256");
  });

  test("all five engines flow through the exporter untouched", async () => {
    const seen: EvaluationObservationV1[] = [];
    setEvaluationObservationExporterForTests(async (observation) => {
      seen.push(observation);
    });
    try {
      const engines: EvaluationObservationV1["engine"][] = [
        "deterministic",
        "heuristic",
        "llm",
        "learner-feedback",
        "typed-judgement",
      ];
      for (const engine of engines) {
        await exportEvaluationObservation({ ...baseObservation(), engine });
      }
    } finally {
      setEvaluationObservationExporterForTests();
    }
    expect(seen.map((observation) => observation.engine)).toEqual([
      "deterministic",
      "heuristic",
      "llm",
      "learner-feedback",
      "typed-judgement",
    ]);
  });
});
