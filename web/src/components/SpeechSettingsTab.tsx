import { useEffect, useState } from "react";
import {
	Button,
	ConfirmDialog,
	EmptyState,
	Field,
	IconButton,
	Loading,
	SelectField,
	Switch,
	TextInput,
} from "../design-system/kit";
import { speechProviderChoice } from "./settings/models/model-choices";
import { SettingsSectionNav } from "./SettingsSectionNav";

import { SettingRow, SavedHint } from "./settings/ui";
import { AudioModelSelectorDialog } from "./ModelSelector";
import {
	isDuplexSpeechProvider,
	listSpeechProviders,
	resolveSpeechRealtimeTier,
	speechReplyMode,
	usesProviderHostedLiveSurface,
	type CustomSpeechModel,
	type SpeechProviderDescriptor,
	type SpeechProviderId,
	type WebSpeechSettings,
} from "../keating/speech";
import { primeDeviceSpeech } from "../keating/speech-providers/device-speech";
import { useKeatingSetting } from "../hooks/use-keating-setting";

import { gptLiveMaxCostMicrousd } from "../keating/speech-providers/gpt-live";
import { GptLiveConsentSettings } from "./GptLiveConsentSettings";

interface SpeechSettingsTabProps {
	hideNav?: boolean;
}

export const SPEECH_SECTIONS = [
	{ id: "speech-enable", label: "Enable" },
	{ id: "speech-provider", label: "Provider" },
	{ id: "speech-voice", label: "Voice" },
	{ id: "speech-mic", label: "Microphone" },
	{ id: "speech-video", label: "Visual input" },
	{ id: "speech-custom", label: "Custom" },
];

const blankEndpoint: CustomSpeechModel = {
	id: "",
	label: "",
	baseUrl: "",
	model: "",
	voice: "",
	providerKey: "openai",
};
export function speechModelChoice(model: string): Partial<WebSpeechSettings> {
	return { model };
}
export function SpeechSettingsTab({ hideNav = false }: SpeechSettingsTabProps) {
	const [settings, patch] = useKeatingSetting("speech");
	const [providers, setProviders] = useState<SpeechProviderDescriptor[]>([]);
	const [draftCustom, setDraftCustom] =
		useState<CustomSpeechModel>(blankEndpoint);
	const [editing, setEditing] = useState(false);
	const [removing, setRemoving] = useState<CustomSpeechModel | null>(null);
	const [loading, setLoading] = useState(true);
	const [providerError, setProviderError] = useState(false);
	const [customError, setCustomError] = useState<string>("");
	const [audioModelPickerOpen, setAudioModelPickerOpen] = useState(false);
	// Vision availability is a property of the chosen model, so the control
	// explains itself rather than failing when the session starts.
	const liveTier = resolveSpeechRealtimeTier(settings);
	const providerHostedLive = usesProviderHostedLiveSurface(settings);
	const replyMode = speechReplyMode(settings);
	const liveOnlyProvider =
		settings.providerId === "tavus" || settings.providerId === "gpt-live";

	useEffect(() => {
		let cancelled = false;
		listSpeechProviders()
			.then((p) => {
				if (!cancelled) setProviders(p);
			})
			.catch(() => {
				if (!cancelled) setProviderError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const persist = (partial: Partial<WebSpeechSettings>) => patch(partial);

	const activeProvider = providers.find((p) => p.id === settings.providerId);
	const activeCustom = settings.providerId.startsWith("custom:")
		? settings.customModels.find(
				(m) => `custom:${m.id}` === settings.providerId,
			)
		: undefined;

	/**
	 * A duplex provider holds a live conversation with the learner, so a mic
	 * that is already on is the useful default. Half-duplex providers (plain
	 * TTS) stay opt-in: turning the mic on there changes the composer's
	 * behaviour without anything to talk to.
	 */
	const duplexMicDefault = (
		providerId: SpeechProviderId,
	): Partial<WebSpeechSettings> =>
		isDuplexSpeechProvider(providerId) ? { microphoneEnabled: true } : {};

	const handleProviderChange = (providerId: SpeechProviderId) => {
		setAudioModelPickerOpen(false);
		const choice = speechProviderChoice(
			providerId,
			providers,
			settings.customModels,
		);
		if (choice) persist(choice);
	};

	const addCustomModel = () => {
		setCustomError("");
		const id =
			draftCustom.id.trim() ||
			draftCustom.label
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9_-]+/g, "-");
		if (
			!id ||
			!draftCustom.label.trim() ||
			!draftCustom.baseUrl.trim() ||
			!draftCustom.model.trim()
		) {
			setCustomError("Label, base URL, and model id are required.");
			return;
		}
		if (!editing && settings.customModels.some((m) => m.id === id)) {
			setCustomError(`A custom model with id "${id}" already exists.`);
			return;
		}
		const next: CustomSpeechModel = {
			id,
			label: draftCustom.label.trim(),
			baseUrl: draftCustom.baseUrl.trim(),
			model: draftCustom.model.trim(),
			voice: draftCustom.voice.trim() || "alloy",
			providerKey: draftCustom.providerKey.trim() || "openai",
			apiPath: draftCustom.apiPath?.trim() || undefined,
		};
		const customModels = editing
			? settings.customModels.map((m) => (m.id === id ? next : m))
			: [...settings.customModels, next];
		persist({
			customModels,
			...(editing && settings.providerId === "custom:" + id
				? speechProviderChoice(settings.providerId, providers, customModels)
				: {}),
		});
		setEditing(false);
		setDraftCustom(blankEndpoint);
	};

	const removeCustomModel = (id: string) => {
		const remaining = settings.customModels.filter((m) => m.id !== id);
		const patch: Partial<WebSpeechSettings> = { customModels: remaining };
		if (settings.providerId === `custom:${id}`) {
			const fallback = providers[0];
			if (fallback) {
				Object.assign(
					patch,
					speechProviderChoice(fallback.id, providers, remaining),
				);
			}
		}
		persist(patch);
	};

	return (
		<div className="pf-speech">
			{!hideNav && <SettingsSectionNav sections={SPEECH_SECTIONS} />}
			<SettingRow
				id="settings-section-speech-enable"
				label="Enable spoken responses"
				help="When on, Keating can speak short explanations and recaps with the spoken-reply voice below."
				scope="this device"
			>
				<Switch
					labelledBy="settings-section-speech-enable-label"
					checked={settings.enabled}
					onChange={(checked) => {
						persist({
							enabled: checked,
							replyMode,
							...(checked
								? replyMode === "device"
									? { microphoneEnabled: false }
									: duplexMicDefault(settings.providerId)
								: {}),
						});
						if (checked && replyMode === "device") primeDeviceSpeech();
					}}
				/>
			</SettingRow>

			<SettingRow
				id="spoken-mode"
				scope="this device"
				label="Spoken-reply voice"
				help="Device voice reads short chat replies with your browser. Live conversations always use the provider selected below."
			>
				<SelectField
					label="Spoken-reply voice"
					value={replyMode}
					onValueChange={(value) => {
						if (value !== "device" && value !== "provider") return;
						persist({
							replyMode: value,
							...(value === "device" ? { microphoneEnabled: false } : {}),
						});
						if (value === "device" && settings.enabled) primeDeviceSpeech();
					}}
				>
					<option value="device">Device voice</option>
					<option value="provider" disabled={liveOnlyProvider}>
						Selected provider
						{liveOnlyProvider ? " (Live conversations only)" : ""}
					</option>
				</SelectField>
			</SettingRow>

			<SettingRow
				id="settings-section-speech-provider"
				label="Provider"
				scope="this device"
				help="Choose which speech engine generates audio. GPT Live and Tavus use your Not Organic account. Other hosted providers use keys in Models and connections."
			>
				<SelectField
					label="Speech provider"
					value={settings.providerId}
					onValueChange={(v) => handleProviderChange(v as SpeechProviderId)}
				>
					{providers.map((p) => (
						<option key={p.id} value={p.id}>
							{p.label} · {p.kind === "duplex" ? "duplex" : "TTS"}
							{p.status !== "stable" ? " · " + p.status : ""}
						</option>
					))}
					{settings.customModels.map((m) => (
						<option key={m.id} value={"custom:" + m.id}>
							{m.label}
						</option>
					))}
				</SelectField>
				{loading && <Loading label="Loading speech providers" size="inline" />}
				{providerError && <p role="alert">Could not load speech providers.</p>}
				{activeProvider && (
					<p>
						{activeProvider.description}{" "}
						{activeProvider.needsApiKey &&
							"Needs " +
								activeProvider.needsApiKey +
								" API key in Models and connections."}
					</p>
				)}
				{activeCustom && (
					<p>
						{activeCustom.baseUrl} · {activeCustom.model} · voice{" "}
						{activeCustom.voice}
					</p>
				)}
			</SettingRow>
			{settings.providerId === "gpt-live" ? (
				<>
					<SettingRow
						id="live-account"
						scope="your account"
						label="GPT Live account access"
						help={`Connect Not Organic under Models and connections and review live consent below. Each session has a $${(gptLiveMaxCostMicrousd() / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USD spending ceiling. This provider supports voice conversation without live tools or visual input.`}
					>
						<Button
							onClick={() =>
								window.dispatchEvent(
									new CustomEvent("keating:open-settings", {
										detail: { section: "account" },
									}),
								)
							}
						>
							Account settings
						</Button>
					</SettingRow>
				</>
			) : null}

			<div id="settings-section-live-consent">
				<GptLiveConsentSettings />
			</div>
			{(activeProvider || activeCustom) && (
				<section id="settings-section-speech-voice" className="pf-fields">
					<h4>Model and voice</h4>
					{activeProvider && (
						<div>
							<small>Model</small>
							{activeProvider.models.length > 1 ? (
								<Button
									aria-haspopup="dialog"
									aria-label={"Change speech model: " + settings.model}
									onClick={() => setAudioModelPickerOpen(true)}
								>
									{activeProvider.models.find((m) => m.value === settings.model)
										?.label ?? settings.model}
								</Button>
							) : (
								<p>{activeProvider.models[0]?.label ?? settings.model}</p>
							)}
						</div>
					)}
					{activeProvider && (
						<AudioModelSelectorDialog
							open={audioModelPickerOpen}
							provider={activeProvider}
							currentModelId={settings.model}
							onClose={() => setAudioModelPickerOpen(false)}
							onSelect={(modelId) => {
								persist(speechModelChoice(modelId));
							}}
						/>
					)}
					{settings.providerId === "openai-realtime" &&
						settings.model.startsWith("gpt-realtime-2") && (
							<div className="pf-field">
								<SelectField
									id="speech-effort"
									label="Reasoning effort"
									value={settings.reasoningEffort}
									onValueChange={(value) =>
										persist({
											reasoningEffort:
												value as WebSpeechSettings["reasoningEffort"],
										})
									}
								>
									<option value="minimal">Minimal — lowest latency</option>
									<option value="low">Low</option>
									<option value="medium">Medium</option>
									<option value="high">High</option>
									<option value="xhigh">Extra high</option>
								</SelectField>
							</div>
						)}
					{settings.providerId !== "tavus" ? (
						<div className="pf-field">
							{activeProvider && activeProvider.voices.length > 0 ? (
								<SelectField
									id="speech-voice-name"
									label="Voice"
									value={settings.voiceName}
									onValueChange={(value) => persist({ voiceName: value })}
								>
									{activeProvider.voices.map((v) => (
										<option key={v} value={v}>
											{v}
										</option>
									))}
								</SelectField>
							) : (
								<TextInput
									id="speech-voice-name"
									aria-label="Voice"
									type="text"
									value={settings.voiceName}
									onChange={(e) => persist({ voiceName: e.target.value })}
									placeholder="Voice name"
								/>
							)}
						</div>
					) : null}
				</section>
			)}

			<SettingRow
				id="settings-section-speech-mic"
				label="Microphone (duplex providers)"
				help="Duplex providers like GPT Live and OpenAI Realtime hold a live conversation, so the microphone turns on with them. TTS-only providers ignore this."
				scope="this device"
			>
				<Switch
					labelledBy="settings-section-speech-mic-label"
					checked={settings.microphoneEnabled}
					onChange={(checked) => persist({ microphoneEnabled: checked })}
				/>
			</SettingRow>

			<SettingRow
				id="settings-section-speech-video"
				label={
					providerHostedLive
						? "Tavus video and activities"
						: liveTier.video
							? "Camera or screen (live sessions)"
							: liveTier.image
								? "Still images (live sessions)"
								: "Visual input (live sessions)"
				}
				help={
					providerHostedLive
						? "KeatingBot sees and hears through the private Tavus call. Its Magic Canvas can show questions, inputs, charts, images, and other interactive activities inside the video surface."
						: liveTier.video
							? `${liveTier.label}. This model has a live video lane, so Keating can use the camera or a shared screen.`
							: liveTier.image
								? `${liveTier.label}. Add a deliberate JPEG or PNG during the conversation. This model does not receive camera or screen video.`
								: `Not available on this model. ${liveTier.capReason ?? ""}`
				}
				scope="this device"
			>
				{providerHostedLive ? (
					<span className="pf-meta">Controlled in Live</span>
				) : liveTier.video ? (
					<Switch
						labelledBy="settings-section-speech-video-label"
						checked={settings.videoEnabled}
						onChange={(checked) => persist({ videoEnabled: checked })}
					/>
				) : liveTier.image ? (
					<span className="pf-meta">Available in Live</span>
				) : (
					<Switch
						labelledBy="settings-section-speech-video-label"
						checked={false}
						disabled
						onChange={() => {}}
					/>
				)}
			</SettingRow>

			{settings.videoEnabled && liveTier.video && !providerHostedLive && (
				<div className="pf-fields">
					<div className="pf-field">
						<SelectField
							id="speech-source"
							label="Video source"
							value={settings.videoSource}
							onValueChange={(value) =>
								persist({
									videoSource: value as WebSpeechSettings["videoSource"],
								})
							}
						>
							<option value="camera">Camera</option>
							<option value="screen">Screen share</option>
						</SelectField>
					</div>
					<div className="pf-field">
						<SelectField
							id="speech-frame-rate"
							label="Video frame rate"
							value={String(settings.frameIntervalMs)}
							onValueChange={(value) =>
								persist({ frameIntervalMs: Number(value) })
							}
						>
							{/* Gemini Live accepts at most one video frame per second. */}
							<option value="1000">1 frame per second — most responsive</option>
							<option value="2000">1 frame every 2 seconds</option>
							<option value="5000">1 frame every 5 seconds — cheapest</option>
						</SelectField>
					</div>
				</div>
			)}

			<section id="settings-section-speech-custom" className="pf-fields">
				<h4>Custom speech endpoints</h4>
				<p>
					Any OpenAI-compatible <code>/v1/audio/speech</code> endpoint can be
					plugged in here.
				</p>
				{settings.customModels.length === 0 && (
					<EmptyState heading="No custom speech endpoints" />
				)}
				{settings.customModels.map((m) => (
					<div className="pf-endpoint" key={m.id}>
						<strong>{m.label}</strong>
						<span>
							{m.baseUrl} · {m.model}
						</span>
						<Button
							variant="ghost"
							onClick={() => {
								setEditing(true);
								setDraftCustom({ ...m });
								setCustomError("");
							}}
						>
							Edit {m.label}
						</Button>
						<IconButton
							glyph="trash"
							label={"Remove " + m.label}
							disabled={
								settings.providerId === "custom:" + m.id && !providers.length
							}
							onClick={() => setRemoving(m)}
						/>
					</div>
				))}
				<h4>
					{editing ? "Edit custom TTS endpoint" : "Add custom TTS endpoint"}
				</h4>
				<div className="pf-endpoint-fields">
					{(
						[
							["label", "Label", "e.g. My Self-Hosted TTS"],
							["baseUrl", "Base URL", "https://tts.example.com"],
							["model", "Model id", "e.g. piper-en-us"],
							["voice", "Default voice", "e.g. alloy"],
							["providerKey", "Auth key from provider", "openai"],
							["apiPath", "API path (optional)", "/v1/audio/speech"],
						] as const
					).map(([key, label, hint]) => (
						<Field key={key} label={label}>
							<TextInput
								placeholder={hint}
								value={draftCustom[key] ?? ""}
								onChange={(e) =>
									setDraftCustom((d) => ({ ...d, [key]: e.target.value }))
								}
							/>
						</Field>
					))}
				</div>
				{customError && <p role="alert">{customError}</p>}
				<div className="pf-persona-actions">
					{editing && (
						<Button
							variant="ghost"
							onClick={() => {
								setDraftCustom(blankEndpoint);
								setEditing(false);
								setCustomError("");
							}}
						>
							Cancel
						</Button>
					)}
					<Button variant="primary" onClick={addCustomModel}>
						{editing ? "Save endpoint" : "Add custom model"}
					</Button>
				</div>
				<ConfirmDialog
					open={!!removing}
					title="Remove custom speech endpoint?"
					description={removing?.label ?? ""}
					confirmLabel="Remove endpoint"
					onCancel={() => setRemoving(null)}
					onConfirm={() => {
						if (removing) {
							removeCustomModel(removing.id);
							if (editing && draftCustom.id === removing.id) {
								setEditing(false);
								setDraftCustom(blankEndpoint);
							}
						}
						setRemoving(null);
					}}
				/>
			</section>
			<SavedHint />
		</div>
	);
}
