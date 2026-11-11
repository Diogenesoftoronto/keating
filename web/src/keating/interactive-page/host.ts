/**
 * Host-side message handling for one interactive page frame, free of React so
 * every security rule can be tested directly. The component wires real DOM
 * functions into `InteractivePageHostOptions`.
 */

import {
	hostMessage,
	readPageMessage,
	type HostMessage,
	type InteractivePageContext,
	type InteractiveShareResult,
	type JsonValue,
	type LinkRefusal,
	type ShareRefusal,
} from "./protocol";
import { contextsEqual } from "./theme";

export interface GestureGateOptions {
	isFrameFocused(): boolean;
	hasRecentActivation(): boolean;
	now?: () => number;
	/** Minimum gap between accepted shares. */
	shareMinIntervalMs?: number;
	shareWindowMs?: number;
	shareMaxPerWindow?: number;
	linkMinIntervalMs?: number;
}

export type GateVerdict = { ok: true } | { ok: false; reason: "no-gesture" | "rate-limited" };

export interface GestureGate {
	check(kind: "share" | "open-link"): GateVerdict;
}

/** Accepts only learner-initiated requests and spaces them out; accepted requests are recorded. */
export function createGestureGate(options: GestureGateOptions): GestureGate {
	const now = options.now ?? (() => Date.now());
	const shareMinIntervalMs = options.shareMinIntervalMs ?? 2_000;
	const shareWindowMs = options.shareWindowMs ?? 5 * 60_000;
	const shareMaxPerWindow = options.shareMaxPerWindow ?? 6;
	const linkMinIntervalMs = options.linkMinIntervalMs ?? 1_000;
	const shares: number[] = [];
	let lastLink = -Infinity;
	return {
		check(kind) {
			if (!options.isFrameFocused() || !options.hasRecentActivation()) return { ok: false, reason: "no-gesture" };
			const at = now();
			if (kind === "open-link") {
				if (at - lastLink < linkMinIntervalMs) return { ok: false, reason: "rate-limited" };
				lastLink = at;
				return { ok: true };
			}
			while (shares.length && at - shares[0]! >= shareWindowMs) shares.shift();
			const last = shares[shares.length - 1];
			if ((last !== undefined && at - last < shareMinIntervalMs) || shares.length >= shareMaxPerWindow) return { ok: false, reason: "rate-limited" };
			shares.push(at);
			return { ok: true };
		},
	};
}

export interface InteractivePageHostOptions {
	channel: string;
	/** The frame's current window; messages from anything else are ignored. */
	frameWindow(): unknown;
	post(message: HostMessage): void;
	gate: GestureGate;
	/** False while the page is disabled (e.g. a past turn): shares are refused. */
	canShare(): boolean;
	onReady(): void;
	onHeight(height: number): void;
	onState(state: JsonValue): void;
	/** Return false when the share could not be delivered. */
	onShare(result: InteractiveShareResult): boolean;
	onOpenLink(url: string): void;
	onEscape(): void;
	onError(message: string): void;
}

export interface InteractivePageHost {
	/** Returns true when the event was a valid message from this frame. */
	handleMessage(event: { source: unknown; data: unknown }): boolean;
	pushContext(context: InteractivePageContext): void;
	reportStateSaved(ok: boolean): void;
}

export function createInteractivePageHost(options: InteractivePageHostOptions): InteractivePageHost {
	const { channel } = options;
	const reply = (id: string, verdict: { ok: true } | { ok: false; reason: ShareRefusal | LinkRefusal }) => {
		options.post(verdict.ok ? hostMessage(channel, { type: "reply", id, ok: true as const }) : hostMessage(channel, { type: "reply", id, ok: false as const, reason: verdict.reason }));
	};
	return {
		handleMessage(event) {
			const frame = options.frameWindow();
			if (!frame || event.source !== frame) return false;
			const message = readPageMessage(event.data, channel);
			if (!message) {
				const id = (event.data as { channel?: unknown } | null)?.channel === channel ? invalidRequestId(event.data) : null;
				if (id) reply(id, { ok: false, reason: "invalid" });
				return false;
			}
			switch (message.type) {
				case "ready":
					options.onReady();
					break;
				case "height":
					options.onHeight(message.height);
					break;
				case "state":
					options.onState(message.state);
					break;
				case "escape":
					options.onEscape();
					break;
				case "error":
					options.onError(message.message);
					break;
				case "open-link": {
					const verdict = options.gate.check("open-link");
					if (verdict.ok) options.onOpenLink(message.url);
					reply(message.id, verdict);
					break;
				}
				case "share": {
					if (!options.canShare()) {
						reply(message.id, { ok: false, reason: "disabled" });
						break;
					}
					const verdict = options.gate.check("share");
					if (!verdict.ok) {
						reply(message.id, verdict);
						break;
					}
					reply(message.id, options.onShare(message.result) ? { ok: true } : { ok: false, reason: "unavailable" });
					break;
				}
			}
			return true;
		},
		pushContext(context) {
			options.post(hostMessage(channel, { type: "context", context }));
		},
		reportStateSaved(ok) {
			options.post(hostMessage(channel, { type: "state-saved", ok }));
		},
	};
}

/** Pushes the app context to the frame only when it actually changed (or when forced, e.g. on ready). */
export function createContextSync(read: () => InteractivePageContext, push: (context: InteractivePageContext) => void) {
	let last: InteractivePageContext | null = null;
	return {
		sync(force = false): boolean {
			const next = read();
			if (!force && last && contextsEqual(last, next)) return false;
			last = next;
			push(next);
			return true;
		},
	};
}

/** Answers an invalid request so the page's promise settles instead of waiting for the bridge timeout. */
export function invalidRequestId(data: unknown): string | null {
	if (typeof data !== "object" || data === null) return null;
	const { type, id } = data as { type?: unknown; id?: unknown };
	return (type === "share" || type === "open-link") && typeof id === "string" && id.length <= 64 ? id : null;
}

export function randomChannelId(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
