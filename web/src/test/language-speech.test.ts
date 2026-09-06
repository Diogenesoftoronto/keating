import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createLanguageReferencePlayer, type LanguageSpeechDependencies } from "../components/language/speech";
import { DEFAULT_WEB_SPEECH_SETTINGS, type SpeechProvider, type SpeechSynthesisRequest } from "../keating/speech";

let originalWindow: PropertyDescriptor | undefined;
beforeEach(() => { originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window"); });
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class ReferenceAudio extends EventTarget {
  preload = "";
  lang = "";
  playbackRate = 1;
  preservesPitch = false;
  paused = false;
  cleared = false;
  loaded = false;
  playError?: Error;
  play() { return this.playError ? Promise.reject(this.playError) : Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === "src") this.cleared = true; }
  load() { this.loaded = true; }
}

function fixture(overrides: Partial<LanguageSpeechDependencies> = {}) {
  const requests: SpeechSynthesisRequest[] = [];
  const clips: ReferenceAudio[] = [];
  const urls: string[] = [];
  const provider: SpeechProvider = {
    id: "openai-tts", label: "Test voice", kind: "tts", status: "stable", description: "", models: [], voices: [],
    async synthesize(request) { requests.push(request); return { audioChunks: 1, playedChunks: 1, transcript: request.utterance.text }; },
  };
  let stops = 0;
  let primes = 0;
  const dependencies: LanguageSpeechDependencies = {
    loadSettings: () => ({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "openai-tts", microphoneEnabled: true, videoEnabled: true }),
    getProvider: async () => provider,
    getCustomProvider: async () => provider,
    getApiKey: async () => "fixture-key",
    createAudio: (url) => { const clip = new ReferenceAudio(); clips.push(clip); urls.push(url); return clip as unknown as HTMLAudioElement; },
    prime: async () => { primes++; },
    waitForPlayback: async () => {},
    stopAudio: () => { stops++; },
    ...overrides,
  };
  return { play: createLanguageReferencePlayer(dependencies), provider, requests, clips, urls, dependencies, stops: () => stops, primes: () => primes };
}

const phrase = { text: "Hola", language: "es-ES" };
const recording = { ...phrase, audioUrl: "https://example.org/hola.mp3" };

describe("language reference playback", () => {
  it("finishes recordings on ended, with pitch preserved at normal and slow speed", async () => {
    for (const slow of [false, true]) {
      const player = fixture();
      let completed = false;
      const playback = player.play({ ...recording, slow }).then(() => { completed = true; });
      await Promise.resolve();
      expect(completed).toBe(false);
      expect(player.clips[0].playbackRate).toBe(slow ? 0.75 : 1);
      expect(player.clips[0].preservesPitch).toBe(true);
      expect(player.clips[0].lang).toBe("es-ES");
      expect(player.primes()).toBe(0);
      expect(player.requests).toHaveLength(0);
      player.clips[0].dispatchEvent(new Event("ended"));
      await playback;
      expect(completed).toBe(true);
      expect(player.clips[0].paused && player.clips[0].cleared && player.clips[0].loaded).toBe(true);
    }
  });

  it("resolves root-relative recordings against the page origin", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "http://localhost:6006" } } });
    const player = fixture();
    const playback = player.play({ ...phrase, audioUrl: "/audio/language/es-hola.mp3" });
    expect(player.urls).toEqual(["http://localhost:6006/audio/language/es-hola.mp3"]);
    player.clips[0].dispatchEvent(new Event("ended"));
    await playback;
  });

  it("plays absolute recordings without a page location and rejects relative URLs without an origin", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const player = fixture();
    const playback = player.play(recording);
    expect(player.urls).toEqual([recording.audioUrl]);
    player.clips[0].dispatchEvent(new Event("ended"));
    await playback;
    await expect(player.play({ ...phrase, audioUrl: "/audio/language/es-hola.mp3" })).rejects.toThrow("URL is invalid");
    expect(player.urls).toHaveLength(1);
  });

  it("rejects unsafe recording URLs before audio or providers run", async () => {
    const player = fixture();
    for (const audioUrl of ["javascript:alert(1)", "data:audio/mp3;base64,AA==", "http://example.org/a.mp3", "https://user:secret@example.org/a.mp3", "https://example.org/a.mp3?token=x", "https://example.org/a.mp3#fragment"]) {
      await expect(player.play({ ...phrase, audioUrl })).rejects.toThrow();
    }
    expect(player.clips).toHaveLength(0);
    expect(player.requests).toHaveLength(0);
  });

  it("stops a recording on cancel and cancels an earlier phrase on replay", async () => {
    const player = fixture();
    const controller = new AbortController();
    const first = player.play({ ...recording, signal: controller.signal }).then(() => null, (error: Error) => error);
    controller.abort();
    expect((await first)?.name).toBe("AbortError");
    expect(player.clips[0].paused && player.clips[0].cleared).toBe(true);

    const second = player.play(recording).then(() => null, (error: Error) => error);
    const third = player.play(recording);
    expect((await second)?.name).toBe("AbortError");
    expect(player.clips[1].paused).toBe(true);
    expect(player.clips[2].paused).toBe(false);
    player.clips[2].dispatchEvent(new Event("ended"));
    await third;
    expect(player.stops()).toBe(0);
  });

  it("provides an actionable playback permission error and cleans up", async () => {
    const clip = new ReferenceAudio();
    clip.playError = new DOMException("Blocked", "NotAllowedError");
    const player = fixture({ createAudio: () => clip as unknown as HTMLAudioElement });
    await expect(player.play(recording)).rejects.toThrow("press Listen again");
    expect(clip.paused && clip.cleared && clip.loaded).toBe(true);
  });

  it("waits for generated audio to end and forwards configured voice without mic or camera", async () => {
    const ended = deferred<void>();
    const waiting = deferred<void>();
    const player = fixture({ waitForPlayback: () => { waiting.resolve(); return ended.promise; } });
    let completed = false;
    const playback = player.play(phrase).then(() => { completed = true; });
    await waiting.promise;
    expect(completed).toBe(false);
    expect(player.requests).toHaveLength(1);
    expect(player.requests[0].utterance).toMatchObject({ text: "Hola", voice: "Kore", pace: "natural" });
    expect(player.requests[0].utterance.affect).toContain("es-ES");
    expect(player.requests[0].settings).toMatchObject({ microphoneEnabled: false, videoEnabled: false });
    expect(player.requests[0].getApiKey).toBe(player.dependencies.getApiKey);
    expect(player.requests[0]).not.toHaveProperty("playbackRate");
    ended.resolve();
    await playback;
    expect(completed).toBe(true);
  });

  it("cancels generated playback and prevents synthesis after a pending setup is canceled", async () => {
    const ended = deferred<void>();
    const waiting = deferred<void>();
    const player = fixture({ waitForPlayback: () => { waiting.resolve(); return ended.promise; } });
    const controller = new AbortController();
    const playback = player.play({ ...phrase, signal: controller.signal }).then(() => null, (error: Error) => error);
    await waiting.promise;
    controller.abort();
    expect((await playback)?.name).toBe("AbortError");
    expect(player.requests[0].signal?.aborted).toBe(true);
    expect(player.stops()).toBeGreaterThan(1);
    ended.resolve();

    const ready = deferred<void>();
    const pending = fixture({ prime: () => ready.promise });
    const canceledSetup = new AbortController();
    const setup = pending.play({ ...phrase, signal: canceledSetup.signal }).then(() => null, (error: Error) => error);
    canceledSetup.abort();
    expect((await setup)?.name).toBe("AbortError");
    ready.resolve();
    await Promise.resolve();
    expect(pending.requests).toHaveLength(0);
  });

  it("uses configured custom TTS and rejects unavailable or Live-only voices before provider loading", async () => {
    const customModel = { id: "my-voice", label: "My voice", baseUrl: "https://example.org", model: "tts", voice: "native", providerKey: "my-provider" };
    const custom = fixture({ loadSettings: () => ({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "custom:my-voice", customModels: [customModel] }) });
    await custom.play(phrase);
    expect(custom.requests[0].customModel).toEqual(customModel);

    for (const providerId of ["tavus", "openai-realtime", "supertonic-3", "custom:missing"]) {
      let providerLoads = 0;
      const player = fixture({ loadSettings: () => ({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId }), getProvider: async () => { providerLoads++; return null; } });
      await expect(player.play(phrase)).rejects.toThrow("Speech settings");
      expect(providerLoads).toBe(0);
      expect(player.requests).toHaveLength(0);
    }
  });

  it("rejects empty and partially playable provider responses", async () => {
    for (const playedChunks of [0, 1]) {
      const player = fixture();
      player.provider.synthesize = async () => ({ audioChunks: 2, playedChunks, transcript: "Hola" });
      await expect(player.play(phrase)).rejects.toThrow(playedChunks ? "full reference" : "no playable audio");
      expect(player.stops()).toBe(2);
    }
  });
});
