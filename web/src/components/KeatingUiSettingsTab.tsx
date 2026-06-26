import { useCallback, useState } from "react";
import { Toggle } from "./Toggle";
import { SettingRow } from "./SettingRow";
import {
	FONT_FAMILY_OPTIONS,
	SHARE_LINK_MODE_OPTIONS,
	loadKeatingUiSettings,
	saveKeatingUiSettings,
	type ReasoningLevel,
	type ShareLinkMode,
	type UiFontFamily,
} from "../keating/ui-settings";
import { IMAGE_GENERATORS, getImageGenerator, DEFAULT_IMAGE_GENERATOR_ID, type ImageGeneratorId } from "../lib/image-generators";

const REASONING_LEVELS: { value: ReasoningLevel; label: string; description: string }[] = [
	{ value: "off", label: "Off", description: "Fastest responses, no reasoning tokens" },
	{ value: "minimal", label: "Minimal", description: "Brief internal checks" },
	{ value: "low", label: "Low", description: "Light reasoning for simple tasks" },
	{ value: "medium", label: "Medium", description: "Balanced depth and speed" },
	{ value: "high", label: "High", description: "Deeper analysis for complex questions" },
	{ value: "xhigh", label: "Maximum", description: "Most thorough reasoning (select models only)" },
];

function readImageAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
		reader.readAsDataURL(file);
	});
}

export function KeatingUiSettingsTab() {
	const [settings, setSettings] = useState(() => loadKeatingUiSettings());

	const update = useCallback((partial: Partial<typeof settings>) => {
		const next = { ...loadKeatingUiSettings(), ...partial };
		setSettings(next);
		saveKeatingUiSettings(next);
	}, []);

	const updateProfileImage = useCallback(async (file: File | undefined) => {
		if (!file) return;
		if (!file.type.startsWith("image/")) return;
		const image = await readImageAsDataUrl(file);
		update({ userProfileImage: image });
	}, [update]);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Chat Interface</h3>
				<p className="text-sm text-muted-foreground">
					Control how much internal agent activity appears in the conversation.
				</p>
			</div>

			<div className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-xs text-muted-foreground">
						{settings.userProfileImage ? (
							<img
								src={settings.userProfileImage}
								alt="Your profile"
								className="h-full w-full object-cover"
							/>
						) : (
							<span>YOU</span>
						)}
					</div>
					<div className="min-w-0">
						<div className="text-sm font-medium text-foreground">Your profile image</div>
						<p className="mt-1 text-sm text-muted-foreground">
							Shown beside your chat messages on this device.
						</p>
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground">
						Upload
						<input
							type="file"
							accept="image/*"
							className="sr-only"
							onChange={(event) => {
								void updateProfileImage(event.target.files?.[0]);
								event.currentTarget.value = "";
							}}
						/>
					</label>
					<button
						type="button"
						className="dialog-compact-button inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
						disabled={!settings.userProfileImage}
						onClick={() => update({ userProfileImage: null })}
					>
						Remove
					</button>
				</div>
			</div>

			<div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div className="min-w-0">
					<div className="text-sm font-medium text-foreground">Font family</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Choose the default typeface for the app interface.
					</p>
				</div>
				<select
					className="w-full sm:w-auto sm:min-w-44 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
					value={settings.fontFamily}
					onChange={(e) => update({ fontFamily: e.target.value as UiFontFamily })}
				>
					{FONT_FAMILY_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</div>

			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Share Links</h3>
				<p className="text-sm text-muted-foreground mb-3">
					Choose how copied session links carry the transcript.
				</p>
				<div className="flex flex-col gap-2">
					{SHARE_LINK_MODE_OPTIONS.map((option) => (
						<label
							key={option.value}
							className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
						>
							<input
								type="radio"
								name="share-link-mode"
								value={option.value}
								checked={settings.shareLinkMode === option.value}
								onChange={() => update({ shareLinkMode: option.value as ShareLinkMode })}
								className="shrink-0"
							/>
							<div className="min-w-0">
								<div className="text-sm font-medium text-foreground">{option.label}</div>
								<div className="text-xs text-muted-foreground">{option.description}</div>
							</div>
						</label>
					))}
				</div>
			</div>

			<SettingRow
				title="Show tool details"
				description="Show tool arguments and results inside chat messages. Compact status remains visible when this is off."
			>
				<Toggle checked={settings.showToolUi} onChange={(checked) => update({ showToolUi: checked })} />
			</SettingRow>

			<SettingRow
				title="Show raw error details"
				description="Display full error messages and response bodies in tool failures. When off, only a short summary is shown."
			>
				<Toggle checked={settings.showRawErrors} onChange={(checked) => update({ showRawErrors: checked })} />
			</SettingRow>

			<SettingRow
				title="Open artifacts automatically"
				description="Open the artifact side panel when Keating creates a plan, map, animation, benchmark, or evolution."
			>
				<Toggle checked={settings.autoOpenArtifacts} onChange={(checked) => update({ autoOpenArtifacts: checked })} />
			</SettingRow>

			<SettingRow
				title="Alternative response chance"
				description="Occasionally generate a background forked answer to the same prompt for DPO preference data."
			>
				<div className="flex min-w-[12rem] items-center gap-3">
					<input
						type="range"
						min={0}
						max={100}
						step={1}
						className="w-36"
						value={Math.round(settings.alternativeResponseChance * 100)}
						onChange={(event) => update({ alternativeResponseChance: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })}
					/>
					<input
						type="number"
						min={0}
						max={100}
						step={1}
						className="h-9 w-16 rounded-md border border-border bg-background px-2 text-sm text-foreground"
						value={Math.round(settings.alternativeResponseChance * 100)}
						onChange={(event) => update({ alternativeResponseChance: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })}
						aria-label="Alternative response chance percent"
					/>
					<span className="text-sm text-muted-foreground">%</span>
				</div>
			</SettingRow>

			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Animation Renderer</h3>
				<p className="text-sm text-muted-foreground mb-3">
					Choose the source format Keating uses when creating browser animation artifacts.
				</p>
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors">
						<input
							type="radio"
							name="animation-renderer"
							value="manim"
							checked={settings.animationRenderer === "manim"}
							onChange={() => update({ animationRenderer: "manim" })}
							className="shrink-0"
						/>
						<div className="min-w-0">
							<div className="text-sm font-medium text-foreground">Manim-web</div>
							<div className="text-xs text-muted-foreground">Manim-web JavaScript scene source.</div>
						</div>
					</label>
					<label className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors">
						<input
							type="radio"
							name="animation-renderer"
							value="hyperframes"
							checked={settings.animationRenderer === "hyperframes"}
							onChange={() => update({ animationRenderer: "hyperframes" })}
							className="shrink-0"
						/>
						<div className="min-w-0">
							<div className="text-sm font-medium text-foreground">Hyperframes</div>
							<div className="text-xs text-muted-foreground">Default HTML composition with timed clips and a GSAP timeline.</div>
						</div>
					</label>
				</div>
			</div>

			<SettingRow
				title="Google web grounding"
				description="Automatically enable Gemini Google Search grounding when a Google key is available. This lets Google-backed chats use current web results and citations."
			>
				<Toggle
					checked={settings.googleGrounding === "auto"}
					onChange={(checked) => update({ googleGrounding: checked ? "auto" : "off" })}
				/>
			</SettingRow>

			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Reasoning Level</h3>
				<p className="text-sm text-muted-foreground mb-3">
					Set how much the model thinks before responding. Higher levels produce more thorough answers but take longer.
				</p>
				<div className="flex flex-col gap-2">
					{REASONING_LEVELS.map((level) => (
						<label
							key={level.value}
							className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
						>
							<input
								type="radio"
								name="reasoning-level"
								value={level.value}
								checked={settings.reasoningLevel === level.value}
								onChange={() => update({ reasoningLevel: level.value })}
								className="shrink-0"
							/>
							<div className="min-w-0">
								<div className="text-sm font-medium text-foreground">{level.label}</div>
								<div className="text-xs text-muted-foreground">{level.description}</div>
							</div>
						</label>
					))}
				</div>
			</div>

			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Image generation</h3>
				<p className="text-sm text-muted-foreground mb-3">
					Choose which generator the <code>generate_image</code> tool uses. When none is configured, the tool returns a message instead of an image.
				</p>
				{(() => {
					const generator = getImageGenerator(settings.imageGenerator) ?? getImageGenerator(DEFAULT_IMAGE_GENERATOR_ID)!;
					return (
						<div className="flex flex-col gap-4">
							<div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
								<div className="min-w-0">
									<div className="text-sm font-medium text-foreground">Generator</div>
									<p className="mt-1 text-sm text-muted-foreground">{generator.description}</p>
								</div>
								<select
									className="w-full sm:w-auto sm:min-w-44 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
									value={settings.imageGenerator}
									onChange={(e) =>
										update({
											imageGenerator: e.target.value as ImageGeneratorId,
											imageModel: "",
											imageSize: "",
											imageQuality: "",
										})
									}
								>
									{IMAGE_GENERATORS.map((option) => (
										<option key={option.id} value={option.id}>
											{option.label}
										</option>
									))}
								</select>
							</div>

							{generator.needsBaseUrl && (
								<div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
									<div className="min-w-0">
										<div className="text-sm font-medium text-foreground">Local endpoint base URL</div>
										<p className="mt-1 text-sm text-muted-foreground">
											Base URL of your local OpenAI-compatible server, e.g. <code>http://localhost:1234</code>. If it needs a key,
											store it under the provider name <code>{generator.providerKey}</code> in Providers &amp; Models.
										</p>
									</div>
									<input
										type="text"
										className="w-full sm:w-auto sm:min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
										placeholder="http://localhost:1234"
										value={settings.localImageBaseUrl}
										onChange={(e) => update({ localImageBaseUrl: e.target.value })}
									/>
								</div>
							)}

							<div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
								<div className="min-w-0">
									<div className="text-sm font-medium text-foreground">Model</div>
									<p className="mt-1 text-sm text-muted-foreground">
										{generator.models.length > 0
											? "Image model used for this generator."
											: "Model id exposed by your local server."}
									</p>
								</div>
								{generator.models.length > 0 ? (
									<select
										className="w-full sm:w-auto sm:min-w-44 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
										value={settings.imageModel || generator.models[0]}
										onChange={(e) => update({ imageModel: e.target.value })}
									>
										{generator.models.map((model) => (
											<option key={model} value={model}>
												{model}
											</option>
										))}
									</select>
								) : (
									<input
										type="text"
										className="w-full sm:w-auto sm:min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
										placeholder="e.g. sd3.5, flux.1-dev"
										value={settings.imageModel}
										onChange={(e) => update({ imageModel: e.target.value })}
									/>
								)}
							</div>

							<div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
								<div className="min-w-0">
									<div className="text-sm font-medium text-foreground">Size &amp; quality</div>
									<p className="mt-1 text-sm text-muted-foreground">Defaults used when the tool does not override them.</p>
								</div>
								<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
									<select
										className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
										value={settings.imageSize || generator.sizes[0]}
										onChange={(e) => update({ imageSize: e.target.value })}
										aria-label="Image size"
									>
										{generator.sizes.map((size) => (
											<option key={size} value={size}>
												{size}
											</option>
										))}
									</select>
									<select
										className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
										value={settings.imageQuality || generator.qualities[0]}
										onChange={(e) => update({ imageQuality: e.target.value })}
										aria-label="Image quality"
									>
										{generator.qualities.map((quality) => (
											<option key={quality} value={quality}>
												{quality}
											</option>
										))}
									</select>
								</div>
							</div>
						</div>
					);
				})()}
			</div>

		</div>
	);
}
