import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { truncateAtForkPoint } from "../hooks/session-metadata";

// Minimal message factories — truncateAtForkPoint only reads `role` and `timestamp`.
const user = (timestamp: number): AgentMessage =>
	({ role: "user", content: "q", timestamp }) as unknown as AgentMessage;
const assistant = (timestamp: number): AgentMessage =>
	({ role: "assistant", content: "a", timestamp }) as unknown as AgentMessage;
const toolResult = (timestamp: number): AgentMessage =>
	({ role: "toolResult", content: "r", timestamp }) as unknown as AgentMessage;

const roles = (messages: AgentMessage[]) =>
	messages.map((m) => (m as { role?: string }).role);

describe("truncateAtForkPoint", () => {
	it("returns the full list when no fork point is given", () => {
		const messages = [user(1), assistant(2), user(3), assistant(4)];
		expect(truncateAtForkPoint(messages, undefined)).toBe(messages);
	});

	it("ends the session right after the forked assistant turn", () => {
		const messages = [user(1), assistant(2), user(3), assistant(4)];
		// Fork at the first assistant reply (timestamp 2) → drop the later turn.
		expect(truncateAtForkPoint(messages, 2)).toEqual([user(1), assistant(2)]);
	});

	it("keeps the tool results that belong to the forked turn", () => {
		const messages = [
			user(1),
			assistant(2),
			toolResult(3),
			toolResult(4),
			user(5),
			assistant(6),
		];
		// Forking at assistant(2) keeps its trailing tool results, stops at the next user.
		expect(roles(truncateAtForkPoint(messages, 2))).toEqual([
			"user",
			"assistant",
			"toolResult",
			"toolResult",
		]);
	});

	it("matches the merged-turn timestamp (last assistant of a run)", () => {
		// A displayed turn can merge consecutive assistants; its rendered timestamp is
		// the LAST assistant's. Forking at that timestamp keeps the whole merged run.
		const messages = [
			user(1),
			assistant(2),
			toolResult(3),
			assistant(4),
			user(5),
		];
		expect(roles(truncateAtForkPoint(messages, 4))).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
	});

	it("keeps everything when forking at the final reply", () => {
		const messages = [user(1), assistant(2), user(3), assistant(4)];
		expect(truncateAtForkPoint(messages, 4)).toEqual(messages);
	});

	it("falls back to the full list when the timestamp matches nothing", () => {
		const messages = [user(1), assistant(2), user(3)];
		expect(truncateAtForkPoint(messages, 999)).toBe(messages);
	});

	it("does not mutate the input array", () => {
		const messages = [user(1), assistant(2), user(3), assistant(4)];
		const snapshot = [...messages];
		truncateAtForkPoint(messages, 2);
		expect(messages).toEqual(snapshot);
	});
});
