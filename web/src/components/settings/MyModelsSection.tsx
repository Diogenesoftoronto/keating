import { useState } from "react";
import { getProviders } from "@earendil-works/pi-ai/compat";
import { removeCustomModel } from "../../keating/ui-settings";
import type { ModelPrefs } from "../../keating/model-prefs";

const ADD_MODEL_APIS = [
	{ value: "openai-completions", label: "OpenAI Completions" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google", label: "Google" },
];

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
		<div id="settings-section-my-models" className="flex flex-col gap-4 scroll-mt-20">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div className="min-w-0">
					<h3 className="text-sm font-semibold text-foreground mb-2">My Models</h3>
					<p className="text-sm text-muted-foreground">
						Manually add models that aren't auto-discovered.
					</p>
				</div>
				<button
					className="dialog-compact-button inline-flex shrink-0 items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
					onClick={() => setShowAddModel((s) => !s)}
				>
					{showAddModel ? "Cancel" : "Add Model"}
				</button>
			</div>

			{showAddModel && (
				<div className="flex flex-col gap-3 rounded-lg border border-border p-4 bg-muted/30">
					{modelError && (
						<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							{modelError}
						</div>
					)}
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Model Name</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="e.g., GPT-5"
							value={modelForm.name}
							onChange={(e) => setModelForm((f) => ({ ...f, name: e.target.value }))}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Model ID</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="e.g., gpt-5"
							value={modelForm.id}
							onChange={(e) => setModelForm((f) => ({ ...f, id: e.target.value }))}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Provider</label>
						<select
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							value={modelForm.provider}
							onChange={(e) => setModelForm((f) => ({ ...f, provider: e.target.value }))}
						>
							{getProviders().map((p) => (
								<option key={p} value={p}>{p}</option>
							))}
							<option value="custom">Custom</option>
						</select>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">API Type</label>
						<select
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							value={modelForm.api}
							onChange={(e) => setModelForm((f) => ({ ...f, api: e.target.value }))}
						>
							{ADD_MODEL_APIS.map((a) => (
								<option key={a.value} value={a.value}>{a.label}</option>
							))}
						</select>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-foreground">Base URL (Optional)</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="e.g., https://api.openai.com/v1"
							value={modelForm.baseUrl}
							onChange={(e) => setModelForm((f) => ({ ...f, baseUrl: e.target.value }))}
						/>
					</div>
					<div className="flex gap-4">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={modelForm.reasoning}
								onChange={(e) => setModelForm((f) => ({ ...f, reasoning: e.target.checked }))}
							/>
							Reasoning
						</label>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={modelForm.vision}
								onChange={(e) => setModelForm((f) => ({ ...f, vision: e.target.checked }))}
							/>
							Vision
						</label>
					</div>
					<div className="flex justify-end">
						<button
							className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
							disabled={!modelForm.name.trim() || !modelForm.id.trim() || !modelForm.provider.trim()}
							onClick={handleSaveModel}
						>
							Save Model
						</button>
					</div>
				</div>
			)}

			{modelPrefs.customModels.length === 0 ? (
				<div className="text-sm text-muted-foreground text-center py-6">No custom models added yet.</div>
			) : (
				<div className="flex flex-col gap-3">
					{modelPrefs.customModels.map((model) => (
						<div key={model.key} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
							<div className="min-w-0">
								<div className="text-sm font-medium text-foreground">{model.name}</div>
								<div className="text-xs text-muted-foreground">{model.provider} / {model.id} / {model.api}</div>
							</div>
							<button
								className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
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