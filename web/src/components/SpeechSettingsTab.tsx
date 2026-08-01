import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { SettingsSectionNav } from "./SettingsSectionNav";
import { Toggle } from "./Toggle";
import { SettingRow } from "./SettingRow";
import {
	listSpeechProviders,
	resolveSpeechRealtimeTier,
	type CustomSpeechModel,
	type SpeechProviderDescriptor,
	type SpeechProviderId,
	type WebSpeechSettings,
} from "../keating/speech";
import { useKeatingSetting } from "../hooks/use-keating-setting";
import { css, cx } from "../../styled-system/css";

interface SpeechSettingsTabProps {
	onSettingsChange?: (settings: WebSpeechSettings) => void;
	hideNav?: boolean;
}

export const SPEECH_SECTIONS = [
	{ id: "speech-enable", label: "Enable" },
	{ id: "speech-provider", label: "Provider" },
	{ id: "speech-voice", label: "Voice" },
	{ id: "speech-mic", label: "Microphone" },
	{ id: "speech-custom", label: "Custom" },
];

const stackClass = css({ display: "flex", flexDirection: "column", gap: "2rem" });
const sectionClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const sectionTitleClass = css({ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const sectionDescriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const fieldStackClass = css({ display: "flex", flexDirection: "column", gap: "0.5rem" });
const fieldLabelClass = css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" });
const inputClass = css({
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--background)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	color: "var(--foreground)",
});
const monoInputClass = cx(inputClass, css({ fontFamily: "var(--mono-body)" }));
const providerCardClass = css({
	display: "flex",
	cursor: "pointer",
	alignItems: "flex-start",
	gap: "0.75rem",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.75rem",
	paddingBlock: "0.625rem",
	transitionProperty: "color, background-color, border-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "color-mix(in srgb, var(--accent) 40%, transparent)" },
});
const activeProviderClass = css({
	borderColor: "var(--primary)",
	backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
});
const badgeClass = css({
	display: "inline-flex",
	alignItems: "center",
	borderRadius: "9999px",
	border: "1px solid var(--border)",
	backgroundColor: "var(--muted)",
	paddingInline: "0.375rem",
	paddingBlock: "0.125rem",
	fontSize: "10px",
	textTransform: "uppercase",
	letterSpacing: "0.025em",
	color: "var(--muted-foreground)",
});
const iconButtonClass = css({
	display: "inline-flex",
	height: "1.75rem",
	width: "1.75rem",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	color: "var(--muted-foreground)",
	_hover: { backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)" },
});
const primaryButtonClass = css({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	backgroundColor: "var(--primary)",
	paddingInline: "0.75rem",
	paddingBlock: "0.375rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	color: "var(--primary-foreground)",
	transitionProperty: "color, background-color, border-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)" },
	_disabled: { opacity: 0.5 },
});

export function SpeechSettingsTab({ onSettingsChange, hideNav = false }: SpeechSettingsTabProps) {
	const [settings, patch] = useKeatingSetting("speech");
	const [providers, setProviders] = useState<SpeechProviderDescriptor[]>([]);
	const [draftCustom, setDraftCustom] = useState<CustomSpeechModel>({
		id: "",
		label: "",
		baseUrl: "",
		model: "",
		voice: "",
		providerKey: "openai",
	});
	const [customError, setCustomError] = useState<string>("");
	// Vision availability is a property of the chosen model, so the control
	// explains itself rather than failing when the session starts.
	const videoTier = resolveSpeechRealtimeTier(settings);

	useEffect(() => {
		let cancelled = false;
		listSpeechProviders()
			.then((p) => {
				if (!cancelled) setProviders(p);
			})
			.catch(console.warn);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		onSettingsChange?.(settings);
	}, [settings, onSettingsChange]);

	const persist = (partial: Partial<WebSpeechSettings>) => patch(partial);

	const activeProvider = providers.find((p) => p.id === settings.providerId);
	const activeCustom = settings.providerId.startsWith("custom:")
		? settings.customModels.find((m) => `custom:${m.id}` === settings.providerId)
		: undefined;

	const handleProviderChange = (providerId: SpeechProviderId) => {
		if (providerId.startsWith("custom:")) {
			const id = providerId.slice("custom:".length);
			const model = settings.customModels.find((m) => m.id === id);
			if (!model) return;
			persist({ providerId, model: model.model, voiceName: model.voice });
			return;
		}
		const next = providers.find((p) => p.id === providerId);
		if (!next) return;
		const firstModel = next.models[0]?.value ?? "";
		const firstVoice = next.voices[0] ?? "";
		persist({ providerId, model: firstModel, voiceName: firstVoice });
	};

	const addCustomModel = () => {
		setCustomError("");
		const id = draftCustom.id.trim() || draftCustom.label.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
		if (!id || !draftCustom.label.trim() || !draftCustom.baseUrl.trim() || !draftCustom.model.trim()) {
			setCustomError("Label, base URL, and model id are required.");
			return;
		}
		if (settings.customModels.some((m) => m.id === id)) {
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
		persist({ customModels: [...settings.customModels, next] });
		setDraftCustom({ id: "", label: "", baseUrl: "", model: "", voice: "", providerKey: "openai" });
	};

	const removeCustomModel = (id: string) => {
		const remaining = settings.customModels.filter((m) => m.id !== id);
		const patch: Partial<WebSpeechSettings> = { customModels: remaining };
		if (settings.providerId === `custom:${id}`) {
			const fallback = providers[0];
			if (fallback) {
				patch.providerId = fallback.id;
				patch.model = fallback.models[0]?.value ?? "";
				patch.voiceName = fallback.voices[0] ?? "";
			}
		}
		persist(patch);
	};

	const statusBadge = (status: SpeechProviderDescriptor["status"]) => {
		if (status === "stable") return null;
		const styles =
			status === "preview"
				? css({ borderColor: "rgb(245 158 11 / 0.4)", backgroundColor: "rgb(245 158 11 / 0.1)", color: "rgb(217 119 6)" })
				: css({ borderColor: "rgb(168 85 247 / 0.4)", backgroundColor: "rgb(168 85 247 / 0.1)", color: "rgb(147 51 234)" });
		return (
			<span className={cx(css({ marginLeft: "0.5rem", display: "inline-flex", alignItems: "center", borderRadius: "9999px", border: "1px solid", paddingInline: "0.375rem", paddingBlock: "0.125rem", fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.025em" }), styles)}>
				{status}
			</span>
		);
	};

	return (
		<div className={stackClass}>
			{!hideNav && <SettingsSectionNav sections={SPEECH_SECTIONS} />}

			<SettingRow
				id="settings-section-speech-enable"
				title="Enable spoken responses"
				description="When on, Keating can call its voice tool to speak short learner-facing lines through the active provider."
				className={css({ scrollMarginTop: "5rem" })}
			>
				<Toggle checked={settings.enabled} onChange={(checked) => persist({ enabled: checked })} />
			</SettingRow>

			<div id="settings-section-speech-provider" className={sectionClass}>
				<div>
					<h3 className={sectionTitleClass}>Provider</h3>
					<p className={sectionDescriptionClass}>
						Choose which speech engine generates audio. Cloud providers need an API key in Providers & Models.
					</p>
				</div>
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
					{providers.map((p) => (
						<label
							key={p.id}
							className={cx(providerCardClass, settings.providerId === p.id ? activeProviderClass : "")}
						>
							<input
								type="radio"
								name="speech-provider"
								value={p.id}
								checked={settings.providerId === p.id}
								onChange={() => handleProviderChange(p.id)}
								className={css({ marginTop: "0.25rem", flexShrink: 0 })}
							/>
							<div className={css({ minWidth: 0, flex: 1 })}>
								<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>
									<span>{p.label}</span>
									<span className={badgeClass}>
										{p.kind === "duplex" ? "duplex" : "tts"}
									</span>
									{statusBadge(p.status)}
								</div>
								<div className={css({ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{p.description}</div>
								{p.needsApiKey && (
									<div className={css({ marginTop: "0.25rem", fontSize: "11px", color: "var(--muted-foreground)" })}>
										Needs <span className={css({ fontFamily: "var(--mono-body)" })}>{p.needsApiKey}</span> API key in Providers & Models.
									</div>
								)}
							</div>
						</label>
					))}

					{settings.customModels.map((m) => (
						<label
							key={`custom:${m.id}`}
							className={cx(providerCardClass, settings.providerId === `custom:${m.id}` ? activeProviderClass : "")}
						>
							<input
								type="radio"
								name="speech-provider"
								value={`custom:${m.id}`}
								checked={settings.providerId === `custom:${m.id}`}
								onChange={() => handleProviderChange(`custom:${m.id}`)}
								className={css({ marginTop: "0.25rem", flexShrink: 0 })}
							/>
							<div className={css({ minWidth: 0, flex: 1 })}>
								<div className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>{m.label}</div>
								<div className={css({ marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
									{m.baseUrl} · {m.model} · voice {m.voice}
								</div>
							</div>
							<button
								type="button"
								className={iconButtonClass}
								aria-label={`Remove ${m.label}`}
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									removeCustomModel(m.id);
								}}
							>
								<Trash2 size={14} />
							</button>
						</label>
					))}
				</div>
			</div>

			{(activeProvider || activeCustom) && (
				<div id="settings-section-speech-voice" className={sectionClass}>
					<div>
						<h3 className={sectionTitleClass}>Model & voice</h3>
						<p className={sectionDescriptionClass}>
							Fine-tune the active provider's model and voice.
						</p>
					</div>
					{activeProvider && activeProvider.models.length > 1 && (
						<div className={fieldStackClass}>
							<label className={fieldLabelClass}>Model</label>
							<select
								className={inputClass}
								value={settings.model}
								onChange={(e) => persist({ model: e.target.value })}
							>
								{activeProvider.models.map((m) => (
									<option key={m.value} value={m.value}>{m.label}</option>
								))}
							</select>
						</div>
					)}
					{settings.providerId === "openai-realtime" && settings.model.startsWith("gpt-realtime-2") && (
						<div className={fieldStackClass}>
							<label className={fieldLabelClass}>Reasoning effort</label>
							<select
								className={inputClass}
								value={settings.reasoningEffort}
								onChange={(e) => persist({ reasoningEffort: e.target.value as WebSpeechSettings["reasoningEffort"] })}
							>
								<option value="minimal">Minimal — lowest latency</option>
								<option value="low">Low</option>
								<option value="medium">Medium</option>
								<option value="high">High</option>
								<option value="xhigh">Extra high</option>
							</select>
						</div>
					)}
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Voice</label>
						{activeProvider && activeProvider.voices.length > 0 ? (
							<select
								className={inputClass}
								value={settings.voiceName}
								onChange={(e) => persist({ voiceName: e.target.value })}
							>
								{activeProvider.voices.map((v) => (
									<option key={v} value={v}>{v}</option>
								))}
							</select>
						) : (
							<input
								type="text"
								className={inputClass}
								value={settings.voiceName}
								onChange={(e) => persist({ voiceName: e.target.value })}
								placeholder="Voice name"
							/>
						)}
					</div>
				</div>
			)}

			<SettingRow
				id="settings-section-speech-mic"
				title="Microphone (duplex providers)"
				description="When enabled, duplex providers like OpenAI Realtime may capture your microphone for back-and-forth voice. TTS-only providers ignore this."
				className={css({ scrollMarginTop: "5rem" })}
			>
				<Toggle checked={settings.microphoneEnabled} onChange={(checked) => persist({ microphoneEnabled: checked })} />
			</SettingRow>

			<SettingRow
				id="settings-section-speech-video"
				title="Camera or screen (live sessions)"
				description={videoTier.video
					? `${videoTier.label}. ${videoTier.videoRoute === "native"
						? "This model has a live video lane, so Keating streams frames straight to it."
						: "This model has no video lane, so Keating samples still frames instead."}`
					: `Not available on this model. ${videoTier.capReason ?? ""}`}
				className={css({ scrollMarginTop: "5rem" })}
			>
				<Toggle
					checked={settings.videoEnabled && videoTier.video}
					disabled={!videoTier.video}
					onChange={(checked) => persist({ videoEnabled: checked })}
				/>
			</SettingRow>

			{settings.videoEnabled && videoTier.video && (
				<div className={css({ display: "grid", gap: "0.75rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } })}>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Source</label>
						<select
							className={inputClass}
							value={settings.videoSource}
							onChange={(e) => persist({ videoSource: e.target.value as WebSpeechSettings["videoSource"] })}
						>
							<option value="camera">Camera</option>
							<option value="screen">Screen share</option>
						</select>
					</div>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Frame rate</label>
						<select
							className={inputClass}
							value={String(settings.frameIntervalMs)}
							onChange={(e) => persist({ frameIntervalMs: Number(e.target.value) })}
						>
							{/* Both providers cap video at one frame per second. */}
							<option value="1000">1 frame per second — most responsive</option>
							<option value="2000">1 frame every 2 seconds</option>
							<option value="5000">1 frame every 5 seconds — cheapest</option>
						</select>
					</div>
				</div>
			)}

			<div id="settings-section-speech-custom" className={sectionClass}>
				<div>
					<h3 className={sectionTitleClass}>Add custom TTS endpoint</h3>
					<p className={sectionDescriptionClass}>
						Any OpenAI-compatible <code>/v1/audio/speech</code> endpoint can be plugged in here.
					</p>
				</div>
				<div className={css({ display: "grid", gap: "0.75rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } })}>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Label</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g. My Self-Hosted TTS"
							value={draftCustom.label}
							onChange={(e) => setDraftCustom((d) => ({ ...d, label: e.target.value }))}
						/>
					</div>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Base URL</label>
						<input
							type="text"
							className={monoInputClass}
							placeholder="https://tts.example.com"
							value={draftCustom.baseUrl}
							onChange={(e) => setDraftCustom((d) => ({ ...d, baseUrl: e.target.value }))}
						/>
					</div>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Model id</label>
						<input
							type="text"
							className={monoInputClass}
							placeholder="e.g. piper-en-us"
							value={draftCustom.model}
							onChange={(e) => setDraftCustom((d) => ({ ...d, model: e.target.value }))}
						/>
					</div>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Default voice</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g. alloy"
							value={draftCustom.voice}
							onChange={(e) => setDraftCustom((d) => ({ ...d, voice: e.target.value }))}
						/>
					</div>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>Auth key from provider</label>
						<input
							type="text"
							className={monoInputClass}
							placeholder="openai"
							value={draftCustom.providerKey}
							onChange={(e) => setDraftCustom((d) => ({ ...d, providerKey: e.target.value }))}
						/>
					</div>
					<div className={fieldStackClass}>
						<label className={fieldLabelClass}>API path (optional)</label>
						<input
							type="text"
							className={monoInputClass}
							placeholder="/v1/audio/speech"
							value={draftCustom.apiPath ?? ""}
							onChange={(e) => setDraftCustom((d) => ({ ...d, apiPath: e.target.value }))}
						/>
					</div>
				</div>
				{customError && (
					<div className={css({ borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", backgroundColor: "color-mix(in srgb, var(--destructive) 5%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem", color: "var(--destructive)" })}>
						{customError}
					</div>
				)}
				<div className={css({ display: "flex", justifyContent: "flex-end" })}>
					<button
						className={primaryButtonClass}
						onClick={addCustomModel}
					>
						Add custom model
					</button>
				</div>
			</div>
		</div>
	);
}
