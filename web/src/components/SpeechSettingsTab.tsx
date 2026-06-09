import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { SettingsSectionNav } from "./SettingsSectionNav";
import { Toggle } from "./Toggle";
import { SettingRow } from "./SettingRow";
import {
	listSpeechProviders,
	loadWebSpeechSettings,
	saveWebSpeechSettings,
	type CustomSpeechModel,
	type SpeechProviderDescriptor,
	type SpeechProviderId,
	type WebSpeechSettings,
} from "../keating/speech";

interface SpeechSettingsTabProps {
	onSettingsChange?: (settings: WebSpeechSettings) => void;
}

export function SpeechSettingsTab({ onSettingsChange }: SpeechSettingsTabProps) {
	const [settings, setSettingsState] = useState<WebSpeechSettings>(() => loadWebSpeechSettings());
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

	const persist = useCallback(
		(partial: Partial<WebSpeechSettings>) => {
			const next = { ...loadWebSpeechSettings(), ...partial };
			setSettingsState(next);
			saveWebSpeechSettings(next);
			onSettingsChange?.(next);
		},
		[onSettingsChange],
	);

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

	const SECTIONS = [
		{ id: "speech-enable", label: "Enable" },
		{ id: "speech-provider", label: "Provider" },
		{ id: "speech-voice", label: "Voice" },
		{ id: "speech-mic", label: "Microphone" },
		{ id: "speech-custom", label: "Custom" },
	];

	const statusBadge = (status: SpeechProviderDescriptor["status"]) => {
		if (status === "stable") return null;
		const styles =
			status === "preview"
				? "border-amber-500/40 bg-amber-500/10 text-amber-600"
				: "border-purple-500/40 bg-purple-500/10 text-purple-600";
		return (
			<span className={`ml-2 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles}`}>
				{status}
			</span>
		);
	};

	return (
		<div className="flex flex-col gap-8">
			<SettingsSectionNav sections={SECTIONS} />

			<SettingRow
				id="settings-section-speech-enable"
				title="Enable spoken responses"
				description="When on, Keating can call its voice tool to speak short learner-facing lines through the active provider."
				className="scroll-mt-20"
			>
				<Toggle checked={settings.enabled} onChange={(checked) => persist({ enabled: checked })} />
			</SettingRow>

			<div id="settings-section-speech-provider" className="flex flex-col gap-4 scroll-mt-20">
				<div>
					<h3 className="text-sm font-semibold text-foreground mb-2">Provider</h3>
					<p className="text-sm text-muted-foreground">
						Choose which speech engine generates audio. Cloud providers need an API key in Providers & Models.
					</p>
				</div>
				<div className="flex flex-col gap-2">
					{providers.map((p) => (
						<label
							key={p.id}
							className={`flex items-start gap-3 rounded-md border border-border px-3 py-2.5 cursor-pointer hover:bg-accent/40 transition-colors ${settings.providerId === p.id ? "bg-accent/30 border-primary" : ""}`}
						>
							<input
								type="radio"
								name="speech-provider"
								value={p.id}
								checked={settings.providerId === p.id}
								onChange={() => handleProviderChange(p.id)}
								className="mt-1 shrink-0"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2 text-sm font-medium text-foreground">
									<span>{p.label}</span>
									<span className="inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
										{p.kind === "duplex" ? "duplex" : "tts"}
									</span>
									{statusBadge(p.status)}
								</div>
								<div className="mt-1 text-xs text-muted-foreground">{p.description}</div>
								{p.needsApiKey && (
									<div className="mt-1 text-[11px] text-muted-foreground">
										Needs <span className="font-mono">{p.needsApiKey}</span> API key in Providers & Models.
									</div>
								)}
							</div>
						</label>
					))}

					{settings.customModels.map((m) => (
						<label
							key={`custom:${m.id}`}
							className={`flex items-start gap-3 rounded-md border border-border px-3 py-2.5 cursor-pointer hover:bg-accent/40 transition-colors ${settings.providerId === `custom:${m.id}` ? "bg-accent/30 border-primary" : ""}`}
						>
							<input
								type="radio"
								name="speech-provider"
								value={`custom:${m.id}`}
								checked={settings.providerId === `custom:${m.id}`}
								onChange={() => handleProviderChange(`custom:${m.id}`)}
								className="mt-1 shrink-0"
							/>
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium text-foreground">{m.label}</div>
								<div className="mt-1 text-xs text-muted-foreground truncate">
									{m.baseUrl} · {m.model} · voice {m.voice}
								</div>
							</div>
							<button
								type="button"
								className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
				<div id="settings-section-speech-voice" className="flex flex-col gap-4 scroll-mt-20">
					<div>
						<h3 className="text-sm font-semibold text-foreground mb-2">Model & voice</h3>
						<p className="text-sm text-muted-foreground">
							Fine-tune the active provider's model and voice.
						</p>
					</div>
					{activeProvider && activeProvider.models.length > 1 && (
						<div className="flex flex-col gap-2">
							<label className="text-sm font-medium text-foreground">Model</label>
							<select
								className="rounded-md border border-border bg-background px-3 py-2 text-sm"
								value={settings.model}
								onChange={(e) => persist({ model: e.target.value })}
							>
								{activeProvider.models.map((m) => (
									<option key={m.value} value={m.value}>{m.label}</option>
								))}
							</select>
						</div>
					)}
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Voice</label>
						{activeProvider && activeProvider.voices.length > 0 ? (
							<select
								className="rounded-md border border-border bg-background px-3 py-2 text-sm"
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
								className="rounded-md border border-border bg-background px-3 py-2 text-sm"
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
				className="scroll-mt-20"
			>
				<Toggle checked={settings.microphoneEnabled} onChange={(checked) => persist({ microphoneEnabled: checked })} />
			</SettingRow>

			<div id="settings-section-speech-custom" className="flex flex-col gap-4 scroll-mt-20">
				<div>
					<h3 className="text-sm font-semibold text-foreground mb-2">Add custom TTS endpoint</h3>
					<p className="text-sm text-muted-foreground">
						Any OpenAI-compatible <code>/v1/audio/speech</code> endpoint can be plugged in here.
					</p>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Label</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="e.g. My Self-Hosted TTS"
							value={draftCustom.label}
							onChange={(e) => setDraftCustom((d) => ({ ...d, label: e.target.value }))}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Base URL</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
							placeholder="https://tts.example.com"
							value={draftCustom.baseUrl}
							onChange={(e) => setDraftCustom((d) => ({ ...d, baseUrl: e.target.value }))}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Model id</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
							placeholder="e.g. piper-en-us"
							value={draftCustom.model}
							onChange={(e) => setDraftCustom((d) => ({ ...d, model: e.target.value }))}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Default voice</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="e.g. alloy"
							value={draftCustom.voice}
							onChange={(e) => setDraftCustom((d) => ({ ...d, voice: e.target.value }))}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Auth key from provider</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
							placeholder="openai"
							value={draftCustom.providerKey}
							onChange={(e) => setDraftCustom((d) => ({ ...d, providerKey: e.target.value }))}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">API path (optional)</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
							placeholder="/v1/audio/speech"
							value={draftCustom.apiPath ?? ""}
							onChange={(e) => setDraftCustom((d) => ({ ...d, apiPath: e.target.value }))}
						/>
					</div>
				</div>
				{customError && (
					<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
						{customError}
					</div>
				)}
				<div className="flex justify-end">
					<button
						className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
						onClick={addCustomModel}
					>
						Add custom model
					</button>
				</div>
			</div>
		</div>
	);
}
