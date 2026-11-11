import { describe, expect, test } from "bun:test";
import { INTERACTIVE_PAGE_LIMITS } from "../keating/interactive-page/protocol";
import { createInteractivePageStateStore, INTERACTIVE_PAGE_MAX_STORED_PAGES } from "../keating/interactive-page/state-store";

function memoryStorage() {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => { map.set(key, value); },
		removeItem: (key: string) => { map.delete(key); },
	};
}

describe("interactive page state store", () => {
	test("state round-trips by page id", () => {
		const store = createInteractivePageStateStore(memoryStorage(), () => new Date("2026-11-11T10:00:00Z"));
		expect(store.save("page-1", { lr: 0.1, trail: [4, 3.4] })).toEqual({ ok: true });
		expect(store.load("page-1")).toEqual({ status: "restored", state: { lr: 0.1, trail: [4, 3.4] }, savedAt: "2026-11-11T10:00:00.000Z" });
		expect(store.load("page-2")).toEqual({ status: "empty" });
	});

	test("corrupt state falls back cleanly and is removed", () => {
		const storage = memoryStorage();
		const store = createInteractivePageStateStore(storage);
		storage.map.set("keating.interactive-page.v1:page-1", "{not json");
		expect(store.load("page-1")).toEqual({ status: "corrupt" });
		expect(storage.map.has("keating.interactive-page.v1:page-1")).toBe(false);
		storage.map.set("keating.interactive-page.v1:page-2", JSON.stringify({ v: 99, savedAt: "x", state: 1 }));
		expect(store.load("page-2")).toEqual({ status: "corrupt" });
	});

	test("a failed write is reported, not swallowed", () => {
		const storage = { ...memoryStorage(), setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
		expect(createInteractivePageStateStore(storage).save("page-1", { a: 1 })).toEqual({ ok: false, reason: "write-failed" });
	});

	test("missing storage and throwing reads are reported as unavailable", () => {
		expect(createInteractivePageStateStore(null).save("page-1", 1)).toEqual({ ok: false, reason: "unavailable" });
		expect(createInteractivePageStateStore(null).load("page-1")).toEqual({ status: "unavailable" });
		const throwing = { ...memoryStorage(), getItem: () => { throw new Error("SecurityError"); } };
		expect(createInteractivePageStateStore(throwing).load("page-1")).toEqual({ status: "unavailable" });
	});

	test("oversize state and bad page ids are refused", () => {
		const store = createInteractivePageStateStore(memoryStorage());
		expect(store.save("page-1", "x".repeat(INTERACTIVE_PAGE_LIMITS.maxStateBytes))).toEqual({ ok: false, reason: "too-large" });
		expect(store.save("../etc", 1)).toEqual({ ok: false, reason: "invalid-page" });
	});

	test("the number of stored pages is bounded, oldest evicted first", () => {
		const storage = memoryStorage();
		const store = createInteractivePageStateStore(storage);
		for (let i = 0; i <= INTERACTIVE_PAGE_MAX_STORED_PAGES; i++) store.save(`p${i}`, i);
		expect(store.load("p0")).toEqual({ status: "empty" });
		expect(store.load(`p${INTERACTIVE_PAGE_MAX_STORED_PAGES}`)).toMatchObject({ status: "restored", state: INTERACTIVE_PAGE_MAX_STORED_PAGES });
	});
});
