import { GOOGLE_DECISION_PROVIDER } from "@keating/runtime-config";
import type { JudgementModelSettings } from "../../../keating/judgement-model";
import {
	isDuplexSpeechProvider,
	type SpeechProviderDescriptor,
	type WebSpeechSettings,
} from "../../../keating/speech";
import type { ImageGeneratorId } from "../../../lib/image-generators";

export function imageGeneratorChoice(imageGenerator: ImageGeneratorId) {
	return { imageGenerator, imageModel: "", imageSize: "", imageQuality: "" };
}

export function speechProviderChoice(
	id: string,
	providers: SpeechProviderDescriptor[],
	custom: WebSpeechSettings["customModels"],
): Partial<WebSpeechSettings> | undefined {
	if (id.startsWith("custom:")) {
		const model = custom.find((item) => "custom:" + item.id === id);
		if (model)
			return { providerId: id, model: model.model, voiceName: model.voice };
		return;
	}
	const provider = providers.find((item) => item.id === id);
	if (!provider) return;
	return {
		providerId: provider.id,
		model: provider.models[0]?.value ?? "",
		voiceName: provider.voices[0] ?? "",
		...(provider.id === "gpt-live" ? { videoEnabled: false } : {}),
		...(isDuplexSpeechProvider(provider.id) ? { microphoneEnabled: true } : {}),
	};
}

export function checkingChoice(
	settings: JudgementModelSettings,
	value: string,
): JudgementModelSettings {
	if (value.startsWith("local:"))
		return { ...settings, backend: "local", localModelId: value.slice(6) };
	return {
		...settings,
		backend: value === "off" ? "off" : "hosted",
		hostedProvider:
			value === "typesafe" || value === GOOGLE_DECISION_PROVIDER
				? value
				: "notorganic",
	};
}

export function openModelSection(section: string) {
	window.dispatchEvent(
		new CustomEvent("keating:settings-tab", { detail: section }),
	);
}
