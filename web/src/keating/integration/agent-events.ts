import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { ConversationRuntime } from "./conversation-runtime";
import { jsonSafe } from "./conversation-runtime";
import { toolExecutionSucceeded } from "../tool-result";

const messageIds = new WeakMap<object, string>();
let messageCounter = 0;

function messageId(message: AgentMessage): string {
	if (!message || typeof message !== "object") return `message-${++messageCounter}`;
	let id = messageIds.get(message);
	if (!id) {
		const candidate = message as { responseId?: unknown; toolCallId?: unknown; timestamp?: unknown };
		id = String(candidate.responseId ?? candidate.toolCallId ?? `message-${candidate.timestamp ?? ++messageCounter}`);
		messageIds.set(message, id);
	}
	return id;
}

function toolFailureMessage(result: unknown): string {
	const content = (result as { content?: unknown })?.content;
	if (Array.isArray(content)) {
		const text = content
			.map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text"
				? (part as { text?: unknown }).text
				: "")
			.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
			.join("\n");
		if (text) return text;
	}
	const details = (result as { details?: unknown })?.details;
	if (details && typeof details === "object" && typeof (details as { message?: unknown }).message === "string") {
		return (details as { message: string }).message;
	}
	return "Tool execution failed.";
}

function runCompletionReason(messages: AgentMessage[]): "completed" | "cancelled" | "error" {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") continue;
		if (message.stopReason === "error") return "error";
		if (message.stopReason === "aborted") return "cancelled";
		return "completed";
	}
	return "completed";
}

export function recordAgentEvent(runtime: ConversationRuntime, event: AgentEvent): void {
	switch (event.type) {
		case "agent_start":
			runtime.emit("run.started", { mode: "text" });
			break;
		case "message_update":
			if (event.assistantMessageEvent.type === "text_delta") {
				runtime.emit("text.delta", { messageId: messageId(event.message), role: "assistant", delta: event.assistantMessageEvent.delta });
			}
			break;
		case "message_end":
			runtime.emit("message.completed", { messageId: messageId(event.message) });
			break;
		case "tool_execution_start":
			runtime.emit("tool.requested", { callId: event.toolCallId, name: event.toolName, arguments: jsonSafe(event.args) as Record<string, never> });
			runtime.emit("tool.started", { callId: event.toolCallId });
			break;
		case "tool_execution_update":
			runtime.emit("tool.progress", { callId: event.toolCallId, update: jsonSafe(event.partialResult) });
			break;
		case "tool_execution_end":
			if (!toolExecutionSucceeded(event)) runtime.emit("tool.failed", { callId: event.toolCallId, error: { code: "tool-error", message: toolFailureMessage(event.result) } });
			else runtime.emit("tool.completed", { callId: event.toolCallId, result: jsonSafe(event.result) });
			break;
		case "agent_end":
			runtime.emit("run.completed", { reason: runCompletionReason(event.messages) });
			break;
	}
}
