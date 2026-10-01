import { DEFAULT_WEB_SPEECH_SETTINGS, loadWebSpeechSettings, saveWebSpeechSettings } from "./speech";

const SPEECH_SETTINGS_STORAGE_KEY = "keating:web:speech";
export const GPT_LIVE_DEFAULT_MODEL = "gpt-live-1";

/** True only when the learner never touched voice settings, so we never override a choice. */
export function shouldDefaultToGptLive(input: { stored: string | null; signedIn: boolean }): boolean {
	return input.signedIn && input.stored === null;
}

/**
 * Signed-in Not Organic accounts get GPT Live as the voice provider until the
 * learner picks one themselves. Returns whether settings changed.
 */
export function applyGptLiveDefaultIfUnset(signedIn: boolean): boolean {
	if (typeof localStorage === "undefined") return false;
	let stored: string | null;
	try { stored = localStorage.getItem(SPEECH_SETTINGS_STORAGE_KEY); } catch { return false; }
	if (!shouldDefaultToGptLive({ stored, signedIn })) return false;
	saveWebSpeechSettings({
		...DEFAULT_WEB_SPEECH_SETTINGS,
		...loadWebSpeechSettings(),
		providerId: "gpt-live",
		model: GPT_LIVE_DEFAULT_MODEL,
	});
	return true;
}
