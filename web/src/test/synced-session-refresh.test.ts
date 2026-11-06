import { describe, expect, test } from "bun:test";
import { createSyncedSessionRefresher, type SyncedSessionTarget } from "../hooks/agent/synced-session-refresh";

function setup() {
	let target: SyncedSessionTarget | null = { id: "one", token: {}, navigation: 1, ready: true };
	let read: () => Promise<string | null> = async () => "remote";
	const applied: string[] = [];
	let deleted = 0;
	let beforeApply: () => Promise<void> = async () => {};
	const refresh = createSyncedSessionRefresher({
		current: () => target, read: () => read(),
		apply: async (value, current) => {
			await beforeApply();
			if (!current()) return false;
			applied.push(value);
			return true;
		},
		deleted: current => { if (current()) deleted++; },
		onError: error => { throw error; },
	});
	return { refresh, applied, target: () => target!, deleted: () => deleted,
		setTarget: (value: SyncedSessionTarget | null) => { target = value; },
		setRead: (value: typeof read) => { read = value; },
		setBeforeApply: (value: typeof beforeApply) => { beforeApply = value; },
	};
}

describe("synced open conversation refresh", () => {
	test("updates the open idle conversation once, ignoring unrelated imports", async () => {
		const state = setup();
		await state.refresh.imported(["other"]);
		expect(state.applied).toEqual([]);
		await state.refresh.imported(["one"]);
		await state.refresh.flush();
		expect(state.applied).toEqual(["remote"]);
	});
	test("defers while streaming or unsaved, then applies after a local save", async () => {
		const state = setup();
		state.target().ready = false;
		await state.refresh.imported(["one"]);
		expect(state.applied).toEqual([]);
		state.target().ready = true;
		await state.refresh.flush();
		expect(state.applied).toEqual(["remote"]);
	});
	test("does not replace a conversation navigated during the read", async () => {
		const state = setup();
		state.setRead(async () => { state.target().navigation++; return "stale"; });
		await state.refresh.imported(["one"]);
		expect(state.applied).toEqual([]);
	});
	test("rechecks unsaved work after asynchronous runtime preparation", async () => {
		const state = setup();
		state.setBeforeApply(async () => { state.target().ready = false; });
		await state.refresh.imported(["one"]);
		expect(state.applied).toEqual([]);
	});
	test("does not apply an import after unmount", async () => {
		const state = setup();
		state.setRead(async () => { state.refresh.dispose(); return "stale"; });
		await state.refresh.imported(["one"]);
		expect(state.applied).toEqual([]);
	});
	test("moves away from an idle conversation deleted on another device", async () => {
		const state = setup();
		state.setRead(async () => null);
		await state.refresh.imported(["one"]);
		await state.refresh.flush();
		expect(state.deleted()).toBe(1);
	});
	test("replays a newer import received during preparation", async () => {
		const state = setup();
		let first = true;
		state.setBeforeApply(async () => {
			if (first) { first = false; void state.refresh.imported(["one"]); }
		});
		await state.refresh.imported(["one"]);
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(state.applied).toEqual(["remote"]);
	});
});
