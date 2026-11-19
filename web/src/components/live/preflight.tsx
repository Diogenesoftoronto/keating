import { KeatingGlyph } from "../../design-system/glyphs";

export function startOptions(video: boolean) {
	const modes = video ? (["voice", "camera", "screen"] as const) : (["voice"] as const);
	return modes.map(value => ({value, label: <><KeatingGlyph name={value === "voice" ? "mic" : value} size={14}/>{value[0].toUpperCase() + value.slice(1)}</>}));
}

export function liveReadiness({hasKey, accountLiveSelected, accountLiveConfigured, accountLiveName, providerName, credentialProvider, microphone, needsConsent}: {
	hasKey: boolean | null; accountLiveSelected: boolean; accountLiveConfigured: boolean; accountLiveName: string;
	providerName: string; credentialProvider: boolean; microphone: PermissionState | null; needsConsent: boolean;
}): {label: string; ready?: boolean; reason?: string; action?: string} {
	if (hasKey === null) return {label: "Checking live access…"};
	if (!hasKey && accountLiveSelected) return accountLiveConfigured
		? {label: "Not Organic account needed", reason: `Connect your Not Organic account before starting ${accountLiveName}. The call uses your device-bound live access.`, action: "Connect Not Organic"}
		: {label: `${accountLiveName} is unavailable`, reason: `This deployment has not enabled the Not Organic account service required by ${accountLiveName}.`, action: "Choose a live model"};
	if (!hasKey) return credentialProvider
		? {label: `${providerName} key needed`, reason: `Live mode talks to ${providerName} straight from this browser, and there is no key stored for it yet.`, action: "Add a key"}
		: {label: "No live provider selected", reason: "The current speech provider only synthesizes speech; it cannot hold a conversation.", action: "Choose a live model"};
	if (needsConsent) return {label: "Live consent required", reason: "Review live audio and content logging above before starting."};
	if (microphone === "denied") return {label: "Microphone blocked", reason: "Allow microphone access in your browser’s site permissions to start talking."};
	return {label: microphone === "granted" ? "Ready · microphone allowed" : "Ready to start", ready: true};
}
