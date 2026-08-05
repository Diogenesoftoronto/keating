import { describe, expect, test } from "bun:test";
import {
	agentTraceEnvelopeSchema,
	exportAgentTrace,
	IpRateLimiter,
	mapAgentTraceToSpans,
	publicArizeConfig,
	readServerArizeConfig,
	requestWithinLimit,
	setAgentTraceExporterForTests,
	validateTracePayload,
} from "../../server/utils/arize-observability";

const envelope = {
	schema_version: 1,
	run_id: "run-1",
	session_id: "session-1",
	turn_index: 2,
	provider: "openai",
	model: "gpt-5",
	source: "provider",
	status: "success" as const,
	duration_ms: 120,
	generation_count: 1,
	tool_count: 1,
	app_version: "3.0.0",
	surface: "web" as const,
	generations: [{
		client_span_id: "generation-1",
		provider: "openai",
		model: "openrouter/anthropic:claude-3.7@prod",
		start_offset_ms: 10,
		duration_ms: 90,
		stop_reason: "stop",
		status: "success" as const,
		input_tokens: 12,
		output_tokens: 8,
	}],
	tools: [{
		client_call_id: "tool-1",
		name: "quiz",
		start_offset_ms: 100,
		duration_ms: 20,
		status: "success" as const,
		is_artifact: true,
	}],
	evaluation_content: { input: "synthetic question", output: "synthetic answer" },
};

function enabledConfig(content = false) {
	return readServerArizeConfig({
		ARIZE_ENABLED: "true",
		ARIZE_API_KEY: "test-key",
		ARIZE_SPACE_ID: "test-space",
		ARIZE_EVALUATION_CONTENT_ENABLED: content ? "true" : "false",
	});
}

describe("Arize server observability", () => {
	test("uses a secret-free, default-off public configuration", () => {
		const disabled = readServerArizeConfig({});
		expect(disabled).toMatchObject({ enabled: false, reason: "disabled", evaluationContentEnabled: false });
		const serialized = JSON.stringify(publicArizeConfig(enabledConfig()));
		expect(serialized).not.toContain("test-key");
		expect(serialized).not.toContain("test-space");
		expect(readServerArizeConfig({
			ARIZE_ENABLED: "true", ARIZE_API_KEY: "key", ARIZE_SPACE_ID: "space", ARIZE_PROJECT_NAME: "bad/name",
		}).reason).toBe("invalid_project_name");
	});

	test("rejects unknown, malformed, non-finite, and oversized trace fields", () => {
		expect(() => agentTraceEnvelopeSchema.parse({ ...envelope, unknown: true })).toThrow();
		expect(() => agentTraceEnvelopeSchema.parse({ ...envelope, duration_ms: Number.NaN })).toThrow();
		expect(() => agentTraceEnvelopeSchema.parse({ ...envelope, generation_count: 2 })).toThrow();
		expect(() => agentTraceEnvelopeSchema.parse({
			...envelope,
			generations: [{ ...envelope.generations[0], start_offset_ms: 100 }],
		})).toThrow();
		expect(() => agentTraceEnvelopeSchema.parse({
			...envelope,
			evaluation_content: { input: "x".repeat(16_001), output: "ok" },
		})).toThrow();
	});

	test("strips evaluation content unless the deployment permits it", () => {
		const disabledContent = validateTracePayload(envelope, enabledConfig(false));
		expect(disabledContent.evaluation_content).toBeUndefined();
		const enabledContent = validateTracePayload(envelope, enabledConfig(true));
		expect(enabledContent.evaluation_content).toEqual(envelope.evaluation_content);
		expect(() => validateTracePayload({
			...envelope,
			evaluation_content: { input: "x".repeat(20), output: "ok" },
		}, { ...enabledConfig(true), maxContentChars: 10 })).toThrow();
	});

	test("maps one agent root with parented LLM and tool children without prohibited data", async () => {
		const spans = mapAgentTraceToSpans(validateTracePayload(envelope, enabledConfig(true)), true);
		expect(spans.map((span) => span.kind)).toEqual(["AGENT", "LLM", "TOOL"]);
		expect(spans.slice(1).every((span) => span.parent === "run-1")).toBe(true);
		expect(spans[0].attributes["input.value"]).toBe("synthetic question");
		expect(JSON.stringify(spans.slice(1))).not.toContain("synthetic question");
		expect(JSON.stringify(spans)).not.toContain("arguments");

		let recorded: typeof spans | undefined;
		setAgentTraceExporterForTests((next) => { recorded = next as typeof spans; });
		await exportAgentTrace(validateTracePayload(envelope, enabledConfig(true)), enabledConfig(true));
		setAgentTraceExporterForTests();
		expect(recorded?.map((span) => span.name)).toEqual([
			"keating.agent.turn", "keating.llm.generation", "keating.tool.quiz",
		]);
	});

	test("awaits the configured exporter and propagates export failures", async () => {
		let released = false;
		setAgentTraceExporterForTests(async () => {
			await Promise.resolve();
			released = true;
		});
		try {
			await exportAgentTrace(validateTracePayload(envelope, enabledConfig()), enabledConfig());
			expect(released).toBe(true);

			setAgentTraceExporterForTests(() => {
				throw new Error("synthetic exporter failure");
			});
			await expect(exportAgentTrace(
				validateTracePayload(envelope, enabledConfig()),
				enabledConfig(),
			)).rejects.toThrow("synthetic exporter failure");
		} finally {
			setAgentTraceExporterForTests();
		}
	});

	test("bounds body hints and rate limits deterministically", () => {
		expect(requestWithinLimit("65536")).toBe(true);
		expect(requestWithinLimit("65537")).toBe(false);
		expect(requestWithinLimit("invalid")).toBe(false);
		const limiter = new IpRateLimiter();
		expect(limiter.allow("127.0.0.1", 2, 1_000)).toBe(true);
		expect(limiter.allow("127.0.0.1", 2, 1_001)).toBe(true);
		expect(limiter.allow("127.0.0.1", 2, 1_002)).toBe(false);
		expect(limiter.allow("127.0.0.1", 2, 61_001)).toBe(true);
		for (let index = 0; index < 5_000; index += 1) limiter.allow(`client-${index}`, 2, 62_000);
		expect(limiter.trackedKeyCountForTests()).toBeLessThanOrEqual(4_096);
	});
});
