import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { KeatingLifecycle, KeatingLifecycleEvent } from "../keating/lifecycle";

export type SessionDebugEventKind = "agent" | "hook" | "lifecycle" | "stream" | "tool";

export interface SessionDebugEvent {
	id: number;
	timestamp: string;
	kind: SessionDebugEventKind;
	name: string;
	status?: "started" | "completed" | "failed" | "retrying";
	durationMs?: number;
	details?: unknown;
}

export interface SessionDebugToolRun {
	callId: string;
	name: string;
	status: "running" | "completed" | "failed";
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
	arguments?: unknown;
	result?: unknown;
}

export interface SessionDebugModelContext {
	capturedAt: string;
	source: "agent-state" | "provider-bound";
	provider: string;
	model: string;
	contextWindow: number | null;
	systemPrompt: string;
	messages: unknown[];
	tools: unknown[];
	messageRoles: Record<string, number>;
	characterCount: number;
	estimatedTokens: number;
}

export interface SessionDebugContextInput {
	systemPrompt?: string;
	messages: readonly unknown[];
	tools?: readonly unknown[];
}

export interface SessionDebugTransport {
	provider: string;
	model: string;
	transport: "browser" | "direct" | "hosted-capability" | "same-origin-proxy";
	hostedWebSearch: boolean;
	updatedAt: string;
}

export interface SessionDebugSnapshot {
	enabled: boolean;
	sessionId: string | null;
	latestEvent: SessionDebugEvent | null;
	latestHook: SessionDebugEvent | null;
	modelContext: SessionDebugModelContext | null;
	transport: SessionDebugTransport | null;
	toolRuns: readonly SessionDebugToolRun[];
	events: readonly SessionDebugEvent[];
}

const STORAGE_KEY = "keating_session_debug_enabled";
const MAX_EVENTS = 150;
const MAX_TOOL_RUNS = 75;
const MAX_STRING_LENGTH = 100_000;
const CREDENTIAL_FIELD = /^(?:api[-_]?key|authorization|cookie|credential|password|refresh[-_]?token|secret|token)$/i;
const BINARY_FIELD = /^(?:data|base64|bytes)$/i;

let nextId = 1;
let events: readonly SessionDebugEvent[] = [];
let toolRuns: readonly SessionDebugToolRun[] = [];
let modelContext: SessionDebugModelContext | null = null;
let transport: SessionDebugTransport | null = null;
let sessionId: string | null = null;
let enabled = readEnabled();
const toolStartedAt = new Map<string, number>();
const listeners = new Set<() => void>();
let cachedSnapshot: SessionDebugSnapshot | null = null;

function readEnabled(): boolean {
	try {
		return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

function notify(): void {
	cachedSnapshot = null;
	for (const listener of listeners) listener();
}

function nowIso(): string {
	return new Date().toISOString();
}

function debugClone(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
	if (CREDENTIAL_FIELD.test(key)) return "[credential omitted]";
	if (typeof value === "string") {
		if (BINARY_FIELD.test(key) && value.length > 1_000) return `[binary data omitted: ${value.length} characters]`;
		return value.length <= MAX_STRING_LENGTH
			? value
			: `${value.slice(0, MAX_STRING_LENGTH)}\n[truncated ${value.length - MAX_STRING_LENGTH} characters]`;
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (typeof value === "bigint") return String(value);
	if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
	if (Array.isArray(value)) return value.map((item) => debugClone(item, "", seen));
	if (typeof value !== "object") return String(value);
	if (seen.has(value)) return "[circular reference]";
	seen.add(value);
	const cloned: Record<string, unknown> = {};
	for (const [childKey, child] of Object.entries(value)) {
		const next = debugClone(child, childKey, seen);
		if (next !== undefined) cloned[childKey] = next;
	}
	seen.delete(value);
	return cloned;
}

function event(
	kind: SessionDebugEventKind,
	name: string,
	status?: SessionDebugEvent["status"],
	details?: unknown,
	durationMs?: number,
): SessionDebugEvent | null {
	if (!enabled) return null;
	const entry: SessionDebugEvent = {
		id: nextId++,
		timestamp: nowIso(),
		kind,
		name,
		...(status ? { status } : {}),
		...(durationMs !== undefined ? { durationMs } : {}),
		...(details !== undefined ? { details: debugClone(details) } : {}),
	};
	events = [...events.slice(-(MAX_EVENTS - 1)), entry];
	notify();
	return entry;
}

function roleCounts(messages: readonly unknown[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const message of messages) {
		const role = message && typeof message === "object" && typeof (message as { role?: unknown }).role === "string"
			? (message as { role: string }).role
			: "unknown";
		counts[role] = (counts[role] ?? 0) + 1;
	}
	return counts;
}

function serializedLength(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return 0;
	}
}

export function isSessionDebugEnabled(): boolean {
	return enabled;
}

export function setSessionDebugEnabled(next: boolean): void {
	enabled = next;
	try {
		localStorage.setItem(STORAGE_KEY, String(next));
	} catch {
		// Private/blocked storage still supports page-local debugging.
	}
	if (!next) clearSessionDebug();
	else {
		notify();
		if (typeof window !== "undefined") window.dispatchEvent(new Event("keating:session-debug-enabled"));
	}
}

export function subscribeSessionDebug(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getSessionDebugSnapshot(): SessionDebugSnapshot {
	cachedSnapshot ??= {
		enabled,
		sessionId,
		latestEvent: events.at(-1) ?? null,
		latestHook: [...events].reverse().find((entry) => entry.kind === "hook" || entry.kind === "lifecycle") ?? null,
		modelContext,
		transport,
		toolRuns,
		events,
	};
	return cachedSnapshot;
}

export function clearSessionDebug(): void {
	events = [];
	toolRuns = [];
	modelContext = null;
	transport = null;
	sessionId = null;
	toolStartedAt.clear();
	notify();
}

/** Capture provider-bound context, or a clearly marked preview of current agent state. */
export function captureSessionModelContext(
	model: Model<Api>,
	context: SessionDebugContextInput,
	source: SessionDebugModelContext["source"] = "provider-bound",
): void {
	if (!enabled) return;
	const messages = debugClone(context.messages) as unknown[];
	const tools = debugClone(context.tools ?? []) as unknown[];
	const systemPrompt = String(context.systemPrompt ?? "");
	const characterCount = systemPrompt.length + serializedLength(messages) + serializedLength(tools);
	modelContext = {
		capturedAt: nowIso(),
		source,
		provider: model.provider,
		model: model.id,
		contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
		systemPrompt,
		messages,
		tools,
		messageRoles: roleCounts(messages),
		characterCount,
		estimatedTokens: Math.ceil(characterCount / 4),
	};
	event("stream", "model_context_captured", "completed", {
		source,
		provider: model.provider,
		model: model.id,
		messages: messages.length,
		tools: tools.length,
		estimatedTokens: modelContext.estimatedTokens,
	});
}

export function recordSessionTransport(input: Omit<SessionDebugTransport, "updatedAt">): void {
	if (!enabled) return;
	transport = { ...input, updatedAt: nowIso() };
	event("stream", "transport_selected", "completed", input);
}

export function recordSessionRetryAttempt(provider: string, model: string, attempt: number): void {
	event("stream", "provider_attempt", attempt > 1 ? "retrying" : "started", {
		provider,
		model,
		attempt,
	});
}

export function recordSessionHook(
	name: string,
	status: "started" | "completed" | "failed",
	details?: unknown,
	durationMs?: number,
): void {
	event("hook", name, status, details, durationMs);
}

export function recordSessionDebugAgentEvent(agent: Agent, agentEvent: AgentEvent): void {
	if (!enabled || agentEvent.type === "message_update") return;
	sessionId = agent.sessionId ?? sessionId;
	if (agentEvent.type === "tool_execution_start") {
		const started = Date.now();
		toolStartedAt.set(agentEvent.toolCallId, started);
		toolRuns = [...toolRuns.slice(-(MAX_TOOL_RUNS - 1)), {
			callId: agentEvent.toolCallId,
			name: agentEvent.toolName,
			status: "running",
			startedAt: new Date(started).toISOString(),
			arguments: debugClone(agentEvent.args),
		}];
		event("tool", agentEvent.toolName, "started", { callId: agentEvent.toolCallId });
		return;
	}
	if (agentEvent.type === "tool_execution_end") {
		const completed = Date.now();
		const started = toolStartedAt.get(agentEvent.toolCallId) ?? completed;
		toolStartedAt.delete(agentEvent.toolCallId);
		const index = toolRuns.findIndex((run) => run.callId === agentEvent.toolCallId);
		const completedRun: SessionDebugToolRun = {
			...(index >= 0 ? toolRuns[index]! : {
				callId: agentEvent.toolCallId,
				name: agentEvent.toolName,
				startedAt: new Date(started).toISOString(),
			}),
			status: agentEvent.isError ? "failed" : "completed",
			completedAt: new Date(completed).toISOString(),
			durationMs: Math.max(0, completed - started),
			result: debugClone(agentEvent.result),
		};
		toolRuns = index >= 0
			? toolRuns.map((run, runIndex) => runIndex === index ? completedRun : run)
			: [...toolRuns.slice(-(MAX_TOOL_RUNS - 1)), completedRun];
		event("tool", agentEvent.toolName, agentEvent.isError ? "failed" : "completed", {
			callId: agentEvent.toolCallId,
		}, completedRun.durationMs);
		return;
	}
	if (agentEvent.type === "agent_end") {
		const lastAssistant = [...agentEvent.messages].reverse().find((message) =>
			message && typeof message === "object" && (message as { role?: unknown }).role === "assistant"
		) as { __keatingRetryAttempts?: number; __keatingRetryExhausted?: boolean; stopReason?: string } | undefined;
		event("agent", agentEvent.type, "completed", {
			messageCount: agentEvent.messages.length,
			stopReason: lastAssistant?.stopReason ?? "unknown",
			retryAttempts: lastAssistant?.__keatingRetryAttempts ?? 1,
			retryExhausted: lastAssistant?.__keatingRetryExhausted ?? false,
		});
		return;
	}
	event("agent", agentEvent.type, agentEvent.type.endsWith("start") ? "started" : "completed");
}

export function subscribeLifecycleDebug(lifecycle: KeatingLifecycle): () => void {
	const types: KeatingLifecycleEvent["type"][] = [
		"session_start",
		"before_turn",
		"interaction_committed",
		"artifact_finalized",
		"session_idle",
		"session_end",
		"topic_shift",
	];
	const unsubscribers = types.map((type) => lifecycle.on(type, (lifecycleEvent) => {
		if (!enabled) return;
		sessionId = lifecycleEvent.sessionId;
		event("lifecycle", lifecycleEvent.type, "completed", lifecycleEvent);
	}));
	return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function buildRawSessionDebugReport(snapshot = getSessionDebugSnapshot()): string {
	return `${JSON.stringify({
		schemaVersion: 1,
		generatedAt: nowIso(),
		notice: "Sensitive local session debug export. It can contain model-facing prompts, conversation text, and tool payloads. Credential-named fields and large binary values are omitted.",
		...snapshot,
	}, null, 2)}\n`;
}
