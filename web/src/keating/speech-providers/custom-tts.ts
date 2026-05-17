import {
	scheduleAudioBlob,
	type CustomSpeechModel,
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";

async function synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	const { utterance, customModel, getApiKey, signal } = request;
	if (!customModel) {
		throw new Error("Custom TTS provider requires a customModel configuration.");
	}
	const model = customModel as CustomSpeechModel;
	const apiKey = await getApiKey(model.providerKey);
	if (!apiKey) {
		throw new Error(`No API key configured for "${model.providerKey}". Add one in Settings → Providers & Models.`);
	}

	const path = model.apiPath || "/v1/audio/speech";
	const url = `${model.baseUrl.replace(/\/$/, "")}${path}`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: model.model,
			voice: utterance.voice || model.voice,
			input: utterance.text,
			response_format: "mp3",
		}),
		signal,
	});

	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(`${model.label} TTS request failed (${response.status}): ${errText.slice(0, 200) || response.statusText}`);
	}

	const blob = await response.blob();
	const played = await scheduleAudioBlob(blob).catch(() => false);

	return {
		audioChunks: 1,
		playedChunks: played ? 1 : 0,
		transcript: utterance.text,
	};
}

export const customTtsProvider: SpeechProvider = {
	id: "custom-tts",
	label: "Custom TTS",
	kind: "tts",
	status: "stable",
	description: "OpenAI-compatible /v1/audio/speech endpoint configured by you.",
	models: [],
	voices: [],
	synthesize,
};
