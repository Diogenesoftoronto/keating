import { useEffect, useRef, useState } from "react";
import { ChevronDown, Trash2, X } from "lucide-react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import {
	discoverCustomProviderModels,
	type KeatingCustomProvider,
	type KeatingCustomProviderType,
	type KeatingGatewayKind,
} from "../../lib/provider-models";

export const AUTO_DISCOVERY_TYPES = new Set<KeatingCustomProviderType>([
	"ollama", "llama.cpp", "vllm", "lmstudio", "gateway",
	"openai-completions", "openai-responses", "synthetic",
]);

export const PROVIDER_TYPE_OPTIONS = [
	{ value: "ollama", label: "Ollama" },
	{ value: "llama.cpp", label: "llama.cpp" },
	{ value: "vllm", label: "vLLM" },
	{ value: "lmstudio", label: "LM Studio" },
	{ value: "gateway", label: "AI Gateway" },
	{ value: "openai-completions", label: "OpenAI Completions Compatible" },
	{ value: "openai-responses", label: "OpenAI Responses Compatible" },
	{ value: "anthropic-messages", label: "Anthropic Messages Compatible" },
	{ value: "synthetic", label: "Synthetic (OpenAI Compatible)" },
];

export const GATEWAY_KIND_OPTIONS: Array<{ value: KeatingGatewayKind; label: string }> = [
	{ value: "bifrost", label: "Bifrost" },
	{ value: "plexus", label: "Plexus" },
	{ value: "litellm", label: "LiteLLM" },
	{ value: "generic", label: "Other OpenAI-compatible gateway" },
];

export const GATEWAY_DEFAULT_URLS: Record<KeatingGatewayKind, string> = {
	bifrost: "http://localhost:8080",
	plexus: "",
	litellm: "http://localhost:4000",
	generic: "",
};

export const PROVIDER_TYPE_DEFAULTS: Record<KeatingCustomProviderType, string> = {
	ollama: "http://localhost:11434",
	"llama.cpp": "http://localhost:8080",
	vllm: "http://localhost:8000",
	lmstudio: "http://localhost:1234",
	gateway: GATEWAY_DEFAULT_URLS.bifrost,
	"openai-completions": "",
	"openai-responses": "",
	"anthropic-messages": "",
	synthetic: "https://api.synthetic.new/openai/v1",
};

export type ProviderDialogState = {
	open: boolean;
	provider?: KeatingCustomProvider;
	type?: KeatingCustomProviderType;
};

export type ProviderFormState = {
	name: string;
	type: KeatingCustomProviderType;
	gatewayKind: KeatingGatewayKind;
	baseUrl: string;
	apiKey: string;
};

export const INITIAL_PROVIDER_FORM: ProviderFormState = {
	name: "",
	type: "openai-completions",
	gatewayKind: "bifrost",
	baseUrl: "",
	apiKey: "",
};

export async function loadCustomProviders(): Promise<KeatingCustomProvider[]> {
	try {
		const storage = getAppStorage();
		return (await storage.customProviders.getAll()) as KeatingCustomProvider[];
	} catch (error) {
		console.error("Failed to load custom providers:", error);
		return [];
	}
}

export function CustomProvidersSection({
	customProviders,
	onEdit,
	onDelete,
	onAddType,
}: {
	customProviders: KeatingCustomProvider[];
	onEdit: (provider: KeatingCustomProvider) => void;
	onDelete: (provider: KeatingCustomProvider) => void;
	onAddType: (type: KeatingCustomProviderType) => void;
}) {
	const [addProviderMenuOpen, setAddProviderMenuOpen] = useState(false);
	const addProviderMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!addProviderMenuOpen) return;
		const onDown = (event: MouseEvent) => {
			if (!addProviderMenuRef.current?.contains(event.target as Node)) {
				setAddProviderMenuOpen(false);
			}
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [addProviderMenuOpen]);

	return (
		<div id="settings-section-custom-providers" className="flex flex-col gap-4 scroll-mt-20">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div className="min-w-0">
					<h3 className="text-sm font-semibold text-foreground mb-2">Custom Providers</h3>
					<p className="text-sm text-muted-foreground">
						User-configured servers with auto-discovered or manually defined models.
					</p>
				</div>
				<div ref={addProviderMenuRef} className="relative shrink-0 max-sm:w-full">
					<button
						type="button"
						aria-haspopup="menu"
						aria-expanded={addProviderMenuOpen}
						onClick={() => setAddProviderMenuOpen((open) => !open)}
						className="dialog-compact-button inline-flex max-sm:w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
					>
						<span>Add Provider</span>
						<ChevronDown
							size={12}
							className={`transition-transform ${addProviderMenuOpen ? "rotate-180" : ""}`}
						/>
					</button>
					{addProviderMenuOpen ? (
						<div
							role="menu"
							className="absolute right-0 top-9 z-30 w-64 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
						>
							{PROVIDER_TYPE_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									role="menuitem"
									className="flex w-full items-center px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
									onClick={() => {
										setAddProviderMenuOpen(false);
										onAddType(option.value as KeatingCustomProviderType);
									}}
								>
									{option.label}
								</button>
							))}
						</div>
					) : null}
				</div>
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
							onEdit={() => onEdit(provider)}
							onDelete={() => onDelete(provider)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function ProviderDialog({
	dialog,
	form,
	error,
	onChange,
	onClose,
	onSave,
}: {
	dialog: ProviderDialogState;
	form: ProviderFormState;
	error: string;
	onChange: (next: ProviderFormState) => void;
	onClose: () => void;
	onSave: () => void;
}) {
	if (!dialog.open) return null;
	return (
		<div
			className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
			role="dialog"
			aria-modal="true"
			aria-label={dialog.provider ? "Edit Provider" : "Add Provider"}
			onClick={onClose}
		>
			<div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-sm font-semibold text-foreground">
						{dialog.provider ? "Edit Provider" : "Add Provider"}
					</h3>
					<button onClick={onClose} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
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
							value={form.name}
							onChange={(e) => onChange({ ...form, name: e.target.value })}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<label className="text-sm font-medium text-foreground">Provider Type</label>
						<select
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							value={form.type}
							onChange={(e) => {
								const t = e.target.value as KeatingCustomProviderType;
								onChange({ ...form, type: t });
							}}
						>
							{PROVIDER_TYPE_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>{o.label}</option>
							))}
						</select>
					</div>
					{form.type === "gateway" && (
						<div className="flex flex-col gap-1">
							<label className="text-sm font-medium text-foreground">Gateway Kind</label>
							<select
								className="rounded-md border border-border bg-background px-3 py-2 text-sm"
								value={form.gatewayKind}
								onChange={(e) => {
									const gatewayKind = e.target.value as KeatingGatewayKind;
									onChange({
										...form,
										gatewayKind,
										baseUrl: GATEWAY_DEFAULT_URLS[gatewayKind],
									});
								}}
							>
								{GATEWAY_KIND_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>{option.label}</option>
								))}
							</select>
						</div>
					)}
					<div className="flex flex-col gap-1">
						<label className="text-sm font-medium text-foreground">Base URL</label>
						<input
							type="text"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="e.g., https://api.ollama.local"
							value={form.baseUrl}
							onChange={(e) => onChange({ ...form, baseUrl: e.target.value })}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<label className="text-sm font-medium text-foreground">API Key (Optional)</label>
						<input
							type="password"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="Leave empty if not required"
							value={form.apiKey}
							onChange={(e) => onChange({ ...form, apiKey: e.target.value })}
						/>
					</div>
					{error && (
						<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}
					<div className="flex justify-end gap-2 mt-2">
						<button
							className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
							onClick={onClose}
						>
							Cancel
						</button>
						<button
							className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
							disabled={!form.name.trim() || !form.baseUrl.trim()}
							onClick={onSave}
						>
							Save
						</button>
					</div>
				</div>
			</div>
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
					<div className="text-xs text-muted-foreground mt-0.5">
						{provider.type === "gateway" ? `${provider.gatewayKind ?? "generic"} gateway` : provider.type} · {provider.baseUrl}
					</div>
					<div className="flex gap-2 mt-1">
						<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
							{isAutoDiscovery ? "Auto-discovery" : "Manual"}
						</span>
						<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
							{isAutoDiscovery
								? `${provider.models?.length ?? 0} discovered models`
								: `${provider.models?.length ?? 0} configured models`}
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