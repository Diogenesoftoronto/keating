import { describe, expect, test } from "bun:test";
import { gptLiveInstructions, startGptLiveSession } from "../keating/speech-providers/gpt-live";
import { DEFAULT_WEB_SPEECH_SETTINGS, type LiveSpeechRequest } from "../keating/speech";
import type { PcmCaptureHandle } from "../keating/pcm-capture-worklet";

class Socket {
	readyState = 0;
	bufferedAmount = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;
	sent: any[] = [];
	send(data: string) { this.sent.push(JSON.parse(data)); }
	close() { this.readyState = 3; }
	open() { this.readyState = 1; this.onopen?.(); }
	event(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function setup(overrides: Partial<LiveSpeechRequest> = {}, captureDelay?: Promise<void>) {
	const socket = new Socket();
	const stopped = { count: 0 };
	const chunks: string[] = [];
	const transcripts: [string, string, boolean][] = [];
	const events: any[] = [];
	const track = { enabled: true };
	let onChunk: (data: string) => void = () => {};
	const promise = startGptLiveSession({
		settings: { ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "gpt-live", model: "gpt-live-1" },
		getApiKey: async () => { throw new Error("Must not ask for an OpenAI key"); },
		onUserTranscript: (text, final) => transcripts.push(["user", text, final]),
		onAssistantTranscript: (text, final) => transcripts.push(["assistant", text, final]),
		onConversationEvent: (event) => events.push(event), ...overrides,
	}, {
		credentials: async () => ({ type: "keating.live.connect", authorization: "DPoP fixture", dpop: "proof", idempotencyKey: "attempt", maxCostMicrousd: 100_000 }),
		socket: () => socket as unknown as WebSocket,
		capture: async (options) => {
			expect(options.sampleRate).toBe(24_000); onChunk = options.onChunk;
			await captureDelay;
			return { context: { sampleRate: 24_000 }, stream: { getAudioTracks: () => [track] }, stop: () => { stopped.count++; } } as unknown as PcmCaptureHandle;
		},
		play: (chunk, rate) => { expect(rate).toBe(24_000); chunks.push(chunk); return true; },
		stopPlayback: () => {}, waitPlayback: async () => {}, closeTimeoutMs: 20,
	});
	return { socket, promise, stopped, chunks, transcripts, events, track, chunk: (data: string) => onChunk(data) };
}
async function connect(harness: ReturnType<typeof setup>) {
	await tick(); harness.socket.open();
	expect(harness.socket.sent.map((event) => event.type)).toEqual(["keating.live.connect"]);
	harness.socket.event({ type: "keating.live.ready" });
	expect(harness.socket.sent[1].type).toBe("session.start");
	harness.socket.event({ type: "session.started", session: { id: "live_fixture" } });
	return harness.promise;
}

describe("GPT Live through Not Organic", () => {
	test("gates microphone on readiness, maps audio/transcripts and drains terminal close", async () => {
		const h = setup(); const session = await connect(h);
		expect(session.state).toBe("listening");
		expect(session.videoCapable).toBe(false); expect(session.imageCapable).toBe(false);
		h.chunk("AAAA"); expect(h.socket.sent.at(-1)).toEqual({ type: "session.input_audio.append", audio: "AAAA" });
		session.setMicrophoneMuted?.(true); expect(h.track.enabled).toBe(false);
		h.chunk("AAAA"); expect(h.socket.sent.at(-1).type).toBe("session.input_audio.mute");
		session.setMicrophoneMuted?.(false); expect(h.track.enabled).toBe(true);
		h.socket.event({ type: "session.output_audio.delta", delta: "AAAA" });
		h.socket.event({ type: "session.input_transcript.delta", delta: "I think ", start_ms: 0, end_ms: 100 });
		h.socket.event({ type: "session.input_transcript.delta", delta: "I think", start_ms: 100, end_ms: 200 });
		h.socket.event({ type: "session.output_transcript.delta", delta: "Why?" });
		expect(h.chunks).toEqual(["AAAA"]);
		expect(h.transcripts).toEqual([["user", "I think ", false], ["user", "I think", false], ["assistant", "Why?", false]]);
		const closing = session.stop(); expect(h.stopped.count).toBe(1);
		expect(h.socket.sent.at(-1).type).toBe("session.close"); expect(h.socket.readyState).toBe(1);
		h.socket.event({ type: "session.closed", usage: { seconds: 20 } }); await closing;
		expect(session.state).toBe("closed"); expect(h.socket.readyState).toBe(3);
		expect(h.events.filter((event) => event.type === "transcript.delta")).toHaveLength(5);
		await session.stop(); expect(h.stopped.count).toBe(1);
	});
	test("surfaces gateway consent denial before capturing the microphone", async () => {
		const h = setup(); const failure = h.promise.catch((error) => error as Error);
		await tick(); h.socket.open();
		h.socket.event({ type: "keating.live.error", code: "realtime_consent_required", message: "Grant realtime consent in your account.", status: 403 });
		expect((await failure as Error).message).toContain("realtime_consent_required"); expect(h.stopped.count).toBe(0); expect(h.socket.readyState).toBe(3);
	});
	test("abort during capture cleans up a late microphone and rejects startup", async () => {
		let release!: () => void;
		const controller = new AbortController();
		const h = setup({ signal: controller.signal }, new Promise<void>((resolve) => { release = resolve; }));
		const connected = connect(h); const failed = connected.catch((error) => error as Error);
		await tick(); controller.abort(); expect((await failed as Error).message).toContain("cancelled");
		h.socket.event({ type: "session.closed" }); release(); await tick();
		expect(h.stopped.count).toBe(1); expect(h.socket.readyState).toBe(3);
	});
	test("backpressure terminates capture instead of buffering unbounded microphone audio", async () => {
		const h = setup(); const session = await connect(h);
		h.socket.bufferedAmount = 300_000; h.chunk("AAAA");
		expect(session.state).toBe("closed"); expect(h.stopped.count).toBe(1);
	});
	test("bounded startup context carries recent conversation and discloses unsupported actions", () => {
		const instructions = gptLiveInstructions({ history: [{ role: "user", text: "Help with fractions" }], instructions: "x".repeat(30_000) });
		expect(instructions.length).toBeLessThanOrEqual(16_000);
		expect(instructions).toContain("Help with fractions");
		expect(instructions).toContain("no backend delegation, tools, camera or screen access");
	});
});
