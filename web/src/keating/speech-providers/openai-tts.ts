import {
	scheduleAudioBlob,
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";
import { withApiRetry } from "../api-retry";

const OPENAI_TTS_VOICES = [
	"alloy",
	"ash",
	"ballad",
	"coral",
	"echo",
	"fable",
	"nova",
	"onyx",
	"sage",
	"shimmer",
	"verse",
];

const OPENAI_TTS_MODELS = [
	{ value: "gpt-4o-mini-tts", label: "GPT-4o mini TTS (steerable)" },
	{ value: "tts-1", label: "tts-1 (fast)" },
	{ value: "tts-1-hd", label: "tts-1 HD (higher quality)" },
];

async function synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	const { utterance, settings, getApiKey, signal } = request;
	const apiKey = await getApiKey("openai");
	if (!apiKey) {
		throw new Error("No OpenAI API key configured. Add one in Settings → Providers & Models.");
	}

	const model = settings.model || "gpt-4o-mini-tts";
	const body: Record<string, unknown> = {
		model,
		voice: utterance.voice,
		input: utterance.text,
		response_format: "mp3",
	};

	if (model === "gpt-4o-mini-tts" && utterance.affect) {
		body.instructions = `Speak with a ${utterance.affect} affect at a ${utterance.pace} pace.`;
	}

	const response = await withApiRetry(async () => {
		const result = await fetch("https://api.openai.com/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
			signal,
		});

		if (!result.ok) {
			const errText = await result.text().catch(() => "");
			const retryAfter = result.headers.get("retry-after");
			throw new Error(`OpenAI TTS request failed (${result.status}): ${errText.slice(0, 200) || result.statusText}${retryAfter ? ` retry-after: ${retryAfter}` : ""}`);
		}
		return result;
	}, { signal });

	const blob = await response.blob();
	const played = await scheduleAudioBlob(blob).catch(() => false);

	return {
		audioChunks: 1,
		playedChunks: played ? 1 : 0,
		transcript: utterance.text,
	};
}

export const openAITtsProvider: SpeechProvider = {
	id: "openai-tts",
	label: "OpenAI TTS",
	kind: "tts",
	status: "stable",
	description: "OpenAI Audio TTS REST API. Steerable affect/pace on gpt-4o-mini-tts.",
	models: OPENAI_TTS_MODELS,
	voices: OPENAI_TTS_VOICES,
	needsApiKey: "openai",
	synthesize,
};
