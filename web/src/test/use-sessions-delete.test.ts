import { afterEach, describe, expect, it } from "bun:test";
import { sessions } from "../hooks/keating-storage";
import { deleteSavedSession } from "../hooks/use-sessions";

const originalWindow = globalThis.window;
const originalDeleteSession = sessions.deleteSession;

function installWindow(localStorage: Storage): EventTarget {
	const target = new EventTarget();
	Object.defineProperty(globalThis, "window", {
		value: {
			localStorage,
			addEventListener: target.addEventListener.bind(target),
			removeEventListener: target.removeEventListener.bind(target),
			dispatchEvent: target.dispatchEvent.bind(target),
		} as unknown as Window,
		configurable: true,
		writable: true,
	});
	return target;
}

function memoryStorage(initial: Record<string, string>): Storage {
	const values = new Map(Object.entries(initial));
	return {
		get length() {
			return values.size;
		},
		clear() {
			values.clear();
		},
		getItem(key) {
			return values.get(key) ?? null;
		},
		key(index) {
			return [...values.keys()][index] ?? null;
		},
		removeItem(key) {
			values.delete(key);
		},
		setItem(key, value) {
			values.set(key, value);
		},
	};
}

describe("saved session deletion", () => {
	afterEach(() => {
		sessions.deleteSession = originalDeleteSession;
		Object.defineProperty(globalThis, "window", {
			value: originalWindow,
			configurable: true,
			writable: true,
		});
	});

	it("clears auxiliary conversation events and notifies session listeners", async () => {
		const sessionId = "lesson/one";
		const sessionKey = `keating:conversation-events:v1:session:${encodeURIComponent(sessionId)}`;
		const indexKey = "keating:conversation-events:v1:sessions";
		const storage = memoryStorage({
			[sessionKey]: JSON.stringify({ format: 1, events: [], pendingActions: [] }),
			[indexKey]: JSON.stringify({
				format: 1,
				sessions: [
					{ id: sessionId, updatedAt: 10 },
					{ id: "lesson-two", updatedAt: 20 },
				],
			}),
		});
		installWindow(storage);

		const deleted: string[] = [];
		sessions.deleteSession = async (id) => {
			deleted.push(id);
		};
		let notifications = 0;
		window.addEventListener("keating:sessions-changed", () => notifications++);

		await deleteSavedSession(sessionId);

		expect(deleted).toEqual([sessionId]);
		expect(storage.getItem(sessionKey)).toBeNull();
		expect(JSON.parse(storage.getItem(indexKey) ?? "null")).toEqual({
			format: 1,
			sessions: [{ id: "lesson-two", updatedAt: 20 }],
		});
		expect(notifications).toBe(1);
	});

	it("keeps a successful primary deletion successful when localStorage fails", async () => {
		const target = new EventTarget();
		Object.defineProperty(globalThis, "window", {
			value: {
				get localStorage() {
					throw new DOMException("Storage is unavailable", "SecurityError");
				},
				addEventListener: target.addEventListener.bind(target),
				removeEventListener: target.removeEventListener.bind(target),
				dispatchEvent: target.dispatchEvent.bind(target),
			} as unknown as Window,
			configurable: true,
			writable: true,
		});

		let deleted = false;
		sessions.deleteSession = async () => {
			deleted = true;
		};
		let notifications = 0;
		window.addEventListener("keating:sessions-changed", () => notifications++);

		await deleteSavedSession("lesson-one");

		expect(deleted).toBe(true);
		expect(notifications).toBe(1);
	});
});
