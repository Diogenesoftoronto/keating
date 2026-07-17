import { useReducer } from "react";
import { getProviders } from "@earendil-works/pi-ai/compat";
import { removeCustomModel } from "../../keating/ui-settings";
import type { ModelPrefs } from "../../keating/model-prefs";
import type { KeatingCustomProvider } from "../../lib/provider-models";
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

type ModelForm = {
	name: string;
	id: string;
	provider: string;
	api: string;
	baseUrl: string;
	apiKey: string;
	reasoning: boolean;
	vision: boolean;
};

type ModelEditorState = {
	open: boolean;
	form: ModelForm;
	error: string;
	saving: boolean;
};

type ModelEditorAction =
	| { type: "toggle" }
	| { type: "change"; form: ModelForm }
	| { type: "saving" }
	| { type: "failed"; message: string }
	| { type: "saved" };

const INITIAL_MODEL_FORM: ModelForm = {
	name: "",
	id: "",
	provider: "openai",
	api: "openai-completions",
	baseUrl: "",
	apiKey: "",
	reasoning: false,
	vision: false,
};

const INITIAL_MODEL_EDITOR: ModelEditorState = {
	open: false,
	form: INITIAL_MODEL_FORM,
	error: "",
	saving: false,
};

function modelEditorReducer(state: ModelEditorState, action: ModelEditorAction): ModelEditorState {
	switch (action.type) {
		case "toggle":
			return state.open ? INITIAL_MODEL_EDITOR : { ...INITIAL_MODEL_EDITOR, open: true };
		case "change":
			return { ...state, form: action.form, error: "" };
		case "saving":
			return { ...state, saving: true, error: "" };
		case "failed":
			return { ...state, saving: false, error: action.message };
		case "saved":
			return INITIAL_MODEL_EDITOR;
	}
}

function providerApi(provider: KeatingCustomProvider): string {
	if (provider.type === "anthropic-messages") return "anthropic-messages";
	if (provider.type === "openai-responses") return "openai-responses";
	return "openai-completions";
}

export function MyModelsSection({
	modelPrefs,
	customProviders,
	onAddModel,
}: {
	modelPrefs: ModelPrefs;
	customProviders: KeatingCustomProvider[];
	onAddModel: (model: {
		name: string;
		id: string;
		provider: string;
		api: string;
		baseUrl: string;
		apiKey: string;
		reasoning: boolean;
		vision: boolean;
	}) => void | Promise<void>;
}) {
	const [editor, dispatch] = useReducer(modelEditorReducer, INITIAL_MODEL_EDITOR);
	const modelForm = editor.form;
	const providerOptions = Array.from(new Set([
		...getProviders(),
		...customProviders.map((provider) => provider.name),
	]));

	const handleSaveModel = async () => {
		const name = modelForm.name.trim();
		const id = modelForm.id.trim();
		const provider = modelForm.provider.trim();
		if (!name || !id || !provider) {
			dispatch({ type: "failed", message: "Name, ID, and Provider are required" });
			return;
		}
		dispatch({ type: "saving" });
		try {
			await onAddModel({
				name,
				id,
				provider,
				api: modelForm.api,
				baseUrl: modelForm.baseUrl,
				apiKey: modelForm.apiKey,
				reasoning: modelForm.reasoning,
				vision: modelForm.vision,
			});
			dispatch({ type: "saved" });
		} catch (error) {
			dispatch({
				type: "failed",
				message: error instanceof Error ? error.message : "Could not save the model",
			});
		}
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
					onClick={() => dispatch({ type: "toggle" })}
				>
					{editor.open ? "Cancel" : "Add Model"}
				</button>
			</div>

			{editor.open && (
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "1rem" })}>
					{editor.error && (
						<div className={css({ borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", backgroundColor: "color-mix(in srgb, var(--destructive) 5%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem", color: "var(--destructive)" })}>
							{editor.error}
						</div>
					)}
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>Model Name</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g., GPT-5"
							value={modelForm.name}
							onChange={(e) => dispatch({ type: "change", form: { ...modelForm, name: e.target.value } })}
						/>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>Model ID</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g., gpt-5"
							value={modelForm.id}
							onChange={(e) => dispatch({ type: "change", form: { ...modelForm, id: e.target.value } })}
						/>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>Provider</label>
						<select
							className={inputClass}
							value={modelForm.provider}
							onChange={(e) => {
								const providerName = e.target.value;
								const customProvider = customProviders.find((provider) => provider.name === providerName);
								dispatch({
									type: "change",
									form: {
										...modelForm,
										provider: providerName,
										api: customProvider ? providerApi(customProvider) : modelForm.api,
										baseUrl: customProvider?.baseUrl ?? modelForm.baseUrl,
									},
								});
							}}
						>
							{providerOptions.map((p) => (
								<option key={p} value={p}>{p}</option>
							))}
						</select>
						<p className={css({ fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
							Create a custom provider first so the model and its credentials share one provider identity.
						</p>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>API Type</label>
						<select
							className={inputClass}
							value={modelForm.api}
							onChange={(e) => dispatch({ type: "change", form: { ...modelForm, api: e.target.value } })}
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
							onChange={(e) => dispatch({ type: "change", form: { ...modelForm, baseUrl: e.target.value } })}
						/>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<label className={labelClass}>API Key (Optional)</label>
						<input
							type="password"
							className={inputClass}
							placeholder="Stored for the selected provider"
							value={modelForm.apiKey}
							onChange={(e) => dispatch({ type: "change", form: { ...modelForm, apiKey: e.target.value } })}
						/>
						<p className={css({ fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
							This updates the provider key; it is not duplicated per model.
						</p>
					</div>
					<div className={css({ display: "flex", gap: "1rem" })}>
						<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" })}>
							<input
								type="checkbox"
								checked={modelForm.reasoning}
								onChange={(e) => dispatch({ type: "change", form: { ...modelForm, reasoning: e.target.checked } })}
							/>
							Reasoning
						</label>
						<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" })}>
							<input
								type="checkbox"
								checked={modelForm.vision}
								onChange={(e) => dispatch({ type: "change", form: { ...modelForm, vision: e.target.checked } })}
							/>
							Vision
						</label>
					</div>
					<div className={css({ display: "flex", justifyContent: "flex-end" })}>
						<button
							className={primaryButtonClass}
							disabled={editor.saving || !modelForm.name.trim() || !modelForm.id.trim() || !modelForm.provider.trim()}
							onClick={handleSaveModel}
						>
							{editor.saving ? "Saving…" : "Save Model"}
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
