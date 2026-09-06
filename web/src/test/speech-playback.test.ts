import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { scheduleAudioBlob, schedulePcmAudio, stopScheduledAudio, waitForSpeechPlayback } from "../keating/speech";

let originalWindow: PropertyDescriptor | undefined;
const sources: TestSource[] = [];
let decode: () => Promise<AudioBuffer>;

class TestSource extends EventTarget {
  buffer?: AudioBuffer;
  starts: number[] = [];
  stopped = false;
  disconnected = false;
  connect() {}
  disconnect() { this.disconnected = true; }
  start(at: number) { this.starts.push(at); }
  stop() { this.stopped = true; this.dispatchEvent(new Event("ended")); }
}

class TestAudioContext {
  currentTime = 0;
  destination = {};
  state = "running";
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }
  createBufferSource() { const source = new TestSource(); sources.push(source); return source; }
  decodeAudioData() { return decode(); }
}

beforeEach(() => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext: TestAudioContext, atob } });
  stopScheduledAudio();
  sources.length = 0;
  decode = async () => ({ duration: 1 }) as AudioBuffer;
});

afterEach(() => {
  stopScheduledAudio();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("speech playback completion", () => {
  it("keeps normal audio ordering and waits for every queued source's ended event", async () => {
    expect(schedulePcmAudio("AAAAAA==", 2)).toBe(true);
    expect(await scheduleAudioBlob(new Blob(["audio"]))).toBe(true);
    expect(sources[0].starts).toEqual([0.03]);
    expect(sources[1].starts).toEqual([1.03]);
    let finished = false;
    const playback = waitForSpeechPlayback().then(() => { finished = true; });
    sources[0].dispatchEvent(new Event("ended"));
    await Promise.resolve();
    expect(finished).toBe(false);
    sources[1].dispatchEvent(new Event("ended"));
    await playback;
    expect(finished).toBe(true);
    expect(sources.every((source) => source.disconnected)).toBe(true);
    await waitForSpeechPlayback();
  });

  it("rejects canceled waits even if abort synchronously ends the sources", async () => {
    const controller = new AbortController();
    expect(schedulePcmAudio("AAAAAA==", undefined, { signal: controller.signal })).toBe(true);
    expect(await scheduleAudioBlob(new Blob(["audio"]), { signal: controller.signal })).toBe(true);
    const playback = waitForSpeechPlayback(controller.signal).then(() => null, (error: Error) => error);
    controller.abort();
    expect((await playback)?.name).toBe("AbortError");
    expect(sources.every((source) => source.stopped && source.disconnected)).toBe(true);
    await expect(waitForSpeechPlayback(controller.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(schedulePcmAudio("AAAAAA==", undefined, { signal: controller.signal })).toBe(false);
    expect(await scheduleAudioBlob(new Blob(["audio"]), { signal: controller.signal })).toBe(false);
  });

  it("never schedules a decoded response after cancel or a global audio stop", async () => {
    for (const cancelWithSignal of [true, false]) {
      let finishDecode!: (value: AudioBuffer) => void;
      let markDecoding!: () => void;
      const decoding = new Promise<void>((resolve) => { markDecoding = resolve; });
      decode = () => { markDecoding(); return new Promise((resolve) => { finishDecode = resolve; }); };
      const controller = new AbortController();
      const scheduling = scheduleAudioBlob(new Blob(["audio"]), { signal: controller.signal });
      await decoding;
      if (cancelWithSignal) controller.abort(); else stopScheduledAudio();
      finishDecode({ duration: 1 } as AudioBuffer);
      expect(await scheduling).toBe(false);
      expect(sources).toHaveLength(0);
    }
  });

  it("rejects interrupted playback when an external stop ends sources without aborting a signal", async () => {
    expect(schedulePcmAudio("AAAAAA==")).toBe(true);
    expect(await scheduleAudioBlob(new Blob(["audio"]))).toBe(true);
    const playback = waitForSpeechPlayback().then(() => null, (error: Error) => error);
    stopScheduledAudio();
    expect((await playback)?.name).toBe("AbortError");
    expect(sources.every((source) => source.stopped)).toBe(true);
  });
});
