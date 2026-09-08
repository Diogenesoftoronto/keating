// One-shot speech-to-text used by the prompt mic button. Routes to OpenAI's
// transcription endpoint or Gemini depending on the resolved credential.
import { proxiedProviderRequestUrl } from "../../lib/provider-proxy";
import type { SpeechCredentialProvider } from "../speech";

export interface SttOptions {
	provider: SpeechCredentialProvider;
	apiKey: string;
	model?: string;
	signal?: AbortSignal;
}

export interface MicRecorder {
	readonly stream: MediaStream;
	stop(): Promise<Blob>;
	cancel(): void;
}

/** Start recording from the default microphone. Throws if mic access fails. */
export async function startMicRecording(): Promise<MicRecorder> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		throw new Error("Microphone is not available in this browser.");
	}
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	const recorder = new MediaRecorder(stream);
	const chunks: BlobPart[] = [];
	recorder.addEventListener("dataavailable", (event) => {
		if (event.data && event.data.size > 0) chunks.push(event.data);
	});
	recorder.start();

	const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

	return {
		stream,
		stop: () =>
			new Promise<Blob>((resolve) => {
				recorder.addEventListener(
					"stop",
					() => {
						stopTracks();
						resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
					},
					{ once: true },
				);
				try {
					recorder.stop();
				} catch {
					stopTracks();
					resolve(new Blob(chunks, { type: "audio/webm" }));
				}
			}),
		cancel: () => {
			try {
				recorder.stop();
			} catch {
				// ignore
			}
			stopTracks();
		},
	};
}

async function blobToBase64(blob: Blob): Promise<string> {
	const buffer = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (const byte of buffer) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function transcribeOpenAi(blob: Blob, opts: SttOptions): Promise<string> {
	const proxied = proxiedProviderRequestUrl("https://api.openai.com/v1/audio/transcriptions");
	const form = new FormData();
	form.append("file", blob, "speech.webm");
	form.append("model", opts.model || "gpt-4o-transcribe");

	const response = await fetch(proxied.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${opts.apiKey}`,
			"x-target-url": proxied.targetBaseUrl,
			// Note: do NOT set content-type — the browser sets the multipart boundary.
		},
		body: form,
		signal: opts.signal,
	});

	const payload = await response
		.json()
		.catch(async () => ({ error: { message: await response.text().catch(() => response.statusText) } }));
	if (!response.ok) {
		const message = payload?.error?.message ?? response.statusText;
		throw Object.assign(new Error(String(message).slice(0, 500)), { status: response.status });
	}
	return String(payload?.text ?? "").trim();
}

async function transcribeGoogle(blob: Blob, opts: SttOptions): Promise<string> {
	const { GoogleGenAI } = await import("@google/genai");
	const ai = new GoogleGenAI({ apiKey: opts.apiKey });
	const audio = await blobToBase64(blob);
	const result = await ai.models.generateContent({
		model: opts.model || "gemini-2.5-flash",
		contents: [
			{
				role: "user",
				parts: [
					{ text: "Transcribe this audio verbatim. Return only the transcript text, with no commentary." },
					{ inlineData: { mimeType: blob.type || "audio/webm", data: audio } },
				],
			},
		],
	});
	return String((result as any).text ?? "").trim();
}

/** Transcribe a recorded audio blob to text. */
export async function transcribeAudio(blob: Blob, opts: SttOptions): Promise<string> {
	if (blob.size === 0) return "";
	if (opts.provider === "openai") return transcribeOpenAi(blob, opts);
	return transcribeGoogle(blob, opts);
}

/** Product-facing recovery advice; never render raw provider responses. */
export function transcriptionErrorMessage(error: unknown): string {
  const value = error as { status?: number; code?: number; message?: string };
  const status = Number(value?.status ?? value?.code);
  if (status === 401 || status === 403)
    return "The speech provider rejected your credentials. Check your speech provider key in Settings.";
  if (status === 429)
    return "The speech provider has reached a usage or rate limit. Check your quota, or wait before retrying.";
  if (status === 413)
    return "This recording is too large for the speech provider. Try a shorter clip.";
  if (status === 400 || status === 415 || status === 422)
    return "The speech provider could not read this recording. Try a shorter clip or a different speech provider.";
  if (status === 404)
    return "The transcription model is unavailable. Check your speech provider in Settings.";
  if (status >= 500)
    return "The speech provider is temporarily unavailable. Try again in a moment.";
  if (error instanceof TypeError || /network|fetch|offline|timeout/i.test(value?.message ?? ""))
    return "Could not reach the speech provider. Check your connection and try again.";
  return "The speech provider could not transcribe this recording. Try again or choose another speech provider in Settings.";
}
