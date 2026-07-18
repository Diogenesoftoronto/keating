import { afterEach, describe, expect, it } from "bun:test";
import {
	filterSessions,
	notifySessionsChanged,
	sortSessionsByLastModified,
} from "../hooks/use-sessions";
import type { SessionMetadata } from "../types/session";

const baseUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeSession(
	id: string,
	overrides: Partial<SessionMetadata> = {},
): SessionMetadata {
	return {
		id,
		title: `Session ${id}`,
		parentSessionId: null,
		forkedAt: undefined,
		createdAt: `2026-07-01T0${id}:00:00.000Z`,
		lastModified: `2026-07-01T0${id}:30:00.000Z`,
		messageCount: Number(id),
		usage: baseUsage,
		thinkingLevel: "medium",
		modelProvider: "openai",
		modelId: "gpt-5",
		preview: `Preview ${id}`,
		aiGeneratedTitle: false,
		...overrides,
	};
}

describe("use-sessions helpers", () => {
	const originalWindow = globalThis.window;

	afterEach(() => {
		if (originalWindow === undefined) {
			delete (globalThis as { window?: Window }).window;
			return;
		}
		Object.defineProperty(globalThis, "window", {
			value: originalWindow,
			configurable: true,
			writable: true,
		});
	});

	it("sorts sessions by lastModified descending", () => {
		const items = [
			makeSession("1", { lastModified: "2026-07-01T01:00:00.000Z" }),
			makeSession("2", { lastModified: "2026-07-01T03:00:00.000Z" }),
			makeSession("3", { lastModified: "2026-07-01T02:00:00.000Z" }),
		];

		expect(sortSessionsByLastModified(items).map((session) => session.id)).toEqual([
			"2",
			"3",
			"1",
		]);
	});

	it("filters against title, preview, and full message text case-insensitively", () => {
		const items = [
			makeSession("1", { title: "Quantum Basics", preview: "Wave functions" }),
			makeSession("2", { title: "History", preview: "Roman empire" }),
			makeSession("3", { title: "Code", preview: "Short summary", searchText: "The detailed turn mentions memoized recursion." }),
		];

		expect(filterSessions(items, "quantum").map((session) => session.id)).toEqual(["1"]);
		expect(filterSessions(items, "ROMAN").map((session) => session.id)).toEqual(["2"]);
		expect(filterSessions(items, "memoized").map((session) => session.id)).toEqual(["3"]);
		expect(filterSessions(items, "").map((session) => session.id)).toEqual(["1", "2", "3"]);
	});

	it("requires every query term to match somewhere in the session text", () => {
		const items = [
			makeSession("1", { title: "Quantum Basics", searchText: "Wave functions and superposition." }),
			makeSession("2", { title: "Quantum Circuits", searchText: "Gates and entanglement." }),
		];

		expect(filterSessions(items, "quantum superposition").map((session) => session.id)).toEqual(["1"]);
		expect(filterSessions(items, "quantum missing").map((session) => session.id)).toEqual([]);
	});

	it("falls back to backfilled full text for sessions without stored searchText", () => {
		const items = [
			makeSession("1", { title: "Old session", preview: "Preview only" }),
			makeSession("2", { title: "Other", preview: "Nothing here" }),
		];
		const fullTextById = new Map([["1", "A deep dive into monads and functors."]]);

		expect(filterSessions(items, "monads", fullTextById).map((session) => session.id)).toEqual(["1"]);
		expect(filterSessions(items, "monads").map((session) => session.id)).toEqual([]);
	});

	it("dispatches the shared sessions-changed event", () => {
		const target = new EventTarget();
		const windowStub = {
			addEventListener: target.addEventListener.bind(target),
			removeEventListener: target.removeEventListener.bind(target),
			dispatchEvent: target.dispatchEvent.bind(target),
		} as unknown as Window;
		Object.defineProperty(globalThis, "window", {
			value: windowStub,
			configurable: true,
			writable: true,
		});

		let fired = false;
		window.addEventListener("keating:sessions-changed", () => {
			fired = true;
		});

		notifySessionsChanged();

		expect(fired).toBe(true);
	});
});
