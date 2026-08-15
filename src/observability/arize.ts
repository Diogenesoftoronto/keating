import { SpanStatusCode } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { readArizeConfig } from "./config.js";
import type { EvaluationObservationV1 } from "./types.js";

type ObservationExporter = (observation: EvaluationObservationV1) => Promise<void>;

export interface ProviderCompletionObservation {
  provider: string;
  model: string;
  duration_ms: number;
  status: "success" | "error";
  parse_outcome: "not_requested" | "success" | "invalid";
  error_category?: string;
  app_version: string;
  surface: "cli" | "pi" | "mcp";
}

let testExporter: ObservationExporter | undefined;

export function setEvaluationObservationExporterForTests(exporter?: ObservationExporter): void {
  testExporter = exporter;
}

function attributesFor(observation: EvaluationObservationV1): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {
    "openinference.span.kind": "EVALUATOR",
    "keating.schema.version": observation.schemaVersion,
    "keating.evidence.engine": observation.engine,
    "keating.evaluation.status": observation.status,
    "keating.evaluation.suite": observation.suite,
    "keating.duration_ms": observation.duration_ms,
    "keating.app.version": observation.app_version,
    "keating.surface": observation.surface,
  };
  for (const key of ["score", "before_score", "after_score", "outcome_count", "candidate_count"] as const) {
    if (observation[key] !== undefined) attributes[`keating.evaluation.${key}`] = observation[key];
  }
  if (observation.provider) attributes["llm.provider"] = observation.provider;
  if (observation.model) attributes["llm.model_name"] = observation.model;
  if (observation.error_category) attributes["keating.error.category"] = observation.error_category;
  return attributes;
}

interface OtlpSpanSpec {
  name: string;
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
  errorMessage?: string;
}

async function exportSpanToOtlp(spec: OtlpSpanSpec): Promise<void> {
  const config = readArizeConfig();
  if (!config.enabled || !config.apiKey || !config.spaceId || !config.endpoint || !config.projectName) return;
  const exporter = new OTLPTraceExporter({
    url: config.endpoint,
    headers: { "arize-space-id": config.spaceId, "arize-api-key": config.apiKey },
  });
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "openinference.project.name": config.projectName }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const endedAt = Date.now();
  const startedAt = endedAt - spec.durationMs;
  const span = provider.getTracer("keating.arize").startSpan(spec.name, { startTime: startedAt });
  span.setAttributes(spec.attributes);
  if (spec.errorMessage) span.setStatus({ code: SpanStatusCode.ERROR, message: spec.errorMessage });
  span.end(endedAt);
  try {
    await provider.forceFlush();
  } finally {
    await provider.shutdown();
  }
}

async function exportToOtlp(observation: EvaluationObservationV1): Promise<void> {
  return exportSpanToOtlp({
    name: `keating.evaluation.${observation.operation}`,
    durationMs: observation.duration_ms,
    attributes: attributesFor(observation),
    ...(observation.status !== "success"
      ? { errorMessage: observation.error_category ?? observation.status }
      : {}),
  });
}

async function exportProviderToOtlp(observation: ProviderCompletionObservation): Promise<void> {
  return exportSpanToOtlp({
    name: "keating.llm.completion",
    durationMs: observation.duration_ms,
    attributes: {
      "openinference.span.kind": "LLM",
      "llm.provider": observation.provider,
      "llm.model_name": observation.model,
      "keating.duration_ms": observation.duration_ms,
      "keating.parse.outcome": observation.parse_outcome,
      "keating.app.version": observation.app_version,
      "keating.surface": observation.surface,
      ...(observation.error_category ? { "keating.error.category": observation.error_category } : {}),
    },
    ...(observation.status === "error"
      ? { errorMessage: observation.error_category ?? "error" }
      : {}),
  });
}

/** Best effort by contract: a telemetry outage must never alter the caller. */
export async function exportEvaluationObservation(observation: EvaluationObservationV1): Promise<void> {
  try {
    if (testExporter) await testExporter(observation);
    else await exportToOtlp(observation);
  } catch {
    // Intentionally opaque: raw transport/provider errors may contain secrets.
  }
}

export async function exportProviderCompletion(observation: ProviderCompletionObservation): Promise<void> {
  try {
    await exportProviderToOtlp(observation);
  } catch {
    // Provider traces are observational and cannot make a completion fail.
  }
}

export function classifyObservationError(error: unknown): string {
  if (error instanceof Error && /not ready|cooldown/i.test(error.message)) return "rejected";
  if (error instanceof Error && /parse|json/i.test(error.message)) return "parse";
  return "operation_failed";
}
