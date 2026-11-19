import {
	Button,
	Field,
	EmptyState,
	IconButton,
	Menu,
	Sheet,
	TextInput,
} from "../../design-system/kit";
import { Select } from "../Select";
import { getAppStorage } from "../../keating/app-storage";
import {
	type KeatingCustomProvider,
	type KeatingCustomProviderType,
	type KeatingGatewayKind,
} from "../../lib/provider-models";

export const AUTO_DISCOVERY_TYPES = new Set<KeatingCustomProviderType>([
	"ollama",
	"llama.cpp",
	"vllm",
	"lmstudio",
	"gateway",
	"openai-completions",
	"openai-responses",
	"synthetic",
]);

export const PROVIDER_TYPE_OPTIONS = [
	{ value: "ollama", label: "Ollama" },
	{ value: "llama.cpp", label: "llama.cpp" },
	{ value: "vllm", label: "vLLM" },
	{ value: "lmstudio", label: "LM Studio" },
	{ value: "gateway", label: "AI Gateway" },
	{ value: "openai-completions", label: "OpenAI Completions Compatible" },
	{ value: "openai-responses", label: "OpenAI Responses Compatible" },
	{
		value: "anthropic-messages",
		label: "Anthropic Messages Compatible (including Inkling)",
	},
	{ value: "synthetic", label: "Synthetic (OpenAI Compatible)" },
];

export const GATEWAY_KIND_OPTIONS: Array<{
	value: KeatingGatewayKind;
	label: string;
}> = [
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

export const PROVIDER_TYPE_DEFAULTS: Record<KeatingCustomProviderType, string> =
	{
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

const INKLING_PROVIDER_DEFAULTS = {
	name: "Thinking Machines",
	baseUrl:
		"https://tinker.thinkingmachines.dev/services/tinker-prod/anthropic/api",
} as const;

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
	notice,
	onEdit,
	onDelete,
	onAddType,
}: {
	customProviders: KeatingCustomProvider[];
	notice?: string;
	onEdit: (provider: KeatingCustomProvider) => void;
	onDelete: (provider: KeatingCustomProvider) => void;
	onAddType: (type: KeatingCustomProviderType) => void;
}) {
	return (
		<div id="custom-providers" className="s2-pane">
			<header className="s2-form-head">
				<div>
					<h3>Custom providers</h3>
					<p>
						User-configured servers with auto-discovered or manually defined
						models.
					</p>
				</div>
				<Menu
					label="Provider type"
					trigger={<Button variant="line">Add provider</Button>}
					items={PROVIDER_TYPE_OPTIONS.map((o) => ({
						id: o.value,
						label: o.label,
						onSelect: () => onAddType(o.value as KeatingCustomProviderType),
					}))}
				/>
			</header>
			{notice && <p role="status">{notice}</p>}
			{customProviders.length ? (
				customProviders.map((provider) => (
					<CustomProviderCard
						key={provider.id}
						provider={provider}
						isAutoDiscovery={AUTO_DISCOVERY_TYPES.has(provider.type)}
						onEdit={() => onEdit(provider)}
						onDelete={() => onDelete(provider)}
					/>
				))
			) : (
				<EmptyState heading="No custom providers configured." glyph="server">
					Click “Add provider” to get started.
				</EmptyState>
			)}
		</div>
	);
}

export function ProviderDialog({
	dialog,
	form,
	error,
	saving,
	onChange,
	onClose,
	onSave,
}: {
	dialog: ProviderDialogState;
	form: ProviderFormState;
	error: string;
	saving: boolean;
	onChange: (next: ProviderFormState) => void;
	onClose: () => void;
	onSave: () => void;
}) {
	if (!dialog.open) return null;
	return (
		<Sheet
			open={dialog.open}
			title={dialog.provider ? "Edit provider" : "Add provider"}
			onClose={() => {
				if (!saving) onClose();
			}}
			footer={
				<>
					<Button variant="ghost" onClick={onClose} disabled={saving}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={saving || !form.name.trim() || !form.baseUrl.trim()}
						onClick={onSave}
					>
						{saving ? "Saving…" : "Save provider"}
					</Button>
				</>
			}
		>
			<div className="s2-pane">
				<Field label="Provider name">
					<TextInput
						id="provider-form-name"
						placeholder="e.g., My Ollama Server"
						value={form.name}
						onChange={(e) => onChange({ ...form, name: e.target.value })}
					/>
				</Field>
				{form.type === "anthropic-messages" && (
					<div>
						<p>
							Thinking Machines Inkling uses this protocol. Its model ID is{" "}
							<code>thinkingmachines/Inkling</code>; add it under My models
							after saving the provider.
						</p>
						<Button
							variant="ghost"
							onClick={() =>
								onChange({ ...form, ...INKLING_PROVIDER_DEFAULTS })
							}
						>
							Use Inkling defaults
						</Button>
					</div>
				)}
				<Field label="Provider type">
					<Select
						id="provider-form-type"
						value={form.type}
						onValueChange={(type) =>
							onChange({ ...form, type: type as KeatingCustomProviderType })
						}
					>
						{PROVIDER_TYPE_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</Select>
				</Field>
				{form.type === "gateway" && (
					<Field label="Gateway kind">
						<Select
							id="provider-form-gatewayKind"
							value={form.gatewayKind}
							onValueChange={(value) => {
								const gatewayKind = value as KeatingGatewayKind;
								onChange({
									...form,
									gatewayKind,
									baseUrl: GATEWAY_DEFAULT_URLS[gatewayKind],
								});
							}}
						>
							{GATEWAY_KIND_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</Select>
					</Field>
				)}
				<Field label="Base URL">
					<TextInput
						id="provider-form-baseUrl"
						placeholder="e.g., https://api.ollama.local"
						value={form.baseUrl}
						onChange={(e) => onChange({ ...form, baseUrl: e.target.value })}
					/>
				</Field>
				<Field
					label="API key (optional)"
					hint="Stored for this provider and reused by every model assigned to it."
				>
					<TextInput
						id="provider-form-apiKey"
						type="password"
						placeholder="Leave empty if not required"
						value={form.apiKey}
						disabled={saving}
						onChange={(e) => onChange({ ...form, apiKey: e.target.value })}
					/>
				</Field>
				{error && <p role="alert">{error}</p>}
			</div>
		</Sheet>
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
		<div className="s2-form-head">
			<div>
				<strong>{provider.name}</strong>
				<p>
					{provider.type === "gateway"
						? (provider.gatewayKind ?? "generic") + " gateway"
						: provider.type}{" "}
					· {provider.baseUrl}
				</p>
				<small>
					{isAutoDiscovery ? "Auto-discovery" : "Manual"} ·{" "}
					{provider.models?.length ?? 0}{" "}
					{isAutoDiscovery ? "discovered" : "configured"} models
					{provider.apiKey ? " · Key saved" : ""}
				</small>
			</div>
			<div>
				<IconButton label="Edit provider" glyph="edit" onClick={onEdit} />
				<IconButton label="Delete provider" glyph="trash" onClick={onDelete} />
			</div>
		</div>
	);
}
