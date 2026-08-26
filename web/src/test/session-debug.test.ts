import { beforeEach, describe, expect, it } from "bun:test";
import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	buildRawSessionDebugReport,
	captureSessionModelContext,
	clearSessionDebug,
	getSessionDebugSnapshot,
	recordSessionDebugAgentEvent,
	recordSessionRetryAttempt,
	setSessionDebugEnabled,
} from "../lib/session-debug";

const model = {
	provider: "test-provider",
	id: "test-model",
	contextWindow: 8_192,
} as Model<Api>;

function fakeAgent(): Agent {
	return { sessionId: "session-debug-test" } as Agent;
}

describe("sensitive session debugging", () => {
	beforeEach(() => {
		setSessionDebugEnabled(false);
		clearSessionDebug();
	});

	it("captures nothing until the user explicitly opts in", () => {
		captureSessionModelContext(model, {
			systemPrompt: "private prompt",
			messages: [{ role: "user", content: "private question" }],
			tools: [],
		});
		expect(getSessionDebugSnapshot().modelContext).toBeNull();
	});

	it("shows supplied context, role counts, tool definitions, and an approximate size", () => {
		setSessionDebugEnabled(true);
		captureSessionModelContext(model, {
			systemPrompt: "Teach carefully.",
			messages: [
				{ role: "user", content: "Explain vectors" },
				{ role: "assistant", content: [{ type: "text", text: "What do you know?" }] },
			],
			tools: [{ name: "quiz", description: "Create a quiz", parameters: { type: "object" } }],
		});

		const context = getSessionDebugSnapshot().modelContext;
		expect(context).toMatchObject({
			source: "provider-bound",
			provider: "test-provider",
			model: "test-model",
			contextWindow: 8_192,
			messageRoles: { user: 1, assistant: 1 },
		});
		expect(context?.estimatedTokens).toBeGreaterThan(10);
		expect(context?.tools).toHaveLength(1);
	});

	it("records tool arguments, failures, results, and lifecycle duration", () => {
		setSessionDebugEnabled(true);
		const agent = fakeAgent();
		recordSessionDebugAgentEvent(agent, {
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "lookup",
			args: { topic: "vectors" },
		} as AgentEvent);
		recordSessionDebugAgentEvent(agent, {
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "lookup",
			result: { content: [{ type: "text", text: "network failed" }] },
			isError: true,
		} as AgentEvent);

		const snapshot = getSessionDebugSnapshot();
		expect(snapshot.sessionId).toBe("session-debug-test");
		expect(snapshot.toolRuns[0]).toMatchObject({
			callId: "call-1",
			name: "lookup",
			status: "failed",
			arguments: { topic: "vectors" },
		});
		expect(snapshot.toolRuns[0]?.durationMs).toBeGreaterThanOrEqual(0);
		expect(snapshot.latestEvent).toMatchObject({ kind: "tool", name: "lookup", status: "failed" });
	});

	it("makes automatic provider attempts and retries visible", () => {
		setSessionDebugEnabled(true);
		recordSessionRetryAttempt("openai", "gpt-test", 1);
		recordSessionRetryAttempt("openai", "gpt-test", 2);
		expect(getSessionDebugSnapshot().events.slice(-2)).toMatchObject([
			{ kind: "stream", name: "provider_attempt", status: "started", details: { attempt: 1 } },
			{ kind: "stream", name: "provider_attempt", status: "retrying", details: { attempt: 2 } },
		]);
	});

	it("omits credential-named fields and large binary values from raw local reports", () => {
		setSessionDebugEnabled(true);
		const agent = fakeAgent();
		recordSessionDebugAgentEvent(agent, {
			type: "tool_execution_start",
			toolCallId: "call-secret",
			toolName: "upload",
			args: { apiKey: "sk-do-not-export", data: "a".repeat(1_100), label: "diagram" },
		} as AgentEvent);

		const report = buildRawSessionDebugReport();
		expect(report).not.toContain("sk-do-not-export");
		expect(report).not.toContain("a".repeat(1_100));
		expect(report).toContain("[credential omitted]");
		expect(report).toContain("[binary data omitted: 1100 characters]");
	});
});
