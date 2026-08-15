import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { StorageConversationEventStore } from "../../keating/event-store";
import { createConversationRuntime, recordAgentEvent } from "../../keating/integration";

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}

function assistant(stopReason: "stop" | "error" | "aborted", errorMessage?: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "private response content" }],
		stopReason,
		errorMessage,
	} as AgentMessage;
}

function completionState(messages: AgentMessage[]) {
	const runtime = createConversationRuntime({
		sessionId: "session-1",
		runId: "run-1",
		store: new StorageConversationEventStore(new MemoryStorage()),
	});
	recordAgentEvent(runtime, { type: "agent_end", messages } as AgentEvent);
	return runtime.replay();
}

describe("agent event integration", () => {
	test("records a terminal event without a result as a tool failure", () => {
		const runtime = createConversationRuntime({
			sessionId: "session-1",
			runId: "run-1",
			store: new StorageConversationEventStore(new MemoryStorage()),
		});
		recordAgentEvent(runtime, {
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "web_search",
			args: {},
		} as AgentEvent);
		recordAgentEvent(runtime, {
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "web_search",
			result: undefined,
			isError: false,
		} as AgentEvent);

		const state = runtime.replay();
		expect(state.toolCalls["call-1"]?.status).toBe("failed");
	});

	test("classifies an ordinary assistant stop as completed", () => {
		const state = completionState([assistant("stop")]);

		expect(state.status).toBe("completed");
		expect(state.completionReason).toBe("completed");
	});

	test("classifies a provider error from the final assistant message without persisting its content", () => {
		const state = completionState([
			assistant("stop"),
			assistant("error", "sensitive provider diagnostic"),
		]);

		expect(state.status).toBe("error");
		expect(state.completionReason).toBe("error");
		expect(state.messages).toEqual({});
		expect(state.errors).toEqual([]);
	});

	test("classifies an aborted assistant turn as cancelled", () => {
		const state = completionState([assistant("aborted", "request aborted")]);

		expect(state.status).toBe("completed");
		expect(state.completionReason).toBe("cancelled");
	});
});
