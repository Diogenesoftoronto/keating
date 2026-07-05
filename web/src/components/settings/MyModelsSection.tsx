import { useState } from "react";
import { getProviders } from "@earendil-works/pi-ai/compat";
import { removeCustomModel } from "../../keating/ui-settings";
import type { ModelPrefs } from "../../keating/model-prefs";
import { css, cx } from "../../../styled-system/css";

const ADD_MODEL_APIS = [
	{ value: "openai-completions", label: "OpenAI Completions" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google", label: "Google" },
];

const sectionClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const headerRowClass = css({
	display: "flex",
	flexDirection: "column",
	gap: "0.75rem",
	sm: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "1rem" },
});
const titleClass = css({ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const descriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const inputClass = css({
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--background)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	color: "var(--foreground)",
});
const labelClass = css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" });
const secondaryButtonClass = css({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.75rem",
	paddingBlock: "0.375rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	transitionProperty: "color, background-color, border-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
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
	transitionProperty: "color, background-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)" },
	_disabled: { opacity: 0.5 },
});

export function MyModelsSection({
	modelPrefs,
	onAddModel,
}: {
	modelPrefs: ModelPrefs;
	onAddModel: (model: {
		name: string;
		id: string;
		provider: string;
		api: string;
		baseUrl: string;
		reasoning: boolean;
		vision: boolean;
	}) => void;
}) {
	const [showAddModel, setShowAddModel] = useState(false);
	const [modelError, setModelError] = useState("");
	const [modelForm, setModelForm] = useState({
		name: "",
		id: "",
		provider: "openai",
		api: "openai-completions",
		baseUrl: "",
		reasoning: false,
		vision: false,
	});

	const handleSaveModel = () => {
		setModelError("");
		const name = modelForm.name.trim();
		const id = modelForm.id.trim();
		const provider = modelForm.provider.trim();
		if (!name || !id || !provider) {
			setModelError("Name, ID, and Provider are required");
			return;
		}
		onAddModel({
			name,
			id,
			provider,
			api: modelForm.api,
			baseUrl: modelForm.baseUrl,
			reasoning: modelForm.reasoning,
			vision: modelForm.vision,
		});
		setShowAddModel(false);
		setModelForm({ name: "", id: "", provider: "openai", api: "openai-completions", baseUrl: "", reasoning: false, vision: false });
	};

	return (
		<div id="settings-section-my-models" className={sectionClass}>
			<div className={headerRowClass}>
				<div className={css({ minWidth: 0 })}>
					<h3 className={titleClass}>My Models</h3>
					<p className={descriptionClass}>
						Manually add models that aren't auto-discovered.
					</p>
				</div>
				<button
					className={cx("dialog-compact-button", secondaryButtonClass, css({ flexShrink: 0 }))}
					onClick={() => setShowAddModel((s) => !s)}
				>
					{showAddModel ? "Cancel" : "Add Model"}
				</button>
			</div>

			{showAddModel && (
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "1rem" })}>
					{modelError && (
						<div className={css({ borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", backgroundColor: "color-mix(in srgb, var(--destructive) 5%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem", color: "var(--destructive)" })}>
							{modelError}
						</div>
					)}
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>Model Name</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g., GPT-5"
							value={modelForm.name}
							onChange={(e) => setModelForm((f) => ({ ...f, name: e.target.value }))}
						/>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>Model ID</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g., gpt-5"
							value={modelForm.id}
							onChange={(e) => setModelForm((f) => ({ ...f, id: e.target.value }))}
						/>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>Provider</label>
						<select
							className={inputClass}
							value={modelForm.provider}
							onChange={(e) => setModelForm((f) => ({ ...f, provider: e.target.value }))}
						>
							{getProviders().map((p) => (
								<option key={p} value={p}>{p}</option>
							))}
							<option value="custom">Custom</option>
						</select>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>API Type</label>
						<select
							className={inputClass}
							value={modelForm.api}
							onChange={(e) => setModelForm((f) => ({ ...f, api: e.target.value }))}
						>
							{ADD_MODEL_APIS.map((a) => (
								<option key={a.value} value={a.value}>{a.label}</option>
							))}
						</select>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>Base URL (Optional)</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g., https://api.openai.com/v1"
							value={modelForm.baseUrl}
							onChange={(e) => setModelForm((f) => ({ ...f, baseUrl: e.target.value }))}
						/>
					</div>
					<div className={css({ display: "flex", gap: "1rem" })}>
						<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" })}>
							<input
								type="checkbox"
								checked={modelForm.reasoning}
								onChange={(e) => setModelForm((f) => ({ ...f, reasoning: e.target.checked }))}
							/>
							Reasoning
						</label>
						<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" })}>
							<input
								type="checkbox"
								checked={modelForm.vision}
								onChange={(e) => setModelForm((f) => ({ ...f, vision: e.target.checked }))}
							/>
							Vision
						</label>
					</div>
					<div className={css({ display: "flex", justifyContent: "flex-end" })}>
						<button
							className={primaryButtonClass}
							disabled={!modelForm.name.trim() || !modelForm.id.trim() || !modelForm.provider.trim()}
							onClick={handleSaveModel}
						>
							Save Model
						</button>
					</div>
				</div>
			)}

			{modelPrefs.customModels.length === 0 ? (
				<div className={css({ paddingBlock: "1.5rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>No custom models added yet.</div>
			) : (
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem" })}>
					{modelPrefs.customModels.map((model) => (
						<div key={model.key} className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", borderRadius: "0.5rem", border: "1px solid var(--border)", padding: "0.75rem" })}>
							<div className={css({ minWidth: 0 })}>
								<div className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>{model.name}</div>
								<div className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{model.provider} / {model.id} / {model.api}</div>
							</div>
							<button
								className={css({ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", paddingInline: "0.5rem", paddingBlock: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)", transitionProperty: "color, background-color", transitionDuration: "150ms", _hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" } })}
								onClick={() => {
									removeCustomModel(model.key);
								}}
							>
								Delete
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
