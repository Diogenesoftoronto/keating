import { KeatingBot } from "../components/KeatingBot";
import { AppBar, Button, ButtonLink, Loading, Note, Segmented, SelectField, StatusDot } from "../design-system/kit";
import "./live.css";
import { useEffect, useMemo, useState } from "react";
import { liveReadiness, startOptions } from "../components/live/preflight";

import { AssistantChatPanel } from "../components/AssistantChatPanel";

import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { loadWebSpeechSettings, primeSpeechAudio, resolveSpeechRealtimeTier, saveWebSpeechSettings, usesProviderHostedLiveSurface } from "../keating/speech";
import { describeLiveModel, isLiveProviderId, liveModelsFor, recommendedLiveModel } from "../keating/live-models";
import { gptLiveMaxCostMicrousd } from "../keating/speech-providers/gpt-live";
import { GptLiveConsentSettings } from "../components/GptLiveConsentSettings";
import { getProviderApiKey } from "../lib/provider-models";
import { liveCredentialProvider } from "../components/live/use-live-session";
import { useSeo } from "../hooks/useSeo";
import {
	beginNotOrganicAuthorization,
	isNotOrganicFeatureEnabled,
	notOrganicPublicClient,
} from "../notorganic-provider";

/**
 * /live — the pre-flight room for a live conversation.
 *
 * Live mode is not a separate product from chat, and the old page treated it as
 * one: its own session, its own transcript, its own copy of the connection
 * logic, and no way back into the conversation you were already having. Now the
 * conversation itself is owned by the chat panel and appears as a full-screen
 * surface over it, exactly as it does when you press the mic in the composer.
 *
 * What is left here is worth having as a page: somewhere to arrive from a link
 * or a bookmark, check that a key and a model are in place, choose whether the
 * camera starts on, and then step into the call. Everything after "start" is
 * the same code path as the composer button.
 */
export function Live() {
	useSeo({
		title: "Live with Keating",
		description: "Talk to Keating out loud, and show it what you are working on.",
	});

	const { chatPanelRef, dialogs } = useKeatingAgent();
	const [settings, setSettings] = useState(() => loadWebSpeechSettings());
	const [hasKey, setHasKey] = useState<boolean | null>(null);
	const [started, setStarted] = useState(false);
	const [gptLiveConsentGranted, setGptLiveConsentGranted] = useState(false);

	const [microphone, setMicrophone] = useState<PermissionState | null>(null);
	useEffect(() => {
		let active = true;
		let permission: PermissionStatus | undefined;
		const sync = () => { if (active && permission) setMicrophone(permission.state); };
		void navigator.permissions?.query({ name: "microphone" as PermissionName }).then(result => {
			if (!active) return;
			permission = result;
			sync();
			result.addEventListener("change", sync);
		}).catch(() => {});
		return () => { active = false; permission?.removeEventListener("change", sync); };
	}, []);

	const model = useMemo(
		() => describeLiveModel(settings.providerId, settings.model),
		[settings.providerId, settings.model],
	);
	const models = useMemo(() => liveModelsFor(settings.providerId), [settings.providerId]);
	const credentialProvider = liveCredentialProvider(settings.providerId);
	const liveTier = useMemo(() => resolveSpeechRealtimeTier(settings), [settings]);
	const providerHostedLive = usesProviderHostedLiveSurface(settings);
	const accountLiveSelected = settings.providerId === "tavus" || settings.providerId === "gpt-live";
	const accountLiveConfigured = accountLiveSelected && isNotOrganicFeatureEnabled() && Boolean(notOrganicPublicClient());
	const accountLiveName = settings.providerId === "gpt-live" ? "GPT Live" : "Tavus Live";

	useEffect(() => {
		let cancelled = false;
		const check = () => {
			setHasKey(null);
			if (settings.providerId === "tavus" || settings.providerId === "gpt-live") {
				const client = isNotOrganicFeatureEnabled() ? notOrganicPublicClient() : null;
				const session = client?.getSession();
				setHasKey(Boolean(session?.scope.split(/\s+/).includes("realtime:connect")));
				return;
			}
			if (!credentialProvider) {
				setHasKey(false);
				return;
			}
			getProviderApiKey(credentialProvider)
				.then((key) => { if (!cancelled) setHasKey(Boolean(key)); })
				.catch(() => { if (!cancelled) setHasKey(false); });
		};
		check();
		window.addEventListener("keating:api-key-prompt-changed", check);
		window.addEventListener("focus", check);
		return () => {
			cancelled = true;
			window.removeEventListener("keating:api-key-prompt-changed", check);
			window.removeEventListener("focus", check);
		};
	}, [credentialProvider, settings.providerId]);

	const update = (patch: Partial<ReturnType<typeof loadWebSpeechSettings>>) => {
		const next = { ...loadWebSpeechSettings(), ...patch };
		saveWebSpeechSettings(next);
		if (patch.providerId) setHasKey(null);
		setSettings(next);
	};

	useEffect(() => {
		const closed = () => setStarted(false);
		window.addEventListener("keating:live-overlay-closed", closed);
		return () => window.removeEventListener("keating:live-overlay-closed", closed);
	}, []);

	const start = () => {
		// Unlock audio playback from this gesture; browsers will not let the
		// session do it later on its own.
		void primeSpeechAudio().catch(() => {});
		setStarted(true);
		window.dispatchEvent(new CustomEvent("keating:start-live"));
	};

	const providerName = settings.providerId === "tavus"
		? "Tavus"
		: settings.providerId === "gpt-live"
			? "Not Organic"
		: settings.providerId === "openai-realtime"
			? "OpenAI"
			: "Google";
	const notInCatalog = !models.some((entry) => entry.value === model.value);

	const readiness = liveReadiness({hasKey, accountLiveSelected, accountLiveConfigured, accountLiveName,
		providerName, credentialProvider: Boolean(credentialProvider), microphone: providerHostedLive ? null : microphone,
		needsConsent: settings.providerId === "gpt-live" && !gptLiveConsentGranted});
	const startMode = !providerHostedLive && liveTier.video && settings.videoEnabled ? settings.videoSource : "voice";
	const hint = providerHostedLive
		? "Video PAL and Magic Canvas. The Tavus call requests camera and microphone access inside its own secure video surface. Interactive activities appear beside KeatingBot."
		: liveTier.video ? "Voice stays on. You can turn camera or screen sharing on or off during the conversation."
		: liveTier.image ? "Add an image once the conversation starts. This model accepts still images, but it does not receive live video."
		: "This session uses audio only. Choose a provider with visual input to share images or video.";

	return <div className="lv-page">
		<AppBar back={{ label: "Conversation", to: "/chat" }} title="Live with Keating" />
		<div hidden><AssistantChatPanel ref={chatPanelRef} /></div>
		{dialogs}
		<main className="lv-setup">
			<header className="lv-intro k-halftone k-green">
				<KeatingBot variant="body" size={64} state={hasKey === null ? "thinking" : "waving"} animated={false} label="" />
				<div><h1>Talk it through out loud</h1><p>Keating listens, asks, and can look at what you show it.</p></div>
			</header>
			<div className="lv-choices">
				<div className="lv-choice">
					<SelectField label="Who you talk to" aria-label="Live provider" value={settings.providerId} onValueChange={value => {
						if (isLiveProviderId(value)) update({providerId: value, model: recommendedLiveModel(value)?.value ?? "",
							...(value === "gpt-live" ? {voiceName: "marin", videoEnabled: false} : {})});
					}}>
						{!isLiveProviderId(settings.providerId) && <option value={settings.providerId}>{settings.providerId}</option>}
						<option value="tavus">Tavus KeatingBot</option><option value="gpt-live">GPT Live (Not Organic)</option>
						<option value="gemini-live">Gemini Live</option><option value="openai-realtime">OpenAI Realtime</option>
					</SelectField>
				</div>
				<div className="lv-choice">
					<SelectField label="Model" aria-label="Live model" value={model.value} onValueChange={model => update({model})}>
						{notInCatalog && <option value={model.value}>{model.label}</option>}
						{models.map(entry => <option key={entry.value} value={entry.value}>{entry.label}{entry.grade === "recommended" ? " · recommended" : ""}</option>)}
					</SelectField>
					{model.note && <p>{model.note}</p>}
					{settings.providerId === "gpt-live" && <p>Session spending ceiling: ${(gptLiveMaxCostMicrousd() / 1_000_000).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})} USD. Live audio uses your Not Organic balance and requires your account's live consent.</p>}
				</div>
				<div className="lv-choice"><div className="lv-row"><b>Start with</b>
					<Segmented label="Start with" value={startMode} options={startOptions(!providerHostedLive && liveTier.video)}
						onChange={value => update(value === "voice" ? {videoEnabled: false} : {videoEnabled: true, videoSource: value})} />
				</div><p>{hint}</p></div>
			</div>
			<Note data-glyph-host glyph="info"><strong>What is kept</strong>
				<p>Your transcript is saved to this conversation when you end.</p>
				{settings.providerId === "gpt-live" ? <GptLiveConsentSettings onGrantedChange={setGptLiveConsentGranted} />
					: <p>{providerName} handles the audio and any visual input you share. Keating has no retention period to display for this provider.</p>}
			</Note>
			<div className={readiness.reason ? "lv-failure" : "lv-status"}>
				{hasKey === null ? <Loading size="inline" label={readiness.label}/> : <div role="status"><span className="lv-state"><StatusDot aria-hidden="true" tone={readiness.ready ? "ok" : readiness.reason ? "bad" : "idle"}/>{readiness.label}</span>
					{readiness.reason && <p>{readiness.reason}</p>}</div>}
				{readiness.action && <Button variant="primary" onClick={() => {
					if (readiness.action === "Connect Not Organic") void beginNotOrganicAuthorization("/live");
					else window.dispatchEvent(new CustomEvent("keating:open-settings", {detail: {tab: readiness.action === "Add a key" ? "models" : "learning"}}));
				}}>{readiness.action}</Button>}
			</div>
			<footer className="lv-footer"><ButtonLink variant="ghost" glyph="left" to="/chat">Back to the conversation</ButtonLink>
				<Button variant="primary" glyph="wave" disabled={started || !readiness.ready} onClick={start}>{started ? <Loading size="inline" label="Connecting…" /> : "Start talking"}</Button>
			</footer>
		</main>
	</div>;
}

export default Live;
