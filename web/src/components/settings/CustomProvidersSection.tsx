import { useEffect, useRef, useState } from "react";
import { ChevronDown, Trash2, X } from "lucide-react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import {
	discoverCustomProviderModels,
	type KeatingCustomProvider,
	type KeatingCustomProviderType,
	type KeatingGatewayKind,
} from "../../lib/provider-models";
import { css, cx } from "../../../styled-system/css";

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
const iconButtonClass = css({
	display: "inline-flex",
	height: "1.75rem",
	width: "1.75rem",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	color: "var(--muted-foreground)",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
});
const compactButtonClass = css({
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
		<div id="settings-section-custom-providers" className={sectionClass}>
			<div className={headerRowClass}>
				<div className={css({ minWidth: 0 })}>
					<h3 className={titleClass}>Custom Providers</h3>
					<p className={descriptionClass}>
						User-configured servers with auto-discovered or manually defined models.
					</p>
				</div>
				<div ref={addProviderMenuRef} className={css({ position: "relative", flexShrink: 0, smDown: { width: "100%" } })}>
					<button
						type="button"
						aria-haspopup="menu"
						aria-expanded={addProviderMenuOpen}
						onClick={() => setAddProviderMenuOpen((open) => !open)}
						className={cx("dialog-compact-button", compactButtonClass, css({ justifyContent: "space-between", gap: "0.5rem", backgroundColor: "var(--background)", smDown: { width: "100%" } }))}
					>
						<span>Add Provider</span>
						<ChevronDown
							size={12}
							className={css({ transitionProperty: "transform", transitionDuration: "150ms", transform: addProviderMenuOpen ? "rotate(180deg)" : undefined })}
						/>
					</button>
					{addProviderMenuOpen ? (
						<div
							role="menu"
							className={css({ position: "absolute", right: 0, top: "2.25rem", zIndex: 30, width: "16rem", overflow: "hidden", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingBlock: "0.25rem", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)" })}
						>
							{PROVIDER_TYPE_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									role="menuitem"
									className={css({ display: "flex", width: "100%", alignItems: "center", paddingInline: "0.75rem", paddingBlock: "0.5rem", textAlign: "left", fontSize: "0.75rem", transitionProperty: "color, background-color", transitionDuration: "150ms", _hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" } })}
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
				<div className={css({ paddingBlock: "2rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>
					No custom providers configured. Click &quot;Add Provider&quot; to get started.
				</div>
			) : (
				<div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>
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
			className={css({ position: "fixed", inset: 0, zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgb(0 0 0 / 0.5)", paddingInline: "1rem", backdropFilter: "blur(4px)" })}
			role="dialog"
			aria-modal="true"
			aria-label={dialog.provider ? "Edit Provider" : "Add Provider"}
			onClick={onClose}
		>
			<div className={css({ width: "100%", maxWidth: "28rem", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", padding: "1.25rem", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)" })} onClick={(e) => e.stopPropagation()}>
				<div className={css({ marginBottom: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between" })}>
					<h3 className={titleClass}>
						{dialog.provider ? "Edit Provider" : "Add Provider"}
					</h3>
					<button onClick={onClose} className={iconButtonClass}>
						<X size={14} />
					</button>
				</div>
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem" })}>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
						<label className={labelClass}>Provider Name</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g., My Ollama Server"
							value={form.name}
							onChange={(e) => onChange({ ...form, name: e.target.value })}
						/>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
						<label className={labelClass}>Provider Type</label>
						<select
							className={inputClass}
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
						<div className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
							<label className={labelClass}>Gateway Kind</label>
							<select
								className={inputClass}
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
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
						<label className={labelClass}>Base URL</label>
						<input
							type="text"
							className={inputClass}
							placeholder="e.g., https://api.ollama.local"
							value={form.baseUrl}
							onChange={(e) => onChange({ ...form, baseUrl: e.target.value })}
						/>
					</div>
					<div className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
						<label className={labelClass}>API Key (Optional)</label>
						<input
							type="password"
							className={inputClass}
							placeholder="Leave empty if not required"
							value={form.apiKey}
							onChange={(e) => onChange({ ...form, apiKey: e.target.value })}
						/>
					</div>
					{error && (
						<div className={css({ borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", backgroundColor: "color-mix(in srgb, var(--destructive) 5%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem", color: "var(--destructive)" })}>
							{error}
						</div>
					)}
					<div className={css({ marginTop: "0.5rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" })}>
						<button
							className={cx(compactButtonClass, css({ color: "var(--muted-foreground)" }))}
							onClick={onClose}
						>
							Cancel
						</button>
						<button
							className={css({ borderRadius: "0.375rem", backgroundColor: "var(--primary)", paddingInline: "0.75rem", paddingBlock: "0.375rem", fontSize: "0.75rem", fontWeight: 500, color: "var(--primary-foreground)", transitionProperty: "background-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)" }, _disabled: { opacity: 0.5 } })}
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
		<div className={css({ borderRadius: "0.5rem", border: "1px solid var(--border)", padding: "1rem" })}>
			<div className={css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" })}>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>{provider.name}</div>
					<div className={css({ marginTop: "0.125rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						{provider.type === "gateway" ? `${provider.gatewayKind ?? "generic"} gateway` : provider.type} · {provider.baseUrl}
					</div>
					<div className={css({ marginTop: "0.25rem", display: "flex", gap: "0.5rem" })}>
						<span className={css({ display: "inline-flex", alignItems: "center", borderRadius: "9999px", backgroundColor: "var(--muted)", paddingInline: "0.5rem", paddingBlock: "0.125rem", fontSize: "10px", fontWeight: 500, color: "var(--muted-foreground)" })}>
							{isAutoDiscovery ? "Auto-discovery" : "Manual"}
						</span>
						<span className={css({ display: "inline-flex", alignItems: "center", borderRadius: "9999px", backgroundColor: "var(--muted)", paddingInline: "0.5rem", paddingBlock: "0.125rem", fontSize: "10px", fontWeight: 500, color: "var(--muted-foreground)" })}>
							{isAutoDiscovery
								? `${provider.models?.length ?? 0} discovered models`
								: `${provider.models?.length ?? 0} configured models`}
						</span>
					</div>
				</div>
				<div className={css({ display: "flex", flexShrink: 0, alignItems: "center", gap: "0.25rem" })}>
					<button
						className={iconButtonClass}
						onClick={onEdit}
						aria-label="Edit provider"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
					</button>
					<button
						className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", color: "var(--destructive)", _hover: { backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)" } })}
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
