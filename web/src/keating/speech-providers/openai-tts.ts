import { DEFAULT_MODELS, MODEL_CHOICES, MODEL_PREFERENCES, PROVIDER_ENDPOINTS } from "@keating/runtime-config";
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
	"cedar",
	"coral",
	"echo",
	"fable",
	"marin",
	"nova",
	"onyx",
	"sage",
	"shimmer",
	"verse",
];

const OPENAI_TTS_MODELS = MODEL_CHOICES.openaiTts;

const LEGACY_TTS_VOICES = new Set([
	"alloy",
	"ash",
	"coral",
	"echo",
	"fable",
	"onyx",
	"nova",
	"sage",
	"shimmer",
]);

function cleanVoice(value: string | undefined, model: string): string {
	const requested = (value ?? "").trim().toLowerCase();
	if (model === MODEL_CHOICES.openaiTts[1].value || model === MODEL_CHOICES.openaiTts[2].value) {
		return LEGACY_TTS_VOICES.has(requested) ? requested : "alloy";
	}
	return OPENAI_TTS_VOICES.includes(requested) ? requested : "marin";
}

async function synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	const { utterance, settings, getApiKey, signal } = request;
	const apiKey = await getApiKey("openai");
	if (!apiKey) {
		throw new Error("No OpenAI API key configured. Add one in Settings → Providers & Models.");
	}

	const model = settings.model || DEFAULT_MODELS.speech.ttsOpenai;
	const voice = cleanVoice(utterance.voice || settings.voiceName, model);
	const body: Record<string, unknown> = {
		model,
		voice,
		input: utterance.text,
		response_format: "mp3",
	};

	if (model === MODEL_PREFERENCES.speech.steerableTts[0] && utterance.affect) {
		body.instructions = `Speak with a ${utterance.affect} affect at a ${utterance.pace} pace.`;
	}

	const response = await withApiRetry(async () => {
		const result = await fetch(PROVIDER_ENDPOINTS.openaiSpeech, {
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
	const played = await scheduleAudioBlob(blob, { signal }).catch(() => false);

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
	description: `OpenAI Audio TTS REST API. Steerable affect/pace on ${MODEL_PREFERENCES.speech.steerableTts[0]}.`,
	models: OPENAI_TTS_MODELS,
	voices: OPENAI_TTS_VOICES,
	needsApiKey: "openai",
	synthesize,
};
