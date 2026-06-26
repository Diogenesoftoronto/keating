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
		throw new Error(`Transcription failed (${response.status}): ${String(message).slice(0, 500)}`);
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
