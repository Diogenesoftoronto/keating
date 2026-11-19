import { expect, test } from "bun:test";
import { DEFAULT_JUDGEMENT_MODEL_SETTINGS } from "../../../keating/judgement-model";
import {
	checkingChoice,
	imageGeneratorChoice,
	speechProviderChoice,
} from "./model-choices";
import { providerStatus } from "../ProviderConnectPanel";

test("choosing hosted Jev restores the account route and retains the token budget", () => {
	const settings = {
		...DEFAULT_JUDGEMENT_MODEL_SETTINGS,
		hostedProvider: "typesafe" as const,
		requestTokens: 2048,
	};
	expect(checkingChoice(settings, "hosted")).toEqual({
		...settings,
		backend: "hosted",
		hostedProvider: "notorganic",
	});
	expect(checkingChoice(settings, "local:julia")).toMatchObject({
		backend: "local",
		localModelId: "julia",
	});
});
test("a new generator clears all dependent choices", () => {
	expect(imageGeneratorChoice("gemini")).toEqual({
		imageGenerator: "gemini",
		imageModel: "",
		imageQuality: "",
		imageSize: "",
	});
});
test("changing voice providers uses its first model and voice and enables duplex microphones", () => {
	const provider = {
		id: "gpt-live",
		kind: "duplex" as const,
		status: "stable" as const,
		label: "GPT Live",
		description: "",
		models: [{ value: "model", label: "Model" }],
		voices: ["First", "Second"],
	};
	expect(speechProviderChoice(provider.id, [provider], [])).toEqual({
		providerId: provider.id,
		model: "model",
		voiceName: "First",
		microphoneEnabled: true,
		videoEnabled: false,
	});
	expect(speechProviderChoice("missing", [provider], [])).toBeUndefined();
	expect(
		speechProviderChoice(
			"custom:test",
			[],
			[
				{
					id: "test",
					model: "m",
					voice: "v",
					apiPath: "",
					providerKey: "p",
					label: "Custom",
					baseUrl: "http://localhost",
				},
			],
		),
	).toEqual({ providerId: "custom:test", model: "m", voiceName: "v" });
});
test("provider rows distinguish credential presence from verification", () => {
	const state = {
		checked: true,
		subscription: false,
		keyed: false,
		connected: false,
	};
	expect(providerStatus(state)).toBe("Needs a key");
	expect(providerStatus({ ...state, checked: false })).toBe("Checking");
	expect(providerStatus({ ...state, subscription: true })).toBe(
		"Not connected yet",
	);
	expect(providerStatus({ ...state, connected: true })).toBe("Connected");
	for (const [verification, label] of [
		[undefined, "Not verified"],
		["ok", "Key works"],
		["invalid", "Key rejected"],
		["error", "Couldn't verify"],
		["checking", "Checking"],
	] as const) {
		expect(
			providerStatus({ ...state, connected: true, keyed: true, verification }),
		).toBe(label);
	}
});
