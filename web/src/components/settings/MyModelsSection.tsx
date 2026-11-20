import {
	Button,
	Field,
	ConfirmDialog,
	EmptyState,
	TextInput,
} from "../../design-system/kit";
import { Select } from "../Select";
import { useReducer, useState } from "react";
import { getCloudProviderIds } from "../../lib/models-dev-catalog";
import { removeCustomModel } from "../../keating/ui-settings";
import type { ModelPrefs } from "../../keating/model-prefs";
import type { KeatingCustomProvider } from "../../lib/provider-models";

const ADD_MODEL_APIS = [
	{ value: "openai-completions", label: "OpenAI Completions" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google", label: "Google" },
];

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

function modelEditorReducer(
	state: ModelEditorState,
	action: ModelEditorAction,
): ModelEditorState {
	switch (action.type) {
		case "toggle":
			return state.open
				? INITIAL_MODEL_EDITOR
				: { ...INITIAL_MODEL_EDITOR, open: true };
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
	const [editor, dispatch] = useReducer(
		modelEditorReducer,
		INITIAL_MODEL_EDITOR,
	);
	const [removing, setRemoving] =
		useState<ModelPrefs["customModels"][number]>();
	const modelForm = editor.form;
	const change = (patch: Partial<ModelForm>) =>
		dispatch({ type: "change", form: { ...modelForm, ...patch } });
	const providerOptions = Array.from(
		new Set([
			...getCloudProviderIds(),
			...customProviders.map((provider) => provider.name),
		]),
	);

	const handleSaveModel = async () => {
		const name = modelForm.name.trim();
		const id = modelForm.id.trim();
		const provider = modelForm.provider.trim();
		if (!name || !id || !provider) {
			dispatch({
				type: "failed",
				message: "Name, ID, and Provider are required",
			});
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
				message:
					error instanceof Error ? error.message : "Could not save the model",
			});
		}
	};

	return (
		<div id="my-models" className="s2-pane">
			<header className="s2-form-head">
				<div>
					<h3>My models</h3>
					<p>Manually add models that aren't auto-discovered.</p>
				</div>
				<Button variant="line" onClick={() => dispatch({ type: "toggle" })}>
					{editor.open ? "Cancel" : "Add model"}
				</Button>
			</header>
			{editor.open && (
				<div className="s2-pane">
					{editor.error && <p role="alert">{editor.error}</p>}
					<Field label="Model name">
						<TextInput
							value={modelForm.name}
							placeholder="e.g., GPT-5"
							onChange={(e) => change({ name: e.target.value })}
						/>
					</Field>
					<Field label="Model ID">
						<TextInput
							value={modelForm.id}
							placeholder="e.g., gpt-5"
							onChange={(e) => change({ id: e.target.value })}
						/>
					</Field>
					<Field
						label="Provider"
						hint="Create a custom provider first so the model and its credentials share one provider identity."
					>
						<Select
							value={modelForm.provider}
							onValueChange={(provider) => {
								const custom = customProviders.find((p) => p.name === provider);
								change({
									provider,
									api: custom ? providerApi(custom) : modelForm.api,
									baseUrl: custom?.baseUrl ?? modelForm.baseUrl,
								});
							}}
						>
							{providerOptions.map((p) => (
								<option key={p}>{p}</option>
							))}
						</Select>
					</Field>
					<Field label="API type">
						<Select
							value={modelForm.api}
							onValueChange={(api) => change({ api })}
						>
							{ADD_MODEL_APIS.map((a) => (
								<option key={a.value} value={a.value}>
									{a.label}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Base URL (optional)">
						<TextInput
							value={modelForm.baseUrl}
							placeholder="e.g., https://api.openai.com/v1"
							onChange={(e) => change({ baseUrl: e.target.value })}
						/>
					</Field>
					<Field
						label="API key (optional)"
						hint="This updates the provider key; it is not duplicated per model."
					>
						<TextInput
							type="password"
							value={modelForm.apiKey}
							placeholder="Stored for the selected provider"
							onChange={(e) => change({ apiKey: e.target.value })}
						/>
					</Field>
					<div className="s2-key-actions">
						<label>
							<input
								type="checkbox"
								checked={modelForm.reasoning}
								onChange={(e) => change({ reasoning: e.target.checked })}
							/>{" "}
							Reasoning
						</label>
						<label>
							<input
								type="checkbox"
								checked={modelForm.vision}
								onChange={(e) => change({ vision: e.target.checked })}
							/>{" "}
							Vision
						</label>
					</div>
					<Button
						disabled={
							editor.saving ||
							!modelForm.name.trim() ||
							!modelForm.id.trim() ||
							!modelForm.provider.trim()
						}
						onClick={handleSaveModel}
					>
						{editor.saving ? "Saving…" : "Save model"}
					</Button>
				</div>
			)}
			<ConfirmDialog
				open={!!removing}
				title={"Remove " + (removing?.name ?? "model") + "?"}
				description="Removes this model from your custom model list. The provider and its shared key stay available."
				confirmLabel="Remove model"
				onCancel={() => setRemoving(undefined)}
				onConfirm={() => {
					if (removing) removeCustomModel(removing.key);
					setRemoving(undefined);
				}}
			/>
			{modelPrefs.customModels.length ? (
				modelPrefs.customModels.map((m) => (
					<div key={m.key} className="s2-form-head">
						<div>
							<strong>{m.name}</strong>
							<p>
								{m.provider} / {m.id} / {m.api}
							</p>
						</div>
						<Button variant="ghost" onClick={() => setRemoving(m)}>
							Delete
						</Button>
					</div>
				))
			) : (
				<EmptyState heading="No custom models added yet." glyph="chip" />
			)}
		</div>
	);
}
