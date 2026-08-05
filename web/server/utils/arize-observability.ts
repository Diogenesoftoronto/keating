import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { z } from "zod";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CONTENT_CHARS = 16_000;
const MAX_RATE_LIMIT_KEYS = 4_096;
const RATE_LIMIT_OVERFLOW_KEY = "__overflow__";
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_NAME = /^[A-Za-z0-9._:@/+ -]{1,128}$/;

const finiteNumber = z.number().finite().nonnegative();
const identity = z.string().regex(SAFE_ID);
const name = z.string().regex(SAFE_NAME);

const generationSchema = z.object({
	client_span_id: identity,
	provider: name,
	model: name,
	start_offset_ms: finiteNumber,
	duration_ms: finiteNumber,
	ttft_ms: finiteNumber.optional(),
	stop_reason: name.optional(),
	status: z.enum(["success", "error", "aborted"]),
	input_tokens: finiteNumber.optional(),
	output_tokens: finiteNumber.optional(),
	total_tokens: finiteNumber.optional(),
	total_cost_usd: finiteNumber.optional(),
}).strict();
const toolSchema = z.object({
	client_call_id: identity,
	name: name,
	start_offset_ms: finiteNumber,
	duration_ms: finiteNumber,
	status: z.enum(["success", "error"]),
	is_artifact: z.boolean(),
}).strict();

export const agentTraceEnvelopeSchema = z.object({
	schema_version: z.literal(1),
	run_id: identity,
	session_id: identity,
	turn_index: z.number().int().min(0).max(1_000_000),
	provider: name,
	model: name,
	source: name,
	status: z.enum(["success", "error", "aborted"]),
	error_category: name.optional(),
	duration_ms: finiteNumber,
	generation_count: z.number().int().min(0).max(32),
	tool_count: z.number().int().min(0).max(32),
	app_version: name,
	surface: z.literal("web"),
	generations: z.array(generationSchema).max(32),
	tools: z.array(toolSchema).max(32),
	evaluation_content: z.object({ input: z.string().max(MAX_CONTENT_CHARS), output: z.string().max(MAX_CONTENT_CHARS) }).strict().optional(),
}).strict().superRefine((value, context) => {
	if (value.generation_count !== value.generations.length) context.addIssue({ code: "custom", message: "generation_count mismatch" });
	if (value.tool_count !== value.tools.length) context.addIssue({ code: "custom", message: "tool_count mismatch" });
	for (const generation of value.generations) {
		if (generation.start_offset_ms + generation.duration_ms > value.duration_ms) context.addIssue({ code: "custom", message: "generation timing exceeds run" });
	}
	for (const tool of value.tools) {
		if (tool.start_offset_ms + tool.duration_ms > value.duration_ms) context.addIssue({ code: "custom", message: "tool timing exceeds run" });
	}
});

export type AgentTraceEnvelope = z.infer<typeof agentTraceEnvelopeSchema>;
export interface ServerArizeConfig {
	enabled: boolean;
	reason: string;
	evaluationContentEnabled: boolean;
	maxContentChars: number;
	rateLimitPerMinute: number;
	trustProxyIp: boolean;
	apiKey?: string;
	spaceId?: string;
	endpoint?: string;
	projectName?: string;
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function validEndpoint(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
	} catch {
		return false;
	}
}

function validProjectName(value: string): boolean {
	return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value);
}

export function readServerArizeConfig(env: NodeJS.ProcessEnv = process.env): ServerArizeConfig {
	const apiKey = env.ARIZE_API_KEY?.trim();
	const spaceId = env.ARIZE_SPACE_ID?.trim();
	const endpoint = env.ARIZE_OTLP_ENDPOINT?.trim() || "https://otlp.arize.com/v1/traces";
	const projectName = env.ARIZE_PROJECT_NAME?.trim() || "keating";
	const reason = env.ARIZE_ENABLED !== "true" ? "disabled"
		: !apiKey ? "missing_api_key"
		: !spaceId ? "missing_space_id"
		: !validEndpoint(endpoint) ? "invalid_endpoint"
		: !validProjectName(projectName) ? "invalid_project_name"
		: "enabled";
	return {
		enabled: reason === "enabled", reason,
		evaluationContentEnabled: env.ARIZE_EVALUATION_CONTENT_ENABLED === "true",
		maxContentChars: boundedInteger(env.ARIZE_MAX_CONTENT_CHARS, MAX_CONTENT_CHARS, MAX_CONTENT_CHARS),
		rateLimitPerMinute: boundedInteger(env.ARIZE_RATE_LIMIT_PER_MINUTE, 30, 300),
		trustProxyIp: env.ARIZE_TRUST_PROXY_IP === "true",
		...(reason === "enabled" ? { apiKey, spaceId, endpoint, projectName } : {}),
	};
}

export function publicArizeConfig(config = readServerArizeConfig()): Omit<ServerArizeConfig, "apiKey" | "spaceId" | "endpoint" | "projectName" | "trustProxyIp"> {
	return { enabled: config.enabled, reason: config.reason, evaluationContentEnabled: config.evaluationContentEnabled, maxContentChars: config.maxContentChars, rateLimitPerMinute: config.rateLimitPerMinute };
}

export interface ArizeSpanRecord { name: string; kind: "AGENT" | "LLM" | "TOOL"; parent?: string; startOffsetMs: number; durationMs: number; attributes: Record<string, string | number | boolean>; status: "success" | "error"; }

/** Pure mapper for deterministic tests; no user content reaches a child span. */
export function mapAgentTraceToSpans(envelope: AgentTraceEnvelope, allowContent: boolean): ArizeSpanRecord[] {
	const root: ArizeSpanRecord = {
		name: "keating.agent.turn", kind: "AGENT", startOffsetMs: 0, durationMs: envelope.duration_ms, status: envelope.status === "success" ? "success" : "error",
		attributes: {
			"keating.schema.version": envelope.schema_version, "keating.run.id": envelope.run_id,
			"session.id": envelope.session_id, "keating.turn.index": envelope.turn_index,
			"keating.eval.eligible": allowContent && Boolean(envelope.evaluation_content), "keating.duration_ms": envelope.duration_ms,
			"keating.source": envelope.source, "keating.app.version": envelope.app_version, "keating.surface": envelope.surface,
			...(envelope.error_category ? { "keating.error.category": envelope.error_category } : {}),
			...(allowContent && envelope.evaluation_content ? { "input.value": envelope.evaluation_content.input, "output.value": envelope.evaluation_content.output } : {}),
		},
	};
	return [root,
		...envelope.generations.map((generation): ArizeSpanRecord => ({
			name: "keating.llm.generation", kind: "LLM", parent: envelope.run_id, startOffsetMs: generation.start_offset_ms, durationMs: generation.duration_ms, status: generation.status === "success" ? "success" : "error",
			attributes: { "keating.client.span.id": generation.client_span_id, "llm.provider": generation.provider, "llm.model_name": generation.model, "keating.duration_ms": generation.duration_ms, ...(generation.ttft_ms === undefined ? {} : { "keating.ttft_ms": generation.ttft_ms }), ...(generation.stop_reason ? { "keating.stop.reason": generation.stop_reason } : {}), ...(generation.input_tokens === undefined ? {} : { "llm.token_count.prompt": generation.input_tokens }), ...(generation.output_tokens === undefined ? {} : { "llm.token_count.completion": generation.output_tokens }), ...(generation.total_tokens === undefined ? {} : { "llm.token_count.total": generation.total_tokens }), ...(generation.total_cost_usd === undefined ? {} : { "keating.cost.usd": generation.total_cost_usd }) },
		})),
		...envelope.tools.map((tool): ArizeSpanRecord => ({
			name: `keating.tool.${tool.name}`, kind: "TOOL", parent: envelope.run_id, startOffsetMs: tool.start_offset_ms, durationMs: tool.duration_ms, status: tool.status,
			attributes: { "keating.client.call.id": tool.client_call_id, "tool.name": tool.name, "keating.duration_ms": tool.duration_ms, "keating.artifact": tool.is_artifact },
		})),
	];
}

let testTraceExporter: ((spans: readonly ArizeSpanRecord[]) => Promise<void> | void) | undefined;

class ResultTrackingSpanExporter implements SpanExporter {
	private failure: Error | undefined;
	constructor(private readonly delegate: SpanExporter) {}
	export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter["export"]>[1]): void {
		this.delegate.export(spans, (result) => {
			if (result.code !== 0) this.failure = result.error ?? new Error("OTLP trace export failed");
			resultCallback(result);
		});
	}
	forceFlush(): Promise<void> { return this.delegate.forceFlush?.() ?? Promise.resolve(); }
	shutdown(): Promise<void> { return this.delegate.shutdown(); }
	throwIfFailed(): void { if (this.failure) throw this.failure; }
}

export function setAgentTraceExporterForTests(
	exporter?: (spans: readonly ArizeSpanRecord[]) => Promise<void> | void,
): void {
	testTraceExporter = exporter;
}

/**
 * Best-effort OTLP export. The tracer provider is deliberately short-lived so
 * a serverless request cannot leak global instrumentation into another route.
 */
export async function exportAgentTrace(envelope: AgentTraceEnvelope, config = readServerArizeConfig()): Promise<void> {
	const records = mapAgentTraceToSpans(envelope, config.evaluationContentEnabled);
	if (testTraceExporter) {
		await testTraceExporter(records);
		return;
	}
	if (!config.enabled || !config.apiKey || !config.spaceId || !config.endpoint || !config.projectName) return;
	const exporter = new ResultTrackingSpanExporter(new OTLPTraceExporter({ url: config.endpoint, headers: { "arize-space-id": config.spaceId, "arize-api-key": config.apiKey } }));
	const provider = new NodeTracerProvider({
		resource: resourceFromAttributes({ "openinference.project.name": config.projectName }),
		spanProcessors: [new BatchSpanProcessor(exporter, { maxQueueSize: 64, maxExportBatchSize: 64, scheduledDelayMillis: 60_000 })],
	});
	const tracer = provider.getTracer("keating.arize.relay");
	const traceEndedAt = Date.now();
	const traceStartedAt = traceEndedAt - envelope.duration_ms;
	const root = tracer.startSpan(records[0].name, { startTime: traceStartedAt });
	root.setAttributes({ "openinference.span.kind": "AGENT", ...records[0].attributes });
	const rootContext = trace.setSpan(context.active(), root);
	for (const record of records.slice(1)) {
		const childStartedAt = Math.min(traceEndedAt, traceStartedAt + record.startOffsetMs);
		const childEndedAt = Math.min(traceEndedAt, childStartedAt + record.durationMs);
		const child = tracer.startSpan(record.name, { startTime: childStartedAt }, rootContext);
		child.setAttributes({ "openinference.span.kind": record.kind, ...record.attributes });
		if (record.status === "error") child.setStatus({ code: SpanStatusCode.ERROR });
		child.end(childEndedAt);
	}
	if (records[0].status === "error") root.setStatus({ code: SpanStatusCode.ERROR });
	root.end(traceEndedAt);
	try {
		await provider.forceFlush();
		exporter.throwIfFailed();
	} finally {
		await provider.shutdown();
	}
}

export function validateTracePayload(value: unknown, config = readServerArizeConfig()): AgentTraceEnvelope {
	const parsed = agentTraceEnvelopeSchema.parse(value);
	if (!config.evaluationContentEnabled) return { ...parsed, evaluation_content: undefined };
	const cap = config.maxContentChars;
	if (parsed.evaluation_content && (parsed.evaluation_content.input.length > cap || parsed.evaluation_content.output.length > cap)) throw new Error("content exceeds configured limit");
	return parsed;
}

export function requestWithinLimit(contentLength: string | undefined): boolean {
	if (!contentLength) return true;
	const parsed = Number(contentLength);
	return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_BODY_BYTES;
}

export class IpRateLimiter {
	private readonly records = new Map<string, number[]>();
	private operations = 0;
	allow(key: string, limit: number, now = Date.now()): boolean {
		const cutoff = now - 60_000;
		this.operations += 1;
		if (this.operations % 256 === 0) this.prune(cutoff);
		const boundedKey = !this.records.has(key) && this.records.size >= MAX_RATE_LIMIT_KEYS - 1
			? RATE_LIMIT_OVERFLOW_KEY
			: key;
		const current = (this.records.get(boundedKey) ?? []).filter((time) => time > cutoff);
		if (current.length >= limit) { this.records.set(boundedKey, current); return false; }
		current.push(now); this.records.set(boundedKey, current); return true;
	}
	private prune(cutoff: number): void {
		for (const [key, times] of this.records) {
			const current = times.filter((time) => time > cutoff);
			if (current.length === 0) this.records.delete(key);
			else if (current.length !== times.length) this.records.set(key, current);
		}
	}
	trackedKeyCountForTests(): number { return this.records.size; }
}
