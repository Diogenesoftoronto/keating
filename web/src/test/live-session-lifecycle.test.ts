import { describe, expect, it } from "bun:test";

import type { RealtimeTelemetry } from "../keating/observability";
import type { CapturedFrame, VideoCaptureHandle } from "../keating/video-capture";
import {
	addAbortListener,
	createLiveSessionLifecycle,
	createLiveTurnTelemetry,
	createLiveVideoSubscription,
} from "../keating/speech-providers/live-session-lifecycle";

class TrackingAbortTarget extends EventTarget {
	aborted = false;
	adds = 0;
	removes = 0;

	override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
		if (type === "abort") this.adds += 1;
		super.addEventListener(type, callback, options);
	}

	override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
		if (type === "abort") this.removes += 1;
		super.removeEventListener(type, callback, options);
	}
}

function frame(): CapturedFrame {
	return {
		data: "AAAA",
		dataUrl: "data:image/jpeg;base64,AAAA",
		mimeType: "image/jpeg",
		width: 1,
		height: 1,
		capturedAt: 0,
	};
}

function captureHandle() {
	let listener: ((captured: CapturedFrame) => void) | null = null;
	let subscriptions = 0;
	let unsubscriptions = 0;
	const handle = {
		onFrame(next: (captured: CapturedFrame) => void) {
			subscriptions += 1;
			listener = next;
			return () => {
				unsubscriptions += 1;
				listener = null;
			};
		},
	} as unknown as VideoCaptureHandle;
	return {
		handle,
		emit: (captured = frame()) => listener?.(captured),
		get subscriptions() { return subscriptions; },
		get unsubscriptions() { return unsubscriptions; },
	};
}

describe("live session lifecycle", () => {
	it("emits first-audio once and owns provider-neutral turn timing", () => {
		const events: Array<{ name: string; turn?: unknown; durationMs?: number }> = [];
		const telemetry: RealtimeTelemetry = {
			emit(name, attributes, durationMs) {
				events.push({ name, turn: attributes?.turn, durationMs });
			},
			start: () => 40,
			durationSince: (startedAt) => 100 - startedAt,
		};
		const turns = createLiveTurnTelemetry({
			provider: "openai",
			transport: "webrtc",
			telemetry,
			setupStartedAt: 10,
		});

		turns.observeFirstAudio();
		turns.observeFirstAudio();
		turns.startTurn();
		turns.startTurn();
		turns.completeTurn();

		expect(turns.turn).toBe(1);
		expect(events).toEqual([
			{ name: "audio.first", turn: undefined, durationMs: 90 },
			{ name: "speech.turn.started", turn: 1, durationMs: undefined },
			{ name: "speech.turn.completed", turn: 1, durationMs: 60 },
		]);
	});

	it("completes and cleans up once while publishing state changes", () => {
		const states: string[] = [];
		const completions: string[] = [];
		let cleanups = 0;
		const lifecycle = createLiveSessionLifecycle({
			onState: (state) => states.push(state),
			onAbort: () => {},
			onComplete: (reason) => completions.push(reason),
		});
		lifecycle.addCleanup(() => { cleanups += 1; });

		expect(lifecycle.start()).toBe(true);
		lifecycle.setState("listening");
		lifecycle.close("cancelled");
		lifecycle.close("error");

		expect(lifecycle.state).toBe("closed");
		expect(states).toEqual(["connecting", "listening", "closed"]);
		expect(completions).toEqual(["cancelled"]);
		expect(cleanups).toBe(1);
	});

	it("classifies an active abort as interruption and releases resources", () => {
		const controller = new AbortController();
		const abortPhases: boolean[] = [];
		const completions: string[] = [];
		let cleanups = 0;
		const lifecycle = createLiveSessionLifecycle({
			signal: controller.signal,
			onAbort: (beforeStart) => abortPhases.push(beforeStart),
			onComplete: (reason) => completions.push(reason),
		});
		lifecycle.addCleanup(() => { cleanups += 1; });
		lifecycle.start();

		controller.abort();

		expect(abortPhases).toEqual([false]);
		expect(completions).toEqual(["interrupted"]);
		expect(lifecycle.state).toBe("closed");
		expect(cleanups).toBe(1);
	});

	it("reports an abort that predates session setup", () => {
		const controller = new AbortController();
		controller.abort();
		const abortPhases: boolean[] = [];
		const lifecycle = createLiveSessionLifecycle({
			signal: controller.signal,
			onAbort: (beforeStart) => abortPhases.push(beforeStart),
			onComplete: () => {},
		});

		expect(lifecycle.start()).toBe(false);
		expect(abortPhases).toEqual([true]);
		expect(lifecycle.completionReason).toBe("interrupted");
	});

	it("detaches an unused abort listener during normal cleanup", () => {
		const target = new TrackingAbortTarget();
		const detach = addAbortListener(target as unknown as AbortSignal, () => {});
		expect(target.adds).toBe(1);

		detach();
		detach();
		expect(target.removes).toBe(1);
	});
});

describe("live video subscription", () => {
	it("waits for provider readiness and moves the subscription without owning capture", () => {
		const first = captureHandle();
		const second = captureHandle();
		const received: CapturedFrame[] = [];
		const subscription = createLiveVideoSubscription({
			capable: true,
			initial: first.handle,
			onFrame: (captured) => received.push(captured),
		});

		expect(first.subscriptions).toBe(0);
		subscription.setReady();
		expect(first.subscriptions).toBe(1);
		first.emit();

		subscription.attach(second.handle);
		expect(first.unsubscriptions).toBe(1);
		expect(second.subscriptions).toBe(1);
		second.emit();

		subscription.attach(null);
		expect(second.unsubscriptions).toBe(1);
		expect(subscription.active).toBeNull();
		expect(received).toHaveLength(2);
	});

	it("never subscribes when the negotiated model is not vision capable", () => {
		const capture = captureHandle();
		const subscription = createLiveVideoSubscription({
			capable: false,
			initial: capture.handle,
			onFrame: () => {},
		});

		subscription.setReady();
		subscription.attach(capture.handle);
		expect(subscription.active).toBeNull();
		expect(capture.subscriptions).toBe(0);
	});
});
