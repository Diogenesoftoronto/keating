import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { getProviders } from "@mariozechner/pi-ai";
import { getAppStorage, type CustomProvider } from "@mariozechner/pi-web-ui";
import {
	loadKeatingUiSettings,
	saveKeatingUiSettings,
	toggleProviderVisibility,
	addCustomModel,
	removeCustomModel,
	type SavedModel,
	addRecentModel,
} from "../keating/ui-settings";
import { getSelectableModels } from "../lib/provider-models";

export type KeatingCustomProviderType =
	| "ollama"
	| "llama.cpp"
	| "vllm"
	| "lmstudio"
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages"
	| "synthetic";

type KeatingCustomProvider = Omit<CustomProvider, "type"> & {
	type: KeatingCustomProviderType;
};

const AUTO_DISCOVERY_TYPES = new Set<KeatingCustomProviderType>([
	"ollama", "llama.cpp", "vllm", "lmstudio",
]);

const PROVIDER_TYPE_OPTIONS = [
	{ value: "ollama", label: "Ollama" },
	{ value: "llama.cpp", label: "llama.cpp" },
	{ value: "vllm", label: "vLLM" },
	{ value: "lmstudio", label: "LM Studio" },
	{ value: "openai-completions", label: "OpenAI Completions Compatible" },
	{ value: "openai-responses", label: "OpenAI Responses Compatible" },
	{ value: "anthropic-messages", label: "Anthropic Messages Compatible" },
	{ value: "synthetic", label: "Synthetic (OpenAI Compatible)" },
];

const ADD_MODEL_APIS = [
	{ value: "openai-completions", label: "OpenAI Completions" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google", label: "Google" },
];

export function ProvidersModelsTabReact() {
	const [customProviders, setCustomProviders] = useState<KeatingCustomProvider[]>([]);
	const [settings, setSettings] = useState(() => loadKeatingUiSettings());
	const [showAddModel, setShowAddModel] = useState(false);
	const [providerDialog, setProviderDialog] = useState<{ open: boolean; provider?: KeatingCustomProvider; type?: KeatingCustomProviderType }>({ open: false });

	const [modelForm, setModelForm] = useState({
		name: "",
		id: "",
		provider: "openai",
		api: "openai-completions",
		baseUrl: "",
		reasoning: false,
		vision: false,
	});

	const [providerForm, setProviderForm] = useState({
		name: "",
		type: "openai-completions" as KeatingCustomProviderType,
		baseUrl: "",
		apiKey: "",
	});

	useEffect(() => {
		loadCustomProviders().then(setCustomProviders);
	}, [providerDialog.open]);

	const refresh = useCallback(() => {
		setSettings(loadKeatingUiSettings());
	}, []);

	const providers = getProviders();

	const handleToggleProvider = (provider: string, hidden: boolean) => {
		toggleProviderVisibility(provider, hidden);
		refresh();
	};

	const handleSaveModel = () => {
		const name = modelForm.name.trim();
		const id = modelForm.id.trim();
		const provider = modelForm.provider.trim();
		if (!name || !id || !provider) {
			alert("Name, ID, and Provider are required");
			return;
		}
		const key = `${provider}::${modelForm.api}::${id}`;
		addCustomModel({
			key,
			id,
			name,
			provider,
			api: modelForm.api,
			baseUrl: modelForm.baseUrl.trim() || undefined,
			reasoning: modelForm.reasoning,
			vision: modelForm.vision,
		});
		setSettings(loadKeatingUiSettings());
		setShowAddModel(false);
		setModelForm({ name: "", id: "", provider: "openai", api: "openai-completions", baseUrl: "", reasoning: false, vision: false });
	};

	const handleAddProvider = async () => {
		if (!providerForm.name.trim() || !providerForm.baseUrl.trim()) {
			alert("Name and Base URL are required");
			return;
		}
		try {
			const storage = getAppStorage();
			const provider: KeatingCustomProvider = {
				id: crypto.randomUUID(),
				name: providerForm.name.trim(),
				type: providerForm.type,
				baseUrl: providerForm.baseUrl.trim(),
				apiKey: providerForm.apiKey.trim() || undefined,
				models: [],
			};
			await storage.customProviders.set(provider as any);
			if (providerForm.apiKey.trim()) {
				await storage.providerKeys.set(provider.name, providerForm.apiKey.trim());
			}
			await loadCustomProviders().then(setCustomProviders);
			setProviderDialog({ open: false });
			setProviderForm({ name: "", type: "openai-completions", baseUrl: "", apiKey: "" });
		} catch (error) {
			console.error("Failed to save provider:", error);
			alert("Failed to save provider");
		}
	};

	const handleDeleteProvider = async (provider: KeatingCustomProvider) => {
		if (!confirm("Are you sure you want to delete this provider?")) return;
		try {
			const storage = getAppStorage();
			await storage.customProviders.delete(provider.id);
			await storage.providerKeys.delete(provider.name);
			await loadCustomProviders().then(setCustomProviders);
		} catch (error) {
			console.error("Failed to delete provider:", error);
		}
	};

	const openAddProvider = (type: KeatingCustomProviderType) => {
		const defaults: Record<KeatingCustomProviderType, string> = {
			ollama: "http://localhost:11434",
			"llama.cpp": "http://localhost:8080",
			vllm: "http://localhost:8000",
			lmstudio: "http://localhost:1234",
			"openai-completions": "",
			"openai-responses": "",
			"anthropic-messages": "",
			synthetic: "https://api.synthetic.new/openai/v1",
		};
		setProviderForm({ name: "", type, baseUrl: defaults[type] || "", apiKey: "" });
		setProviderDialog({ open: true });
	};

	return (
		<div className="flex flex-col gap-8">
			{/* Cloud Provider Keys */}
			<div className="flex flex-col gap-4">
				<div>
					<h3 className="text-sm font-semibold text-foreground mb-2">Cloud Providers</h3>
					<p className="text-sm text-muted-foreground">
						Cloud LLM providers with predefined models. API keys are stored locally in your browser.
					</p>
				</div>
				<div className="flex flex-col gap-3">
					{providers.map((provider) => (
						<ProviderKeyInput key={provider} provider={provider} />
					))}
				</div>
			</div>

			<div className="border-t border-border" />

			{/* Provider Visibility */}
			<div className="flex flex-col gap-4">
				<div>
					<h3 className="text-sm font-semibold text-foreground mb-2">Provider Visibility</h3>
					<p className="text-sm text-muted-foreground">
						Hide providers you don't use to declutter the model selector.
					</p>
				</div>
				<div className="flex flex-col gap-3">
					{providers.map((provider) => {
						const hidden = settings.hiddenProviders.includes(provider);
						return (
							<div key={provider} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
								<div className="text-sm font-medium text-foreground capitalize">{provider}</div>
								<label className="relative inline-flex cursor-pointer items-center gap-2">
									<input
										type="checkbox"
										className="sr-only peer"
										checked={!hidden}
										onChange={(e) => handleToggleProvider(provider, !e.target.checked)}
									/>
									<div className="h-5 w-9 rounded-full bg-muted-foreground/30 peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
									<span className="text-xs text-muted-foreground">{hidden ? "Hidden" : "Visible"}</span>
								</label>
							</div>
						);
					})}
				</div>
			</div>

			<div className="border-t border-border" />

			{/* Custom Models */}
			<div className="flex flex-col gap-4">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="text-sm font-semibold text-foreground mb-2">My Models</h3>
						<p className="text-sm text-muted-foreground">
							Manually add models that aren't auto-discovered.
						</p>
					</div>
					<button
						className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
						onClick={() => setShowAddModel((s) => !s)}
					>
						{showAddModel ? "Cancel" : "Add Model"}
					</button>
				</div>

				{showAddModel && (
					<div className="flex flex-col gap-3 rounded-lg border border-border p-4 bg-muted/30">
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
							<input
								type="text"
								className="rounded-md border border-border bg-background px-3 py-2 text-sm"
								placeholder="e.g., openai"
								value={modelForm.provider}
								onChange={(e) => setModelForm((f) => ({ ...f, provider: e.target.value }))}
							/>
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
								className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
								onClick={handleSaveModel}
							>
								Save Model
							</button>
						</div>
					</div>
				)}

				{settings.customModels.length === 0 ? (
					<div className="text-sm text-muted-foreground text-center py-6">No custom models added yet.</div>
				) : (
					<div className="flex flex-col gap-3">
						{settings.customModels.map((model) => (
							<div key={model.key} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
								<div className="min-w-0">
									<div className="text-sm font-medium text-foreground">{model.name}</div>
									<div className="text-xs text-muted-foreground">{model.provider} / {model.id} / {model.api}</div>
								</div>
								<button
									className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
									onClick={() => {
										removeCustomModel(model.key);
										setSettings(loadKeatingUiSettings());
									}}
								>
									Delete
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			<div className="border-t border-border" />

			{/* Custom Providers */}
			<div className="flex flex-col gap-4">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="text-sm font-semibold text-foreground mb-2">Custom Providers</h3>
						<p className="text-sm text-muted-foreground">
							User-configured servers with auto-discovered or manually defined models.
						</p>
					</div>
					<select
						className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
						onChange={(e) => {
							const value = e.target.value as KeatingCustomProviderType;
							openAddProvider(value);
							e.target.value = "";
						}}
						defaultValue=""
					>
						<option value="" disabled>Add Provider</option>
						{PROVIDER_TYPE_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>{o.label}</option>
						))}
					</select>
				</div>

				{customProviders.length === 0 ? (
					<div className="text-sm text-muted-foreground text-center py-8">
						No custom providers configured. Click &quot;Add Provider&quot; to get started.
					</div>
				) : (
					<div className="flex flex-col gap-4">
						{customProviders.map((provider) => (
							<CustomProviderCard
								key={provider.id}
								provider={provider}
								isAutoDiscovery={AUTO_DISCOVERY_TYPES.has(provider.type as KeatingCustomProviderType)}
								onEdit={() => setProviderDialog({ open: true, provider })}
								onDelete={() => handleDeleteProvider(provider)}
							/>
						))}
					</div>
				)}
			</div>

			{/* Provider Dialog */}
			{providerDialog.open && (
				<div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setProviderDialog({ open: false })}>
					<div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-sm font-semibold text-foreground">
								{providerDialog.provider ? "Edit Provider" : "Add Provider"}
							</h3>
							<button onClick={() => setProviderDialog({ open: false })} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
								<X size={14} />
							</button>
						</div>
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-1">
								<label className="text-sm font-medium text-foreground">Provider Name</label>
								<input
									type="text"
									className="rounded-md border border-border bg-background px-3 py-2 text-sm"
									placeholder="e.g., My Ollama Server"
									value={providerForm.name}
									onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-sm font-medium text-foreground">Provider Type</label>
								<select
									className="rounded-md border border-border bg-background px-3 py-2 text-sm"
									value={providerForm.type}
									onChange={(e) => {
										const t = e.target.value as KeatingCustomProviderType;
										setProviderForm((f) => ({ ...f, type: t }));
									}}
								>
									{PROVIDER_TYPE_OPTIONS.map((o) => (
										<option key={o.value} value={o.value}>{o.label}</option>
									))}
								</select>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-sm font-medium text-foreground">Base URL</label>
								<input
									type="text"
									className="rounded-md border border-border bg-background px-3 py-2 text-sm"
									placeholder="e.g., https://api.ollama.local"
									value={providerForm.baseUrl}
									onChange={(e) => setProviderForm((f) => ({ ...f, baseUrl: e.target.value }))}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-sm font-medium text-foreground">API Key (Optional)</label>
								<input
									type="password"
									className="rounded-md border border-border bg-background px-3 py-2 text-sm"
									placeholder="Leave empty if not required"
									value={providerForm.apiKey}
									onChange={(e) => setProviderForm((f) => ({ ...f, apiKey: e.target.value }))}
								/>
							</div>
							<div className="flex justify-end gap-2 mt-2">
								<button
									className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
									onClick={() => setProviderDialog({ open: false })}
								>
									Cancel
								</button>
								<button
									className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
									disabled={!providerForm.name.trim() || !providerForm.baseUrl.trim()}
									onClick={handleAddProvider}
								>
									Save
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

async function loadCustomProviders(): Promise<KeatingCustomProvider[]> {
	try {
		const storage = getAppStorage();
		return (await storage.customProviders.getAll()) as KeatingCustomProvider[];
	} catch (error) {
		console.error("Failed to load custom providers:", error);
		return [];
	}
}

function ProviderKeyInput({ provider }: { provider: string }) {
	const [key, setKey] = useState("");

	useEffect(() => {
		getAppStorage().providerKeys.get(provider).then((k) => {
			if (k) setKey(k);
		});
	}, [provider]);

	const save = async () => {
		const storage = getAppStorage();
		if (key.trim()) {
			await storage.providerKeys.set(provider, key.trim());
		} else {
			await storage.providerKeys.delete(provider);
		}
	};

	return (
		<div className="flex flex-col gap-1">
			<label className="text-xs font-medium text-muted-foreground capitalize">{provider} API Key</label>
			<input
				type="password"
				className="rounded-md border border-border bg-background px-3 py-2 text-sm"
				placeholder={`${provider} API key`}
				value={key}
				onChange={(e) => setKey(e.target.value)}
				onBlur={save}
			/>
		</div>
	);
}

function CustomProviderCard({
	provider,
	isAutoDiscovery,
	onEdit,
	onDelete,
}: {
	provider: KeatingCustomProvider;
	isAutoDiscovery: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="rounded-lg border border-border p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-sm font-medium text-foreground">{provider.name}</div>
					<div className="text-xs text-muted-foreground mt-0.5">{provider.type} — {provider.baseUrl}</div>
					<div className="flex gap-2 mt-1">
						<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
							{isAutoDiscovery ? "Auto-discovery" : "Manual"}
						</span>
						<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
							{provider.models?.length ?? 0} models
						</span>
					</div>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					<button
						className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						onClick={onEdit}
						aria-label="Edit provider"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
					</button>
					<button
						className="inline-flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
						onClick={onDelete}
						aria-label="Delete provider"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>
		</div>
	);
}
