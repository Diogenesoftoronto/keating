import { expect, test } from "bun:test";
import {
	clearEntry,
	currentEntry,
	entryFromState,
	hrefFor,
	leaveSettings,
	pushEntry,
	replaceEntry,
	settingsLeaving,
} from "./settings-history";

function fakeWindow(href = "/chat?session=a#x", state: unknown = { __TSR_index: 3, key: "k", __TSR_key: "k" }) {
	const url = new URL(href, "http://x");
	const stack = [{ state, href: url.pathname + url.search + url.hash }];
	let index = 0;
	const listeners = new Set<() => void>();
	const location = {
		get pathname() { return new URL(stack[index].href, "http://x").pathname; },
		get search() { return new URL(stack[index].href, "http://x").search; },
		get hash() { return new URL(stack[index].href, "http://x").hash; },
	};
	const history = {
		get state() { return stack[index].state; },
		pushState(next: unknown, _: string, to: string) { stack.splice(index + 1); stack.push({ state: next, href: to }); index++; },
		replaceState(next: unknown, _: string, to: string) { stack[index] = { state: next, href: to }; },
		go(n: number) { index += n; listeners.forEach((l) => l()); },
	};
	const target = {
		location,
		addEventListener: (_: string, l: () => void) => listeners.add(l),
		removeEventListener: (_: string, l: () => void) => listeners.delete(l),
	} as unknown as Window;
	return { history, location, target, stack, at: () => index };
}

test("entries round-trip through the URL and state, keeping the router's own fields", () => {
	const w = fakeWindow();
	pushEntry(w.history, w.location, { raw: "interface.display", list: false, depth: 1 });
	expect(w.location.search).toBe("?session=a&settings=interface.display");
	expect(w.location.hash).toBe("#x");
	const state = w.history.state as Record<string, unknown>;
	expect(state.__TSR_index).toBe(4);
	expect(state.key).not.toBe("k");
	expect(state.key).toBe(state.__TSR_key);
	expect(currentEntry(w.location, w.history.state)).toEqual({ raw: "interface.display", list: false, depth: 1 });
	pushEntry(w.history, w.location, { raw: "interface.display", list: true, depth: 2 });
	expect(w.location.search).toContain("settings=all");
	expect(currentEntry(w.location, w.history.state)?.list).toBe(true);
});

test("a bare deep link or reload without state is an entry Settings did not push", () => {
	expect(currentEntry({ pathname: "/chat", search: "?settings=models.jobs", hash: "" }, null)).toEqual({ raw: "models.jobs", list: false, depth: 0 });
	expect(currentEntry({ pathname: "/chat", search: "?settings=all", hash: "" }, {})).toEqual({ raw: "interface", list: true, depth: 0 });
	expect(currentEntry({ pathname: "/chat", search: "", hash: "" }, { keatingSettings: { raw: "x" } })).toBeNull();
	expect(entryFromState({ keatingSettings: { raw: "x", depth: -2 } })?.depth).toBe(0);
});

test("closing after pushed entries goes back over them without a reopen signal left set", () => {
	const w = fakeWindow();
	pushEntry(w.history, w.location, { raw: "a", list: false, depth: 1 });
	pushEntry(w.history, w.location, { raw: "b", list: false, depth: 2 });
	let sawLeaving = false;
	w.target.addEventListener("popstate", () => { sawLeaving = settingsLeaving(); });
	leaveSettings(w.history, w.location, 2, w.target);
	expect(w.at()).toBe(0);
	expect(sawLeaving).toBe(true);
	expect(settingsLeaving()).toBe(false);
	expect(w.location.search).toBe("?session=a");
});

test("closing on a deep-linked origin drops the parameter there", () => {
	const w = fakeWindow("/chat?settings=models.connections", null);
	replaceEntry(w.history, w.location, { raw: "models.connections", list: false, depth: 0 });
	pushEntry(w.history, w.location, { raw: "web-search", list: false, depth: 1 });
	leaveSettings(w.history, w.location, 1, w.target);
	expect(w.location.search).toBe("");
	expect(currentEntry(w.location, w.history.state)).toBeNull();
	const v = fakeWindow("/chat?settings=x");
	leaveSettings(v.history, v.location, 0, v.target);
	expect(v.location.search).toBe("");
	clearEntry(v.history, v.location);
	expect(hrefFor({ pathname: "/p", search: "", hash: "" }, { raw: "q", list: false })).toBe("/p?settings=q");
});
