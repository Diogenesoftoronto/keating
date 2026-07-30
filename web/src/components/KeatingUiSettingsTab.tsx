import { useCallback } from "react";
import { Toggle } from "./Toggle";
import { SettingRow } from "./SettingRow";
import { SettingsSectionNav } from "./SettingsSectionNav";
import {
	FONT_FAMILY_OPTIONS,
	SHARE_LINK_MODE_OPTIONS,
	type ReasoningLevel,
	type ShareLinkMode,
	type UiFontFamily,
} from "../keating/ui-settings";
import { useKeatingUiSettings } from "../hooks/use-ui-settings";
import { IMAGE_GENERATORS, getImageGenerator, DEFAULT_IMAGE_GENERATOR_ID, type ImageGeneratorId } from "../lib/image-generators";
import { css, cx } from "../../styled-system/css";

const REASONING_LEVELS: { value: ReasoningLevel; label: string; description: string }[] = [
	{ value: "off", label: "Off", description: "Fastest responses, no reasoning tokens" },
	{ value: "minimal", label: "Minimal", description: "Brief internal checks" },
	{ value: "low", label: "Low", description: "Light reasoning for simple tasks" },
	{ value: "medium", label: "Medium", description: "Balanced depth and speed" },
	{ value: "high", label: "High", description: "Deeper analysis for complex questions" },
	{ value: "xhigh", label: "Maximum", description: "Most thorough reasoning (select models only)" },
];

const stackClass = css({ display: "flex", flexDirection: "column", gap: "1.5rem" });
const sectionAnchorClass = css({ scrollMarginTop: "5rem" });
const sectionTitleClass = css({ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const sectionDescriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const sectionDescriptionSpacedClass = cx(sectionDescriptionClass, css({ marginBottom: "0.75rem" }));
const cardClass = css({
	display: "flex",
	flexDirection: "column",
	gap: "0.75rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	padding: "1rem",
	sm: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" },
});
const responsiveSelectClass = css({
	width: "100%",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--background)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	color: "var(--foreground)",
	sm: { width: "auto", minWidth: "11rem" },
});
const wideResponsiveInputClass = css({
	width: "100%",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--background)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	color: "var(--foreground)",
	sm: { width: "auto", minWidth: "16rem" },
});
const labelCardClass = css({
	display: "flex",
	cursor: "pointer",
	alignItems: "center",
	gap: "0.75rem",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	transitionProperty: "color, background-color, border-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "color-mix(in srgb, var(--accent) 50%, transparent)" },
});
const smallHeadingClass = css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" });
const mutedSmallClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const mutedXsClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });
const compactButtonClass = css({
	display: "inline-flex",
	height: "2.25rem",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.75rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
	_disabled: { opacity: 0.5 },
});
const srOnlyClass = css({
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: 0,
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	borderWidth: 0,
});

function readImageAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
		reader.readAsDataURL(file);
	});
}

export function KeatingUiSettingsTab() {
	const [settings, update] = useKeatingUiSettings();

	const updateProfileImage = useCallback(async (file: File | undefined) => {
		if (!file) return;
		if (!file.type.startsWith("image/")) return;
		const image = await readImageAsDataUrl(file);
		update({ userProfileImage: image });
	}, [update]);

	return (
		<div className={stackClass}>
			<SettingsSectionNav
				sections={[
					{ id: "ui-chat", label: "Chat" },
					{ id: "ui-share", label: "Share Links" },
					{ id: "ui-animation", label: "Animation" },
					{ id: "ui-reasoning", label: "Reasoning" },
					{ id: "ui-images", label: "Images" },
				]}
			/>

			<div id="settings-section-ui-chat" className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Chat Interface</h3>
				<p className={sectionDescriptionClass}>
					Control how much internal agent activity appears in the conversation.
				</p>
			</div>

			<div className={cx(cardClass, css({ gap: "1rem", sm: { alignItems: "center" } }))}>
				<div className={css({ display: "flex", minWidth: 0, alignItems: "center", gap: "0.75rem" })}>
					<div className={css({ display: "flex", height: "3rem", width: "3rem", flexShrink: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--muted)", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						{settings.userProfileImage ? (
							<img
								src={settings.userProfileImage}
								alt="Your profile"
								className={css({ height: "100%", width: "100%", objectFit: "cover" })}
							/>
						) : (
							<span>YOU</span>
						)}
					</div>
					<div className={css({ minWidth: 0 })}>
						<div className={smallHeadingClass}>Your profile image</div>
						<p className={cx(mutedSmallClass, css({ marginTop: "0.25rem" }))}>
							Shown beside your chat messages on this device.
						</p>
					</div>
				</div>
				<div className={css({ display: "flex", flexShrink: 0, flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
					<label className={cx(compactButtonClass, css({ cursor: "pointer", color: "var(--foreground)" }))}>
						Upload
						<input
							type="file"
							accept="image/*"
							className={srOnlyClass}
							onChange={(event) => {
								void updateProfileImage(event.target.files?.[0]);
								event.currentTarget.value = "";
							}}
						/>
					</label>
					<button
						type="button"
						className={cx("dialog-compact-button", compactButtonClass, css({ color: "var(--muted-foreground)" }))}
						disabled={!settings.userProfileImage}
						onClick={() => update({ userProfileImage: null })}
					>
						Remove
					</button>
				</div>
			</div>

			<div className={cardClass}>
				<div className={css({ minWidth: 0 })}>
					<div className={smallHeadingClass}>Font family</div>
					<p className={cx(mutedSmallClass, css({ marginTop: "0.25rem" }))}>
						Choose the default typeface for the app interface.
					</p>
				</div>
				<select
					className={responsiveSelectClass}
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

			<div id="settings-section-ui-share" className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Share Links</h3>
				<p className={sectionDescriptionSpacedClass}>
					Choose how copied session links carry the transcript. Public modes upload or embed the
					session so anyone with the link can read it; the first public share asks for a one-time
					confirmation. Local links stay in this browser's cache only.
				</p>
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
					{SHARE_LINK_MODE_OPTIONS.map((option) => (
						<label
							key={option.value}
							className={labelCardClass}
						>
							<input
								type="radio"
								name="share-link-mode"
								value={option.value}
								checked={settings.shareLinkMode === option.value}
								onChange={() => update({ shareLinkMode: option.value as ShareLinkMode })}
								className={css({ flexShrink: 0 })}
							/>
							<div className={css({ minWidth: 0 })}>
								<div className={smallHeadingClass}>
									{option.label}
									{option.public ? " · shared publicly" : " · stays on this device"}
								</div>
								<div className={mutedXsClass}>{option.description}</div>
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
				title="Show reasoning"
				description="Keep a Reasoning control available inside chat messages. When off, reasoning is hidden entirely. This does not change how much the model thinks; use Reasoning Level for that."
			>
				<Toggle checked={settings.showReasoning} onChange={(checked) => update({ showReasoning: checked })} />
			</SettingRow>

			<SettingRow
				title="Open reasoning automatically"
				description="Start each Reasoning disclosure expanded. Leave this off to keep reasoning available but collapsed."
			>
				<Toggle
					checked={settings.autoExpandReasoning}
					disabled={!settings.showReasoning}
					onChange={(checked) => update({ autoExpandReasoning: checked })}
				/>
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
				title="Keep one inline artifact preview"
				description="When a lesson plan, map, animation, or other artifact appears below chat, replace the previous inline preview instead of stacking several open cards."
			>
				<Toggle checked={settings.limitInlineArtifactPreviews} onChange={(checked) => update({ limitInlineArtifactPreviews: checked })} />
			</SettingRow>

			<SettingRow
				title="Flashcard sounds"
				description="Play subtle audio ticks when flipping and grading flashcards. A mute toggle is also available on the card itself."
			>
				<Toggle checked={settings.flashcardSoundEnabled} onChange={(checked) => update({ flashcardSoundEnabled: checked })} />
			</SettingRow>

			<SettingRow
				title="Response comparison chance"
				description="Occasionally generate a second answer and ask which response helped more. The 1% default keeps comparisons useful without interrupting ordinary chats."
			>
				<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					<input
						type="number"
						min={0}
						max={100}
						step={1}
						className={css({ height: "2.25rem", width: "4rem", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.5rem", fontSize: "0.875rem", color: "var(--foreground)" })}
						value={Math.round(settings.alternativeResponseChance * 100)}
						onChange={(event) => update({ alternativeResponseChance: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })}
						aria-label="Response comparison chance percent"
					/>
					<span className={mutedSmallClass}>%</span>
				</label>
			</SettingRow>

			<div id="settings-section-ui-animation" className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Animation Renderer</h3>
				<p className={sectionDescriptionSpacedClass}>
					Keating creates browser animation artifacts as Hyperframes HTML compositions.
				</p>
				<div className={labelCardClass}>
					<div className={css({ minWidth: 0 })}>
						<div className={smallHeadingClass}>Hyperframes</div>
						<div className={mutedXsClass}>HTML composition with timed clips and a GSAP timeline.</div>
					</div>
				</div>
			</div>

			<div id="settings-section-ui-reasoning" className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Reasoning Level</h3>
				<p className={sectionDescriptionSpacedClass}>
					Set how much the model thinks before responding. Higher levels produce more thorough answers but take longer.
				</p>
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
					{REASONING_LEVELS.map((level) => (
						<label
							key={level.value}
							className={labelCardClass}
						>
							<input
								type="radio"
								name="reasoning-level"
								value={level.value}
								checked={settings.reasoningLevel === level.value}
								onChange={() => update({ reasoningLevel: level.value })}
								className={css({ flexShrink: 0 })}
							/>
							<div className={css({ minWidth: 0 })}>
								<div className={smallHeadingClass}>{level.label}</div>
								<div className={mutedXsClass}>{level.description}</div>
							</div>
						</label>
					))}
				</div>
			</div>

			<div id="settings-section-ui-images" className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Image generation</h3>
				<p className={sectionDescriptionSpacedClass}>
					Choose which generator the <code>generate_image</code> tool uses. When none is configured, the tool returns a message instead of an image.
				</p>
				{(() => {
					const generator = getImageGenerator(settings.imageGenerator) ?? getImageGenerator(DEFAULT_IMAGE_GENERATOR_ID)!;
					return (
						<div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>
							<div className={cardClass}>
								<div className={css({ minWidth: 0 })}>
									<div className={smallHeadingClass}>Generator</div>
									<p className={cx(mutedSmallClass, css({ marginTop: "0.25rem" }))}>{generator.description}</p>
								</div>
								<select
									className={responsiveSelectClass}
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
								<div className={cardClass}>
									<div className={css({ minWidth: 0 })}>
										<div className={smallHeadingClass}>Local endpoint base URL</div>
										<p className={cx(mutedSmallClass, css({ marginTop: "0.25rem" }))}>
											Base URL of your local OpenAI-compatible server, e.g. <code>http://localhost:1234</code>. If it needs a key,
											store it under the provider name <code>{generator.providerKey}</code> in Providers &amp; Models.
										</p>
									</div>
									<input
										type="text"
										className={wideResponsiveInputClass}
										placeholder="http://localhost:1234"
										value={settings.localImageBaseUrl}
										onChange={(e) => update({ localImageBaseUrl: e.target.value })}
									/>
								</div>
							)}

							<div className={cardClass}>
								<div className={css({ minWidth: 0 })}>
									<div className={smallHeadingClass}>Model</div>
									<p className={cx(mutedSmallClass, css({ marginTop: "0.25rem" }))}>
										{generator.models.length > 0
											? "Image model used for this generator."
											: "Model id exposed by your local server."}
									</p>
								</div>
								{generator.models.length > 0 ? (
									<select
										className={responsiveSelectClass}
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
										className={wideResponsiveInputClass}
										placeholder="e.g. sd3.5, flux.1-dev"
										value={settings.imageModel}
										onChange={(e) => update({ imageModel: e.target.value })}
									/>
								)}
							</div>

							<div className={cardClass}>
								<div className={css({ minWidth: 0 })}>
									<div className={smallHeadingClass}>Size &amp; quality</div>
									<p className={cx(mutedSmallClass, css({ marginTop: "0.25rem" }))}>Defaults used when the tool does not override them.</p>
								</div>
								<div className={css({ display: "flex", width: "100%", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", sm: { width: "auto" } })}>
									<select
										className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem", color: "var(--foreground)" })}
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
										className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem", color: "var(--foreground)" })}
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
