import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	subscribeAgentAnalytics,
	type AgentAnalyticsAgent,
	type AgentAnalyticsProperties,
	type AgentTraceEnvelopeV1,
} from "../lib/agent-analytics";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "private response" }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage: EMPTY_USAGE,
		stopReason: "stop",
		timestamp: 1,
		...overrides,
	};
}

class FakeAgent implements AgentAnalyticsAgent {
	state = {
		messages: [] as AgentMessage[],
		model: {
			id: "gpt-5",
			provider: "openai",
			name: "GPT-5",
			api: "openai-responses",
			baseUrl: "https://private.invalid",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 256_000,
			maxTokens: 32_000,
		} as any,
	};

	private listener?: (event: AgentEvent, signal: AbortSignal) => void;
	readonly controller = new AbortController();

	subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}

	emit(event: AgentEvent): void {
		this.listener?.(event, this.controller.signal);
	}
}

interface CapturedEvent {
	event: string;
	properties: AgentAnalyticsProperties;
}

function harness(options: {
	messages?: AgentMessage[];
	turnIndex?: () => number;
	emitFailedEvent?: boolean;
	onCompletedRun?: (envelope: AgentTraceEnvelopeV1) => unknown;
	evaluationContent?: () => { input: string; output: string } | undefined;
	appVersion?: string;
} = {}) {
	const agent = new FakeAgent();
	agent.state.messages = options.messages ?? [];
	const captures: CapturedEvent[] = [];
	let time = 0;
	let id = 0;
	const unsubscribe = subscribeAgentAnalytics(agent, {
		capture: (event, properties) => captures.push({ event, properties }),
		sessionId: () => "session-123",
		now: () => time,
		createId: () => `telemetry-${++id}`,
		getModel: () => ({ id: agent.state.model.id, provider: agent.state.model.provider }),
		getSource: () => "byok",
		getTurnIndex: options.turnIndex,
		appVersion: options.appVersion,
		isArtifactTool: (toolName) => toolName === "quiz" || toolName === "map",
		emitFailedEvent: options.emitFailedEvent,
		onCompletedRun: options.onCompletedRun,
		getEvaluationContent: options.evaluationContent,
	});
	return {
		agent,
		captures,
		at(value: number) {
			time = value;
		},
		unsubscribe,
	};
}

function event(captures: CapturedEvent[], name: string, index = 0): CapturedEvent {
	const matches = captures.filter((capture) => capture.event === name);
	expect(matches.length).toBeGreaterThan(index);
	return matches[index];
}

function assertNoPrivatePayload(captures: CapturedEvent[], ...secrets: string[]): void {
	const serialized = JSON.stringify(captures);
	for (const secret of secrets) expect(serialized).not.toContain(secret);
	for (const capture of captures) {
		for (const key of [
			"args",
			"result",
			"content",
			"prompt",
			"response",
			"error",
			"error_message",
			"$ai_input",
			"$ai_output_choices",
			"$ai_error",
		]) {
			expect(capture.properties[key]).toBeUndefined();
		}
	}
}

describe("agent analytics", () => {
	test("captures a successful streamed run with TTFT, usage, cost, and stable IDs", () => {
		const h = harness();
		const partial = assistant();
		const final = assistant({
			responseModel: "gpt-5-2026-07-01",
			usage: {
				input: 120,
				output: 30,
				cacheRead: 80,
				cacheWrite: 12,
				cacheWrite1h: 4,
				totalTokens: 242,
				cost: {
					input: 0.0012,
					output: 0.003,
					cacheRead: 0.0002,
					cacheWrite: 0.0004,
					total: 0.0048,
				},
			},
		});

		h.at(100);
		h.agent.emit({ type: "agent_start" });
		h.at(110);
		h.agent.emit({ type: "turn_start" });
		h.at(115);
		h.agent.emit({ type: "message_start", message: partial });
		h.at(125);
		h.agent.emit({
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_start", contentIndex: 0, partial },
		});
		h.at(160);
		h.agent.emit({
			type: "message_update",
			message: partial,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "private token",
				partial,
			},
		});
		h.at(310);
		h.agent.emit({ type: "message_end", message: final });
		h.agent.emit({ type: "turn_end", message: final, toolResults: [] });
		h.at(400);
		h.agent.emit({ type: "agent_end", messages: [final] });

		const started = event(h.captures, "agent_turn_started").properties;
		expect(started).toMatchObject({
			session_id: "session-123",
			turn_index: 0,
			run_id: "telemetry-1",
			trace_id: "telemetry-1",
			turn_number: 1,
			model: "openai/gpt-5",
			provider: "openai",
			source: "byok",
			status: "started",
		});

		const generation = event(h.captures, "$ai_generation").properties;
		expect(generation).toMatchObject({
			$ai_trace_id: "telemetry-1",
			$ai_session_id: "session-123",
			$ai_span_id: "telemetry-2",
			$ai_model: "gpt-5-2026-07-01",
			$ai_provider: "openai",
			$ai_latency: 0.2,
			$ai_time_to_first_token: 0.05,
			$ai_stream: true,
			$ai_is_error: false,
			$ai_stop_reason: "stop",
			$ai_input_tokens: 120,
			$ai_output_tokens: 30,
			$ai_total_tokens: 242,
			$ai_cache_read_input_tokens: 80,
			$ai_cache_creation_input_tokens: 12,
			$ai_cache_creation_1h_input_tokens: 4,
			$ai_total_cost_usd: 0.0048,
		});

		expect(event(h.captures, "agent_turn_completed").properties).toMatchObject({
			duration_ms: 300,
			success: true,
			status: "success",
			outcome: "completed",
			generation_count: 1,
			tool_count: 0,
			turn_index: 0,
			run_id: "telemetry-1",
		});
		expect(h.captures.some((capture) => capture.event === "agent_turn_failed")).toBe(false);
		assertNoPrivatePayload(h.captures, "private token", "private response");
	});

	test("captures each generation in a multi-tool loop and never captures tool data", () => {
		const h = harness({
			messages: [{ role: "user", content: "old private prompt", timestamp: 1 }],
		});
		const toolTurn = assistant({
			content: [
				{ type: "toolCall", id: "call-7", name: "quiz", arguments: { secret: "tool args" } },
			],
			stopReason: "toolUse",
		});
		const final = assistant({ model: "gpt-5-mini" });

		h.agent.emit({ type: "agent_start" });
		h.at(10);
		h.agent.emit({ type: "turn_start" });
		h.at(40);
		h.agent.emit({ type: "message_end", message: toolTurn });
		h.at(45);
		h.agent.emit({
			type: "tool_execution_start",
			toolCallId: "call-7",
			toolName: "quiz",
			args: { secret: "tool args" },
		});
		h.at(95);
		h.agent.emit({
			type: "tool_execution_end",
			toolCallId: "call-7",
			toolName: "quiz",
			result: { content: [{ type: "text", text: "tool result" }] },
			isError: false,
		});
		h.at(96);
		h.agent.emit({
			type: "tool_execution_start",
			toolCallId: "call-8",
			toolName: "map",
			args: { secret: "failed tool args" },
		});
		h.at(106);
		h.agent.emit({
			type: "tool_execution_end",
			toolCallId: "call-8",
			toolName: "map",
			result: { content: [{ type: "text", text: "failed tool result" }] },
			isError: true,
		});
		h.agent.emit({ type: "turn_end", message: toolTurn, toolResults: [] });
		h.at(110);
		h.agent.emit({ type: "turn_start" });
		h.at(190);
		h.agent.emit({ type: "message_end", message: final });
		h.agent.emit({ type: "turn_end", message: final, toolResults: [] });
		h.at(210);
		h.agent.emit({ type: "agent_end", messages: [toolTurn, final] });

		expect(h.captures.filter((capture) => capture.event === "$ai_generation")).toHaveLength(2);
		expect(event(h.captures, "$ai_generation", 0).properties).toMatchObject({
			$ai_span_id: "telemetry-2",
			$ai_latency: 0.03,
			$ai_stop_reason: "toolUse",
		});
		expect(event(h.captures, "$ai_generation", 1).properties).toMatchObject({
			$ai_span_id: "telemetry-3",
			$ai_latency: 0.08,
			$ai_model: "gpt-5-mini",
		});
		expect(event(h.captures, "tool_invocation_started").properties).toMatchObject({
			tool_call_id: "call-7",
			tool_name: "quiz",
			status: "started",
		});
		expect(event(h.captures, "tool_invoked").properties).toMatchObject({
			tool_call_id: "call-7",
			tool_name: "quiz",
			duration_ms: 50,
			success: true,
			status: "success",
			is_artifact: true,
		});
		expect(event(h.captures, "tool_invoked", 1).properties).toMatchObject({
			tool_call_id: "call-8",
			tool_name: "map",
			duration_ms: 10,
			success: false,
			status: "error",
		});
		expect(event(h.captures, "agent_turn_completed").properties.turn_index).toBe(1);
		expect(event(h.captures, "agent_turn_completed").properties).toMatchObject({
			turn_number: 2,
			generation_count: 2,
			tool_count: 2,
		});
		assertNoPrivatePayload(
			h.captures,
			"old private prompt",
			"tool args",
			"tool result",
			"failed tool args",
			"failed tool result",
		);
	});

	test("classifies provider errors without capturing the raw error", () => {
		const h = harness();
		const failure = assistant({
			content: [{ type: "text", text: "" }],
			stopReason: "error",
			errorMessage: "401 invalid API key secret-key-value",
		});

		h.agent.emit({ type: "agent_start" });
		h.agent.emit({ type: "turn_start" });
		h.at(20);
		h.agent.emit({ type: "message_end", message: failure });
		h.agent.emit({ type: "turn_end", message: failure, toolResults: [] });
		h.at(25);
		h.agent.emit({ type: "agent_end", messages: [failure] });

		expect(event(h.captures, "$ai_generation").properties).toMatchObject({
			$ai_is_error: true,
			$ai_stop_reason: "error",
			error_category: "auth",
		});
		expect(event(h.captures, "agent_turn_completed").properties).toMatchObject({
			success: false,
			status: "error",
			outcome: "error",
			error_type: "auth",
			error_category: "auth",
		});
		expect(event(h.captures, "agent_turn_failed").properties).toMatchObject({
			success: false,
			status: "error",
			error_category: "auth",
		});
		assertNoPrivatePayload(h.captures, "secret-key-value", "invalid API key");
	});

	test("marks an aborted run even when no assistant error message completes", () => {
		const h = harness();
		h.agent.emit({ type: "agent_start" });
		h.agent.emit({ type: "turn_start" });
		h.at(75);
		h.agent.controller.abort("private abort reason");
		h.agent.emit({ type: "agent_end", messages: [] });

		expect(event(h.captures, "agent_turn_completed").properties).toMatchObject({
			duration_ms: 75,
			success: false,
			status: "aborted",
			outcome: "cancelled",
			error_category: "aborted",
		});
		expect(h.captures.filter((capture) => capture.event === "$ai_generation")).toHaveLength(0);
		assertNoPrivatePayload(h.captures, "private abort reason");
	});

	test("emits a generation for a no-content response without inventing TTFT", () => {
		const h = harness();
		const empty = assistant({ content: [], usage: EMPTY_USAGE });
		h.agent.emit({ type: "agent_start" });
		h.at(5);
		h.agent.emit({ type: "turn_start" });
		h.at(15);
		h.agent.emit({ type: "message_start", message: empty });
		h.agent.emit({ type: "message_end", message: empty });
		h.agent.emit({ type: "turn_end", message: empty, toolResults: [] });
		h.agent.emit({ type: "agent_end", messages: [empty] });

		const generation = event(h.captures, "$ai_generation").properties;
		expect(generation.$ai_time_to_first_token).toBeUndefined();
		expect(generation).toMatchObject({
			$ai_latency: 0.01,
			$ai_input_tokens: 0,
			$ai_output_tokens: 0,
			$ai_total_tokens: 0,
			$ai_is_error: false,
		});
	});

	test("starts retry telemetry from agent_start and keeps one injected turn index", () => {
		let turnIndex = 3;
		const h = harness({ turnIndex: () => turnIndex, emitFailedEvent: false });
		const failure = assistant({ stopReason: "error", errorMessage: "model unavailable" });
		const recovered = assistant();

		h.agent.emit({ type: "agent_start" });
		h.agent.emit({ type: "turn_start" });
		h.agent.emit({ type: "message_end", message: failure });
		h.agent.emit({ type: "agent_end", messages: [failure] });
		h.at(10);
		h.agent.emit({ type: "agent_start" });
		h.agent.emit({ type: "turn_start" });
		h.agent.emit({ type: "message_end", message: recovered });
		h.agent.emit({ type: "agent_end", messages: [recovered] });

		const starts = h.captures.filter((capture) => capture.event === "agent_turn_started");
		expect(starts).toHaveLength(2);
		expect(starts.map((capture) => capture.properties.turn_index)).toEqual([3, 3]);
		expect(starts.map((capture) => capture.properties.run_id)).toEqual([
			"telemetry-1",
			"telemetry-3",
		]);
		expect(h.captures.some((capture) => capture.event === "agent_turn_failed")).toBe(false);
		turnIndex = 4;
	});

	test("unsubscribe cleans active state and prevents later captures", () => {
		const h = harness();
		h.agent.emit({ type: "agent_start" });
		h.agent.emit({
			type: "tool_execution_start",
			toolCallId: "private-call",
			toolName: "map",
			args: { private: true },
		});
		const countBeforeCleanup = h.captures.length;
		h.unsubscribe();
		h.agent.emit({ type: "agent_end", messages: [] });
		h.unsubscribe();
		expect(h.captures).toHaveLength(countBeforeCleanup);
	});

	test("emits one bounded completed-run envelope without changing PostHog payloads", () => {
		const envelopes: AgentTraceEnvelopeV1[] = [];
		const h = harness({
			onCompletedRun: (envelope) => envelopes.push(envelope),
			evaluationContent: () => ({ input: "explicitly shared input", output: "explicitly shared output" }),
			appVersion: "9.9.9-test",
		});
		const final = assistant({ usage: { ...EMPTY_USAGE, input: 7, output: 5, totalTokens: 12 } });
		h.agent.emit({ type: "agent_start" });
		h.at(10);
		h.agent.emit({ type: "turn_start" });
		h.at(50);
		h.agent.emit({ type: "message_end", message: final });
		h.agent.emit({ type: "agent_end", messages: [final] });

		expect(envelopes).toHaveLength(1);
		expect(envelopes[0]).toMatchObject({
			schema_version: 1,
			run_id: "telemetry-1",
			duration_ms: 50,
			app_version: "9.9.9-test",
			generation_count: 1,
			tool_count: 0,
			evaluation_content: { input: "explicitly shared input", output: "explicitly shared output" },
		});
		expect(envelopes[0].generations[0]).toMatchObject({
			client_span_id: "telemetry-2", start_offset_ms: 10, duration_ms: 40,
			input_tokens: 7, output_tokens: 5, total_tokens: 12,
		});
		assertNoPrivatePayload(h.captures, "explicitly shared input", "explicitly shared output");
	});
});
