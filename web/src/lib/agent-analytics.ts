import type {
	Agent,
	AgentEvent,
	AgentMessage,
	AgentState,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import { classifyLlmError, type LlmErrorCategory } from "../core/api-retry";
import { toolExecutionSucceeded } from "../keating/tool-result";

export type AgentAnalyticsProperties = Record<
	string,
	string | number | boolean | null | undefined
>;

export type AgentAnalyticsCapture = (
	event: string,
	properties: AgentAnalyticsProperties,
) => unknown;

export interface AgentAnalyticsModel {
	id: string;
	provider: string;
}

export interface AgentAnalyticsOptions {
	capture: AgentAnalyticsCapture;
	sessionId: string | (() => string);
	now?: () => number;
	createId?: () => string;
	getModel?: () => AgentAnalyticsModel | null | undefined;
	getSource?: () => string | null | undefined;
	getTurnIndex?: () => number;
	appVersion?: string;
	isArtifactTool?: (toolName: string) => boolean;
	emitFailedEvent?: boolean;
	onCompletedRun?: (envelope: AgentTraceEnvelopeV1) => unknown;
	getEvaluationContent?: () => { input: string; output: string } | undefined;
}

export const AGENT_TRACE_ENVELOPE_VERSION = 1 as const;
export interface AgentTraceGenerationV1 {
	client_span_id: string;
	provider: string;
	model: string;
	start_offset_ms: number;
	duration_ms: number;
	ttft_ms?: number;
	stop_reason?: string;
	status: AgentAnalyticsStatus;
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
	total_cost_usd?: number;
}
export interface AgentTraceToolV1 {
	client_call_id: string;
	name: string;
	start_offset_ms: number;
	duration_ms: number;
	status: "success" | "error";
	is_artifact: boolean;
}
export interface AgentTraceEnvelopeV1 {
	schema_version: typeof AGENT_TRACE_ENVELOPE_VERSION;
	run_id: string;
	session_id: string;
	turn_index: number;
	provider: string;
	model: string;
	source: string;
	status: AgentAnalyticsStatus;
	error_category?: LlmErrorCategory;
	duration_ms: number;
	generation_count: number;
	tool_count: number;
	app_version: string;
	surface: "web";
	generations: AgentTraceGenerationV1[];
	tools: AgentTraceToolV1[];
	evaluation_content?: { input: string; output: string };
}

type AgentAnalyticsStatus = "success" | "error" | "aborted";

interface RunTelemetry {
	runId: string;
	traceId: string;
	sessionId: string;
	turnIndex: number;
	startedAt: number;
	model: AgentAnalyticsModel;
	source: string;
	appVersion: string;
	status: AgentAnalyticsStatus;
	errorCategory?: LlmErrorCategory;
	generationCount: number;
	toolCount: number;
	generation?: GenerationTelemetry;
	tools: Map<string, ToolTelemetry>;
	completedGenerations: AgentTraceGenerationV1[];
	completedTools: AgentTraceToolV1[];
}

interface GenerationTelemetry {
	spanId: string;
	startedAt: number;
	firstTokenAt?: number;
	model: AgentAnalyticsModel;
}

interface ToolTelemetry {
	startedAt: number;
	toolName: string;
}

export interface AgentAnalyticsAgent {
	readonly state: Pick<AgentState, "messages" | "model">;
	subscribe(
		listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
	): () => void;
}

function defaultNow(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function defaultId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safeValue<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch {
		return fallback;
	}
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function elapsed(startedAt: number, endedAt: number): number {
	return Math.max(0, endedAt - startedAt);
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return Boolean(message && typeof message === "object" && message.role === "assistant");
}

function modelFrom(value: Model<string> | AgentAnalyticsModel | null | undefined): AgentAnalyticsModel {
	if (!value || typeof value !== "object") return { id: "unknown", provider: "unknown" };
	return {
		id: typeof value.id === "string" && value.id ? value.id : "unknown",
		provider:
			typeof value.provider === "string" && value.provider
				? value.provider
				: "unknown",
	};
}

function modelFromMessage(
	message: AssistantMessage,
	fallback: AgentAnalyticsModel,
): AgentAnalyticsModel {
	return {
		id: message.responseModel || message.model || fallback.id,
		provider: message.provider || fallback.provider,
	};
}

function countUserMessages(messages: readonly AgentMessage[]): number {
	return messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);
}

function isTokenDelta(event: AgentEvent & { type: "message_update" }): boolean {
	const update = event.assistantMessageEvent;
	return (
		(update.type === "text_delta" ||
			update.type === "thinking_delta" ||
			update.type === "toolcall_delta") &&
		update.delta.length > 0
	);
}

function usageProperties(usage: Usage | undefined): AgentAnalyticsProperties {
	if (!usage) return {};
	const properties: AgentAnalyticsProperties = {};
	if (finite(usage.input)) properties.$ai_input_tokens = usage.input;
	if (finite(usage.output)) properties.$ai_output_tokens = usage.output;
	if (finite(usage.totalTokens)) properties.$ai_total_tokens = usage.totalTokens;
	if (finite(usage.cacheRead)) {
		properties.$ai_cache_read_input_tokens = usage.cacheRead;
	}
	if (finite(usage.cacheWrite)) {
		properties.$ai_cache_creation_input_tokens = usage.cacheWrite;
	}
	if (finite(usage.cacheWrite1h)) {
		properties.$ai_cache_creation_1h_input_tokens = usage.cacheWrite1h;
	}
	if (usage.cost) {
		if (finite(usage.cost.input)) properties.$ai_input_cost_usd = usage.cost.input;
		if (finite(usage.cost.output)) properties.$ai_output_cost_usd = usage.cost.output;
		if (finite(usage.cost.cacheRead)) {
			properties.$ai_cache_read_cost_usd = usage.cost.cacheRead;
		}
		if (finite(usage.cost.cacheWrite)) {
			properties.$ai_cache_write_cost_usd = usage.cost.cacheWrite;
		}
		if (finite(usage.cost.total)) properties.$ai_total_cost_usd = usage.cost.total;
	}
	return properties;
}

function boundedText(value: string): string {
	return value.slice(0, 16_000);
}

function completedEnvelope(
	run: RunTelemetry,
	endedAt: number,
	content: { input: string; output: string } | undefined,
): AgentTraceEnvelopeV1 {
	const generations = run.completedGenerations.slice(0, 32);
	const tools = run.completedTools.slice(0, 32);
	return {
		schema_version: AGENT_TRACE_ENVELOPE_VERSION,
		run_id: run.runId,
		session_id: run.sessionId,
		turn_index: run.turnIndex,
		provider: run.model.provider,
		model: run.model.id,
		source: run.source,
		status: run.status,
		...(run.errorCategory ? { error_category: run.errorCategory } : {}),
		duration_ms: elapsed(run.startedAt, endedAt),
		generation_count: generations.length,
		tool_count: tools.length,
		app_version: run.appVersion,
		surface: "web",
		generations,
		tools,
		...(content ? { evaluation_content: { input: boundedText(content.input), output: boundedText(content.output) } } : {}),
	};
}

/**
 * Subscribe PostHog-compatible behavioral and LLM telemetry to a Pi Agent.
 *
 * This boundary deliberately accepts only behavioral identifiers and numeric
 * usage data. Prompt/response content, tool arguments/results, and raw errors
 * are never added to a capture payload.
 */
export function subscribeAgentAnalytics(
	agent: Agent | AgentAnalyticsAgent,
	options: AgentAnalyticsOptions,
): () => void {
	const now = options.now ?? defaultNow;
	const createId = options.createId ?? defaultId;
	let activeRun: RunTelemetry | undefined;
	let disposed = false;

	const capture = (event: string, properties: AgentAnalyticsProperties): void => {
		if (disposed) return;
		try {
			options.capture(event, properties);
		} catch {
			// Analytics must never interrupt an agent run.
		}
	};

	const readSessionId = (): string =>
		typeof options.sessionId === "function"
			? safeValue(options.sessionId, "unknown")
			: options.sessionId;

	const readModel = (): AgentAnalyticsModel =>
		modelFrom(
			options.getModel
				? safeValue(options.getModel, null)
				: safeValue(() => agent.state.model, null),
		);

	const readSource = (): string => {
		const value = options.getSource
			? safeValue(options.getSource, null)
			: undefined;
		return typeof value === "string" && value ? value : "unknown";
	};

	const readTurnIndex = (): number => {
		const value = options.getTurnIndex
			? safeValue(options.getTurnIndex, 0)
			: safeValue(() => countUserMessages(agent.state.messages), 0);
		return finite(value) ? Math.max(0, Math.floor(value)) : 0;
	};

	const runProperties = (
		run: RunTelemetry,
		endedAt: number,
	): AgentAnalyticsProperties => ({
		session_id: run.sessionId,
		turn_index: run.turnIndex,
		run_id: run.runId,
		trace_id: run.traceId,
		turn_number: run.turnIndex + 1,
		model: `${run.model.provider}/${run.model.id}`,
		provider: run.model.provider,
		source: run.source,
		duration_ms: elapsed(run.startedAt, endedAt),
		success: run.status === "success",
		status: run.status,
		outcome:
			run.status === "success"
				? "completed"
				: run.status === "aborted"
					? "cancelled"
					: "error",
		generation_count: run.generationCount,
		tool_count: run.toolCount,
		error_type: run.errorCategory,
		error_category: run.errorCategory,
	});

	const finishGeneration = (
		run: RunTelemetry,
		message: AssistantMessage,
		endedAt: number,
	): void => {
		const generation = run.generation ?? {
			spanId: createId(),
			startedAt: run.startedAt,
			model: run.model,
		};
		const model = modelFromMessage(message, generation.model);
		const failed = message.stopReason === "error" || message.stopReason === "aborted";
		capture("$ai_generation", {
			session_id: run.sessionId,
			turn_index: run.turnIndex,
			run_id: run.runId,
			trace_id: run.traceId,
			$ai_trace_id: run.traceId,
			$ai_session_id: run.sessionId,
			$ai_span_id: generation.spanId,
			$ai_model: model.id,
			$ai_provider: model.provider,
			$ai_latency: elapsed(generation.startedAt, endedAt) / 1_000,
			$ai_time_to_first_token:
				generation.firstTokenAt === undefined
					? undefined
					: elapsed(generation.startedAt, generation.firstTokenAt) / 1_000,
			$ai_stream: true,
			$ai_is_error: failed,
			$ai_stop_reason: message.stopReason,
			error_category: failed
				? classifyLlmError(message.errorMessage ?? message.stopReason).category
				: undefined,
			...usageProperties(message.usage),
		});
		run.generationCount += 1;
		run.generation = undefined;

		if (failed) {
			run.status = message.stopReason === "aborted" ? "aborted" : "error";
			run.errorCategory = classifyLlmError(
				message.errorMessage ?? message.stopReason,
			).category;
		}
		run.completedGenerations.push({
			client_span_id: generation.spanId,
			provider: model.provider,
			model: model.id,
			start_offset_ms: elapsed(run.startedAt, generation.startedAt),
			duration_ms: elapsed(generation.startedAt, endedAt),
			...(generation.firstTokenAt === undefined ? {} : { ttft_ms: elapsed(generation.startedAt, generation.firstTokenAt) }),
			...(message.stopReason ? { stop_reason: message.stopReason } : {}),
			status: failed ? (message.stopReason === "aborted" ? "aborted" : "error") : "success",
			...(finite(message.usage?.input) ? { input_tokens: message.usage?.input } : {}),
			...(finite(message.usage?.output) ? { output_tokens: message.usage?.output } : {}),
			...(finite(message.usage?.totalTokens) ? { total_tokens: message.usage?.totalTokens } : {}),
			...(finite(message.usage?.cost?.total) ? { total_cost_usd: message.usage?.cost?.total } : {}),
		});
	};

	const listener = (event: AgentEvent, signal: AbortSignal): void => {
		const at = now();
		switch (event.type) {
			case "agent_start": {
				const runId = createId();
				activeRun = {
					runId,
					traceId: runId,
					sessionId: readSessionId(),
					turnIndex: readTurnIndex(),
					startedAt: at,
					model: readModel(),
					source: readSource(),
					appVersion: options.appVersion ?? "dev",
					status: "success",
					generationCount: 0,
					toolCount: 0,
					tools: new Map(),
					completedGenerations: [],
					completedTools: [],
				};
				capture("agent_turn_started", {
					session_id: activeRun.sessionId,
					turn_index: activeRun.turnIndex,
					run_id: activeRun.runId,
					trace_id: activeRun.traceId,
					turn_number: activeRun.turnIndex + 1,
					model: `${activeRun.model.provider}/${activeRun.model.id}`,
					provider: activeRun.model.provider,
					source: activeRun.source,
					status: "started",
				});
				break;
			}

			case "turn_start":
				if (activeRun) {
					activeRun.generation = {
						spanId: createId(),
						startedAt: at,
						model: readModel(),
					};
				}
				break;

			case "message_start":
				if (activeRun && isAssistantMessage(event.message)) {
					activeRun.generation ??= {
						spanId: createId(),
						startedAt: at,
						model: modelFromMessage(event.message, activeRun.model),
					};
				}
				break;

			case "message_update":
				if (
					activeRun?.generation &&
					activeRun.generation.firstTokenAt === undefined &&
					isAssistantMessage(event.message) &&
					isTokenDelta(event)
				) {
					activeRun.generation.firstTokenAt = at;
				}
				break;

			case "message_end":
				if (activeRun && isAssistantMessage(event.message)) {
					finishGeneration(activeRun, event.message, at);
				}
				break;

			case "turn_end":
				if (activeRun?.generation && isAssistantMessage(event.message)) {
					finishGeneration(activeRun, event.message, at);
				}
				break;

			case "tool_execution_start":
				if (activeRun) {
					activeRun.tools.set(event.toolCallId, {
						startedAt: at,
						toolName: event.toolName,
					});
					capture("tool_invocation_started", {
						session_id: activeRun.sessionId,
						turn_index: activeRun.turnIndex,
						run_id: activeRun.runId,
						trace_id: activeRun.traceId,
						tool_call_id: event.toolCallId,
						tool_name: event.toolName,
						status: "started",
					});
				}
				break;

			case "tool_execution_end":
				if (activeRun) {
					const succeeded = toolExecutionSucceeded(event);
					const tool = activeRun.tools.get(event.toolCallId);
					activeRun.tools.delete(event.toolCallId);
					activeRun.toolCount += 1;
					activeRun.completedTools.push({
						client_call_id: event.toolCallId,
						name: tool?.toolName ?? event.toolName,
						start_offset_ms: tool ? elapsed(activeRun.startedAt, tool.startedAt) : elapsed(activeRun.startedAt, at),
						duration_ms: tool ? elapsed(tool.startedAt, at) : 0,
						status: succeeded ? "success" : "error",
						is_artifact: options.isArtifactTool?.(event.toolName) ?? false,
					});
					capture("tool_invoked", {
						session_id: activeRun.sessionId,
						turn_index: activeRun.turnIndex,
						run_id: activeRun.runId,
						trace_id: activeRun.traceId,
						tool_call_id: event.toolCallId,
						tool_name: tool?.toolName ?? event.toolName,
						duration_ms: tool ? elapsed(tool.startedAt, at) : 0,
						success: succeeded,
						status: succeeded ? "success" : "error",
						is_artifact: options.isArtifactTool?.(event.toolName) ?? false,
					});
				}
				break;

			case "agent_end":
				if (activeRun) {
					if (signal.aborted && activeRun.status === "success") {
						activeRun.status = "aborted";
						activeRun.errorCategory = "aborted";
					}
					const properties = runProperties(activeRun, at);
					capture("agent_turn_completed", properties);
					if (activeRun.status !== "success" && options.emitFailedEvent !== false) {
						capture("agent_turn_failed", properties);
					}
					try {
						void Promise.resolve(options.onCompletedRun?.(completedEnvelope(
							activeRun,
							at,
							options.getEvaluationContent ? safeValue(options.getEvaluationContent, undefined) : undefined,
						))).catch(() => undefined);
					} catch {
						// Trace submission must never interrupt a completed turn.
					}
					activeRun.generation = undefined;
					activeRun.tools.clear();
					activeRun = undefined;
				}
				break;
		}
	};

	const unsubscribe = agent.subscribe(listener);
	return () => {
		if (disposed) return;
		disposed = true;
		unsubscribe();
		activeRun?.tools.clear();
		activeRun = undefined;
	};
}
