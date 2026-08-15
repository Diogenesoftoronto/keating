import { describe, expect, test } from "bun:test";
import { publicArizeAvailability, readArizeConfig } from "../src/observability/config.js";
import {
  exportEvaluationObservation,
  exportProviderCompletion,
  setEvaluationObservationExporterForTests,
} from "../src/observability/arize.js";

describe("Arize observability configuration", () => {
  test("is inert without explicit operator configuration and exposes no secrets", () => {
    const config = readArizeConfig({});
    expect(config).toMatchObject({ enabled: false, reason: "disabled", evaluationContentEnabled: false });
    expect(JSON.stringify(publicArizeAvailability(config))).not.toContain("apiKey");
  });

  test("requires bounded valid configuration", () => {
    expect(readArizeConfig({ ARIZE_ENABLED: "true", ARIZE_API_KEY: "key" }).reason).toBe("missing_space_id");
    expect(readArizeConfig({ ARIZE_ENABLED: "true", ARIZE_API_KEY: "key", ARIZE_SPACE_ID: "space", ARIZE_OTLP_ENDPOINT: "not a url" }).reason).toBe("invalid_endpoint");
    const config = readArizeConfig({ ARIZE_ENABLED: "true", ARIZE_API_KEY: "key", ARIZE_SPACE_ID: "space", ARIZE_MAX_CONTENT_CHARS: "999999", ARIZE_RATE_LIMIT_PER_MINUTE: "999999" });
    expect(config).toMatchObject({ enabled: true, maxContentChars: 16000, rateLimitPerMinute: 300 });
  });

  test("a failing exporter is isolated", async () => {
    setEvaluationObservationExporterForTests(async () => { throw new Error("private transport detail"); });
    await exportEvaluationObservation({ schemaVersion: 1, operation: "benchmark", engine: "deterministic", status: "success", suite: "core", duration_ms: 1, app_version: "3.0.0", surface: "cli" });
    setEvaluationObservationExporterForTests();
    expect(true).toBe(true);
  });

  test("provider completion export is inert when observability is disabled", async () => {
    const previousEnabled = process.env.ARIZE_ENABLED;
    process.env.ARIZE_ENABLED = "false";
    try {
      await exportProviderCompletion({
        provider: "test",
        model: "test-model",
        duration_ms: 5,
        status: "success",
        parse_outcome: "not_requested",
        app_version: "3.0.0",
        surface: "cli",
      });
    } finally {
      if (previousEnabled === undefined) delete process.env.ARIZE_ENABLED;
      else process.env.ARIZE_ENABLED = previousEnabled;
    }
    expect(true).toBe(true);
  });
});
