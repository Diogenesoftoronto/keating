import {
	getAudioContext,
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";
import { withApiRetry } from "../api-retry";

const REALTIME_MODELS = [
	{ value: "gpt-realtime-2", label: "gpt-realtime-2 (latest)" },
	{ value: "gpt-realtime", label: "gpt-realtime" },
	{ value: "gpt-realtime-mini", label: "gpt-realtime-mini" },
	{ value: "gpt-4o-realtime-preview-2024-12-17", label: "gpt-4o-realtime-preview" },
	{ value: "gpt-4o-mini-realtime-preview-2024-12-17", label: "gpt-4o-mini-realtime-preview" },
];

const REALTIME_VOICES = [
	"alloy",
	"ash",
	"ballad",
	"cedar",
	"coral",
	"echo",
	"marin",
	"sage",
	"shimmer",
	"verse",
];

function cleanRealtimeVoice(value: string | undefined): string {
	const requested = (value ?? "").trim().toLowerCase();
	return REALTIME_VOICES.includes(requested) ? requested : "marin";
}

async function mintEphemeralKey(apiKey: string, model: string, voice: string, signal?: AbortSignal): Promise<string> {
	const response = await withApiRetry(async () => {
		const result = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				session: {
					type: "realtime",
					model,
					audio: {
						output: { voice },
					},
				},
			}),
			signal,
		});
		if (!result.ok) {
			const errText = await result.text().catch(() => "");
			const retryAfter = result.headers.get("retry-after");
			throw new Error(`Realtime session mint failed (${result.status}): ${errText.slice(0, 200) || result.statusText}${retryAfter ? ` retry-after: ${retryAfter}` : ""}`);
		}
		return result;
	}, { signal });
	const data = (await response.json()) as { value?: string; client_secret?: { value?: string } };
	const value = data.value ?? data.client_secret?.value;
	if (!value) throw new Error("Realtime session mint returned no ephemeral secret value");
	return value;
}

async function attachMicrophone(pc: RTCPeerConnection): Promise<MediaStream | null> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
		return stream;
	} catch (err) {
		console.warn("[keating:realtime] microphone unavailable", err);
		return null;
	}
}

async function synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	const { utterance, settings, getApiKey, signal } = request;
	const apiKey = await getApiKey("openai");
	if (!apiKey) {
		throw new Error("No OpenAI API key configured. Add one in Settings → Providers & Models.");
	}

	const model = settings.model || "gpt-realtime-2";
	const voice = cleanRealtimeVoice(utterance.voice || settings.voiceName);

	const ephemeralKey = await mintEphemeralKey(apiKey, model, voice, signal);

	const pc = new RTCPeerConnection();
	const audioEl = typeof document !== "undefined" ? document.createElement("audio") : null;
	if (audioEl) {
		audioEl.autoplay = true;
		audioEl.style.display = "none";
		document.body.appendChild(audioEl);
	}

	let audioChunks = 0;
	let playedChunks = 0;
	let micStream: MediaStream | null = null;
	let cleanedUp = false;

	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		try { pc.close(); } catch {}
		micStream?.getTracks().forEach((t) => t.stop());
		if (audioEl) {
			try { audioEl.pause(); } catch {}
			audioEl.srcObject = null;
			audioEl.remove();
		}
	};

	if (signal?.aborted) {
		cleanup();
		throw new Error("OpenAI Realtime aborted before start.");
	}
	signal?.addEventListener("abort", cleanup, { once: true });

	pc.ontrack = (event) => {
		audioChunks += 1;
		if (audioEl && event.streams[0]) {
			audioEl.srcObject = event.streams[0];
			audioEl.play().then(() => { playedChunks += 1; }).catch(() => {});
		}
	};

	const dataChannel = pc.createDataChannel("oai-events");

	if (settings.microphoneEnabled) {
		micStream = await attachMicrophone(pc);
	}

	return await new Promise<SpeechSynthesisResult>(async (resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("OpenAI Realtime response timed out."));
		}, 60_000);

		dataChannel.addEventListener("open", () => {
			dataChannel.send(JSON.stringify({
				type: "response.create",
				response: {
					modalities: ["audio", "text"],
					instructions: `Speak this learner-facing line exactly. Affect: ${utterance.affect}. Pace: ${utterance.pace}.\n\n${utterance.text}`,
				},
			}));
		});

		dataChannel.addEventListener("message", (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "response.done") {
					clearTimeout(timer);
					cleanup();
					resolve({
						audioChunks,
						playedChunks,
						transcript: utterance.text,
						warning: settings.microphoneEnabled && !micStream ? "Microphone unavailable" : undefined,
					});
				}
				if (msg.type === "error") {
					clearTimeout(timer);
					cleanup();
					reject(new Error(`Realtime error: ${msg.error?.message ?? "unknown"}`));
				}
			} catch {}
		});

		try {
			getAudioContext();
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);

			const sdpResponse = await withApiRetry(async () => {
				const result = await fetch("https://api.openai.com/v1/realtime/calls", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${ephemeralKey}`,
						"Content-Type": "application/sdp",
					},
					body: offer.sdp,
					signal,
				});
				if (!result.ok) {
					const retryAfter = result.headers.get("retry-after");
					throw new Error(`Realtime SDP exchange failed (${result.status})${retryAfter ? ` retry-after: ${retryAfter}` : ""}`);
				}
				return result;
			}, { signal });
			const answer: RTCSessionDescriptionInit = {
				type: "answer",
				sdp: await sdpResponse.text(),
			};
			await pc.setRemoteDescription(answer);
		} catch (error) {
			clearTimeout(timer);
			cleanup();
			reject(error);
		}
	});
}

export const openAIRealtimeProvider: SpeechProvider = {
	id: "openai-realtime",
	label: "OpenAI Realtime",
	kind: "duplex",
	status: "preview",
	description: "WebRTC duplex voice with OpenAI Realtime. Supports mic input when enabled. One-shot per utterance — long-lived sessions are a follow-up.",
	models: REALTIME_MODELS,
	voices: REALTIME_VOICES,
	needsApiKey: "openai",
	synthesize,
};
