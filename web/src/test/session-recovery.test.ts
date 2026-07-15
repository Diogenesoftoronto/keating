import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	INTERRUPTED_RESPONSE_MESSAGE,
	isRetryableAssistantMessage,
	messagesForSessionSnapshot,
	prepareMessagesForRetry,
} from "../hooks/session-recovery";

const user = (text = "hello") => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: 1,
}) as AgentMessage;

const assistant = (stopReason: "stop" | "error" | "aborted" | undefined, text = "reply") => ({
	role: "assistant",
	content: [{ type: "text", text }],
	stopReason,
	timestamp: 2,
}) as AgentMessage;

describe("session interruption recovery", () => {
	it("stores a live assistant response as an interrupted, retryable message", () => {
		const snapshot = messagesForSessionSnapshot([user()], assistant(undefined, "partial reply"));
		expect(snapshot.interrupted).toBe(true);
		expect(snapshot.messages).toHaveLength(2);
		expect((snapshot.messages[1] as any).stopReason).toBe("aborted");
		expect((snapshot.messages[1] as any).errorMessage).toBe(INTERRUPTED_RESPONSE_MESSAGE);
		expect(isRetryableAssistantMessage(snapshot.messages[1])).toBe(true);
	});

	it("does not append a non-assistant streaming message", () => {
		const snapshot = messagesForSessionSnapshot([], user());
		expect(snapshot).toEqual({ messages: [], interrupted: false });
	});

	it("removes only the trailing failed response before retrying", () => {
		const prompt = user();
		const retryMessages = prepareMessagesForRetry([prompt, assistant("error")]);
		expect(retryMessages).toEqual([prompt]);
		expect(retryMessages).not.toBe([prompt]);
	});

	it("does not retry a completed or non-trailing failure", () => {
		expect(prepareMessagesForRetry([user(), assistant("stop")])).toBeNull();
		expect(prepareMessagesForRetry([user(), assistant("error"), user("later")])).toBeNull();
	});

	it("preserves valid turn context even when a custom message precedes the failure", () => {
		const prompt = user();
		const contextNotice = {
			role: "custom",
			customType: "session-context",
			content: "Learner context loaded",
		} as unknown as AgentMessage;
		const retryMessages = prepareMessagesForRetry([prompt, contextNotice, assistant("error")]);

		expect(retryMessages).toEqual([prompt, contextNotice]);
	});

	it("does not continue an orphaned failed response without a user turn", () => {
		expect(prepareMessagesForRetry([assistant("error")])).toBeNull();
	});
});
