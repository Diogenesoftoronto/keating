import { describe, expect, test } from "bun:test";
import { createContextSync, createGestureGate, createInteractivePageHost, type InteractivePageHostOptions } from "../keating/interactive-page/host";
import { INTERACTIVE_PAGE_LIMITS, PAGE_MESSAGE_SOURCE, readLinkUrl, readPageMessage, readShareResult, type HostMessage } from "../keating/interactive-page/protocol";
import { readInteractivePageContext, type ThemeSource } from "../keating/interactive-page/theme";

const CHANNEL = "chan-1";
const msg = (fields: Record<string, unknown>) => ({ source: PAGE_MESSAGE_SOURCE, channel: CHANNEL, ...fields });

function setup(overrides: Partial<InteractivePageHostOptions> & { focused?: boolean; active?: boolean; clock?: { now: number } } = {}) {
	const frame = { name: "frame" };
	const posted: HostMessage[] = [];
	const shares: unknown[] = [];
	const links: string[] = [];
	const events: string[] = [];
	const env = { focused: overrides.focused ?? true, active: overrides.active ?? true };
	const clock = overrides.clock ?? { now: 1_000_000 };
	const host = createInteractivePageHost({
		channel: CHANNEL,
		frameWindow: () => frame,
		post: (message) => posted.push(message),
		gate: createGestureGate({ isFrameFocused: () => env.focused, hasRecentActivation: () => env.active, now: () => clock.now }),
		canShare: () => true,
		onReady: () => events.push("ready"),
		onHeight: (height) => events.push(`height:${height}`),
		onState: () => events.push("state"),
		onShare: (result) => { shares.push(result); return true; },
		onOpenLink: (url) => links.push(url),
		onEscape: () => events.push("escape"),
		onError: (message) => events.push(`error:${message}`),
		...overrides,
	});
	const send = (data: unknown, source: unknown = frame) => host.handleMessage({ source, data });
	return { host, frame, posted, shares, links, events, env, clock, send };
}

const share = (id = "r1", result: unknown = { summary: "Got 2/3", score: { earned: 2, possible: 3 }, complete: true }) => msg({ type: "share", id, result });

describe("message validation", () => {
	test("messages from any window other than the frame are ignored", () => {
		const { send, events, shares } = setup();
		expect(send(msg({ type: "ready" }), { name: "sibling" })).toBe(false);
		expect(send(share(), null)).toBe(false);
		expect(events).toEqual([]);
		expect(shares).toEqual([]);
	});

	test("a wrong channel id or source tag is ignored", () => {
		const { send, events } = setup();
		expect(send({ source: PAGE_MESSAGE_SOURCE, channel: "stale", type: "ready" })).toBe(false);
		expect(send({ source: "keating-hyperframes", channel: CHANNEL, type: "ready" })).toBe(false);
		expect(events).toEqual([]);
	});

	test("malformed messages are rejected", () => {
		for (const data of [null, "ready", 42, [], msg({ type: "nope" }), msg({ type: "height", height: "100" }), msg({ type: "height", height: -1 }), msg({ type: "height", height: Number.POSITIVE_INFINITY }), msg({ type: "error", message: 3 })]) {
			expect(readPageMessage(data, CHANNEL)).toBeNull();
		}
		expect(readPageMessage(msg({ type: "height", height: INTERACTIVE_PAGE_LIMITS.maxReportedHeight + 1 }), CHANNEL)).toBeNull();
	});

	test("state must be plain bounded JSON", () => {
		expect(readPageMessage(msg({ type: "state", state: { a: [1, "b", null] } }), CHANNEL)).toEqual({ type: "state", state: { a: [1, "b", null] } });
		expect(readPageMessage(msg({ type: "state", state: "x".repeat(INTERACTIVE_PAGE_LIMITS.maxStateBytes) }), CHANNEL)).toBeNull();
		expect(readPageMessage(msg({ type: "state", state: { when: new Date() } }), CHANNEL)).toBeNull();
		expect(readPageMessage(msg({ type: "state", state: new Map() }), CHANNEL)).toBeNull();
		expect(readPageMessage(msg({ type: "state", state: Number.NaN }), CHANNEL)).toBeNull();
		let deep: unknown = 1;
		for (let i = 0; i < 40; i++) deep = [deep];
		expect(readPageMessage(msg({ type: "state", state: deep }), CHANNEL)).toBeNull();
	});

	test("share results are bounded and validated", () => {
		expect(readShareResult({ summary: "  done  " })).toEqual({ summary: "done" });
		for (const bad of [{}, { summary: "" }, { summary: "   " }, { summary: "x".repeat(INTERACTIVE_PAGE_LIMITS.maxShareSummaryLength + 1) }, { summary: "s", extra: 1 }, { summary: "s", score: { earned: 4, possible: 3 } }, { summary: "s", score: { earned: -1, possible: 3 } }, { summary: "s", score: { earned: 0, possible: 0 } }, { summary: "s", score: { earned: 1, possible: 2, bonus: 1 } }, { summary: "s", complete: "yes" }, { summary: "s", data: "x".repeat(INTERACTIVE_PAGE_LIMITS.maxShareDataBytes) }]) {
			expect(readShareResult(bad)).toBeNull();
		}
	});

	test("an oversize or malformed share from the frame is refused with a reply, never delivered", () => {
		const { send, shares, posted } = setup();
		expect(send(share("r9", { summary: "x".repeat(5000) }))).toBe(false);
		expect(shares).toEqual([]);
		expect(posted.at(-1)).toMatchObject({ type: "reply", id: "r9", ok: false, reason: "invalid" });
	});
});

describe("share gesture gate", () => {
	test("share is refused without focus or without user activation", () => {
		for (const env of [{ focused: false, active: true }, { focused: true, active: false }, { focused: false, active: false }]) {
			const { send, shares, posted } = setup(env);
			send(share());
			expect(shares).toEqual([]);
			expect(posted.at(-1)).toMatchObject({ type: "reply", ok: false, reason: "no-gesture" });
		}
	});

	test("a share with a real gesture is delivered and acknowledged", () => {
		const { send, shares, posted } = setup();
		expect(send(share())).toBe(true);
		expect(shares).toEqual([{ summary: "Got 2/3", score: { earned: 2, possible: 3 }, complete: true }]);
		expect(posted.at(-1)).toMatchObject({ source: "keating-interactive-host", channel: CHANNEL, type: "reply", id: "r1", ok: true });
	});

	test("shares are rate-limited by interval and per window", () => {
		const { send, shares, posted, clock } = setup();
		send(share("a"));
		send(share("b"));
		expect(shares).toHaveLength(1);
		expect(posted.at(-1)).toMatchObject({ id: "b", ok: false, reason: "rate-limited" });
		for (let i = 0; i < 10; i++) {
			clock.now += 2_500;
			send(share(`c${i}`));
		}
		expect(shares).toHaveLength(6);
		clock.now += 5 * 60_000;
		send(share("later"));
		expect(shares).toHaveLength(7);
	});

	test("disabled pages refuse shares", () => {
		const { send, shares, posted } = setup({ canShare: () => false });
		send(share());
		expect(shares).toEqual([]);
		expect(posted.at(-1)).toMatchObject({ ok: false, reason: "disabled" });
	});
});

describe("openLink", () => {
	test("only http(s) URLs without credentials are accepted", () => {
		expect(readLinkUrl("https://en.wikipedia.org/wiki/Gradient_descent")).toBe("https://en.wikipedia.org/wiki/Gradient_descent");
		for (const bad of ["javascript:alert(1)", "data:text/html,<p>x", "file:///etc/passwd", "blob:null/abc", "//example.com", "https://user:pw@example.com/", "mailto:a@b.c", 7, "https://x.test/" + "a".repeat(3000)]) {
			expect(readLinkUrl(bad)).toBeNull();
		}
	});

	test("the host opens links only on a gesture and refuses other schemes", () => {
		const { send, links, env, posted } = setup();
		send(msg({ type: "open-link", id: "l1", url: "javascript:alert(1)" }));
		expect(posted.at(-1)).toMatchObject({ id: "l1", ok: false, reason: "invalid" });
		env.active = false;
		send(msg({ type: "open-link", id: "l2", url: "https://example.com/" }));
		expect(posted.at(-1)).toMatchObject({ id: "l2", ok: false, reason: "no-gesture" });
		env.active = true;
		send(msg({ type: "open-link", id: "l3", url: "https://example.com/" }));
		expect(links).toEqual(["https://example.com/"]);
	});
});

describe("lifecycle messages and context", () => {
	test("ready, height, state, escape and error reach their handlers", () => {
		const { send, events } = setup();
		send(msg({ type: "ready" }));
		send(msg({ type: "height", height: 320 }));
		send(msg({ type: "state", state: { x: 1 } }));
		send(msg({ type: "escape" }));
		send(msg({ type: "error", message: "e".repeat(1000) }));
		expect(events.slice(0, 4)).toEqual(["ready", "height:320", "state", "escape"]);
		expect(events[4]!.length).toBe("error:".length + INTERACTIVE_PAGE_LIMITS.maxErrorLength);
	});

	test("a theme change pushes one context message to the frame; no change pushes none", () => {
		const { host, posted } = setup();
		let dark = false;
		const source: ThemeSource = { isDark: () => dark, reducedMotion: () => false, readVariable: (name) => (name === "--background" ? (dark ? "#0c1510" : "#f1ece0") : "") };
		const sync = createContextSync(() => readInteractivePageContext(source), (context) => host.pushContext(context));
		expect(sync.sync()).toBe(true);
		expect(sync.sync()).toBe(false);
		dark = true;
		expect(sync.sync()).toBe(true);
		const contexts = posted.filter((message) => message.type === "context");
		expect(contexts).toHaveLength(2);
		expect(contexts[1]).toMatchObject({ channel: CHANNEL, context: { appearance: "dark", variables: { "--background": "#0c1510" } } });
	});

	test("reduced motion is part of the pushed context", () => {
		const { host, posted } = setup();
		const sync = createContextSync(() => readInteractivePageContext({ isDark: () => false, reducedMotion: () => true, readVariable: () => "" }), (context) => host.pushContext(context));
		sync.sync();
		expect(posted[0]).toMatchObject({ type: "context", context: { reducedMotion: true, appearance: "light" } });
	});
});
