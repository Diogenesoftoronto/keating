import {
  getSpeechProvider,
  loadWebSpeechSettings,
  normalizeVoiceUtterance,
  primeSpeechAudio,
  stopScheduledAudio,
  waitForSpeechPlayback,
  type SpeechProvider,
  type WebSpeechSettings,
} from "../../keating/speech";

export interface LanguageReferenceOptions {
  text: string;
  language: string;
  audioUrl?: string;
  slow?: boolean;
  signal?: AbortSignal;
}

export interface LanguageSpeechDependencies {
  loadSettings: () => WebSpeechSettings;
  getProvider: (id: string) => Promise<SpeechProvider | null>;
  getCustomProvider: () => Promise<SpeechProvider>;
  getApiKey: (provider: string) => Promise<string | undefined>;
  createAudio: (url: string) => HTMLAudioElement;
  prime: () => Promise<void>;
  waitForPlayback: (signal?: AbortSignal) => Promise<void>;
  stopAudio: () => void;
}

const defaults: LanguageSpeechDependencies = {
  loadSettings: loadWebSpeechSettings,
  getProvider: getSpeechProvider,
  getCustomProvider: async () => (await import("../../keating/speech-providers/custom-tts")).customTtsProvider,
  getApiKey: async (provider) => (await import("../../lib/provider-models")).getProviderApiKey(provider),
  createAudio: (url) => new Audio(url),
  prime: primeSpeechAudio,
  waitForPlayback: waitForSpeechPlayback,
  stopAudio: stopScheduledAudio,
};

function canceled(): DOMException {
  return new DOMException("Reference playback canceled.", "AbortError");
}

function checkCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw canceled();
}

function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(canceled()); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    work().then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(canceled()); else resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(signal.aborted ? canceled() : error);
    });
  });
}

function playAuthoredAudio(audio: HTMLAudioElement, options: LanguageReferenceOptions, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", abort);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const ended = () => finish(signal.aborted ? canceled() : undefined);
    const failed = () => finish(new Error("The reference audio could not be played. Try again."));
    const abort = () => finish(canceled());
    audio.preload = "auto";
    audio.lang = options.language;
    audio.playbackRate = options.slow ? 0.75 : 1;
    audio.preservesPitch = true;
    audio.addEventListener("ended", ended, { once: true });
    audio.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void audio.play().catch((error: unknown) => finish(new Error(error instanceof Error && error.name === "NotAllowedError"
      ? "Audio is blocked. Allow playback in your browser and press Listen again."
      : "The reference audio could not be played. Try again.")));
  });
}

/** A separate player can be supplied to a preview without calling a paid provider. */
export function createLanguageReferencePlayer(overrides: Partial<LanguageSpeechDependencies> = {}) {
  const services = { ...defaults, ...overrides };
  let active: AbortController | undefined;

  return async function play(options: LanguageReferenceOptions): Promise<void> {
    if (options.signal?.aborted) throw canceled();
    let audioUrl: string | undefined;
    if (options.audioUrl) {
      let parsed: URL;
      try {
        parsed = options.audioUrl.startsWith("/") && !options.audioUrl.startsWith("//")
          ? new URL(options.audioUrl, typeof window === "undefined" ? undefined : window.location?.origin)
          : new URL(options.audioUrl);
      } catch { throw new Error("This reference audio URL is invalid."); }
      const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Reference audio must use a public HTTPS or local audio URL without credentials or query parameters.");
      audioUrl = parsed.href;
    } else if (!options.text.trim()) throw new Error("This phrase has no text to read.");

    active?.abort();
    const controller = new AbortController();
    active = controller;
    const signal = controller.signal;
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    let usingSharedAudio = false;
    const stop = () => { if (usingSharedAudio) services.stopAudio(); };
    signal.addEventListener("abort", stop, { once: true });
    try {
      await abortable(async () => {
        if (audioUrl) {
          await playAuthoredAudio(services.createAudio(audioUrl), options, signal);
          return;
        }
        // Prime in the original Listen gesture, before provider/key loading awaits.
        await services.prime();
        checkCanceled(signal);
        const settings = services.loadSettings();
        if (settings.providerId === "tavus" || settings.providerId === "openai-realtime") {
          throw new Error("This voice is for Live conversations. Choose a TTS voice in Speech settings to hear reference phrases, or continue in Live.");
        }
        if (settings.providerId === "supertonic-3") {
          throw new Error("Local speech is not available yet. Choose another TTS voice in Speech settings to hear this phrase.");
        }
        const customModel = settings.providerId.startsWith("custom:")
          ? settings.customModels.find((model) => model.id === settings.providerId.slice("custom:".length))
          : undefined;
        if (settings.providerId.startsWith("custom:") && !customModel) throw new Error("This custom voice is no longer configured. Choose a voice in Speech settings.");
        const provider = customModel ? await services.getCustomProvider() : await services.getProvider(settings.providerId);
        checkCanceled(signal);
        if (!provider) throw new Error("Choose a voice in Speech settings to hear reference phrases.");
        const utterance = normalizeVoiceUtterance({
          text: options.text,
          pace: options.slow ? "slow and deliberate" : "natural",
          affect: `clear and natural, with native ${options.language.trim() || "the phrase's language"} pronunciation`,
        }, settings);
        services.stopAudio();
        usingSharedAudio = true;
        const result = await provider.synthesize({
          utterance,
          settings: { ...settings, microphoneEnabled: false, videoEnabled: false },
          customModel,
          getApiKey: services.getApiKey,
          signal,
        });
        checkCanceled(signal);
        if (result.playedChunks <= 0) throw new Error("The voice returned no playable audio. Check Speech settings and try again.");
        if (result.playedChunks < result.audioChunks) throw new Error("The full reference could not be played. Try again.");
        await services.waitForPlayback(signal);
        checkCanceled(signal);
      }, signal);
    } catch (error) {
      if (usingSharedAudio && active === controller) services.stopAudio();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      signal.removeEventListener("abort", stop);
      if (active === controller) active = undefined;
    }
  };
}

/** Call directly from a user gesture when the UI starts other asynchronous work first. */
export function primeLanguageAudio(): Promise<void> {
  return primeSpeechAudio();
}

/** Resolves after the reference ends, never just after synthesis is queued. */
export const playLanguageReference = createLanguageReferencePlayer();
