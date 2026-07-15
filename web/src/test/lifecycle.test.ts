import { describe, expect, it } from "bun:test";
import { KeatingLifecycle } from "../keating/lifecycle";

describe("KeatingLifecycle", () => {
	it("runs matching handlers in registration order", async () => {
		const lifecycle = new KeatingLifecycle();
		const calls: string[] = [];
		lifecycle.on("session_start", async (event) => { calls.push(`first:${event.sessionId}`); });
		lifecycle.on("session_start", async () => { calls.push("second"); });

		const errors = await lifecycle.emit({ type: "session_start", sessionId: "session-1" });
		expect(errors).toEqual([]);
		expect(calls).toEqual(["first:session-1", "second"]);
	});

	it("isolates handler failures and supports unsubscribe", async () => {
		const lifecycle = new KeatingLifecycle();
		let completed = 0;
		lifecycle.on("session_idle", async () => { throw new Error("observer failed"); });
		const unsubscribe = lifecycle.on("session_idle", async () => { completed += 1; });

		const errors = await lifecycle.emit({ type: "session_idle", sessionId: "session-1" });
		expect(errors.map((error) => error.message)).toEqual(["observer failed"]);
		expect(completed).toBe(1);

		unsubscribe();
		await lifecycle.emit({ type: "session_idle", sessionId: "session-1" });
		expect(completed).toBe(1);
	});
});
