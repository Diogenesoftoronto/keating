import { useEffect, useState } from "react";
import { getProviders } from "@earendil-works/pi-ai/compat";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import {
	addCustomModel,
	toggleProviderVisibility,
} from "../keating/ui-settings";
import { useKeatingUiSettings } from "../hooks/use-ui-settings";
import { useModelPrefs } from "../hooks/use-model-prefs";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import {
	MODELS_TAB_SECTION_IDS,
	MODELS_TAB_SECTION_LABELS,
} from "./settings/section-ids";
import { DIO_PROVIDER_ID } from "../dio-provider";
import { CloudProviderKeysSection } from "./settings/CloudProviderKeysSection";
import { WebSearchSection } from "./settings/WebSearchSection";
import { ProviderVisibilitySection } from "./settings/ProviderVisibilitySection";
import { MyModelsSection } from "./settings/MyModelsSection";
import {
	discoverCustomProviderModels,
	type KeatingCustomProvider,
} from "../lib/provider-models";
import {
	CustomProvidersSection,
	ProviderDialog,
	AUTO_DISCOVERY_TYPES,
	PROVIDER_TYPE_DEFAULTS,
	INITIAL_PROVIDER_FORM,
	loadCustomProviders,
	type ProviderDialogState,
	type ProviderFormState,
} from "./settings/CustomProvidersSection";

const PROVIDER_PRIORITY = ["dio", "openai", "anthropic", "google"];

function sortProvidersByPriority(list: string[]): string[] {
	const rank = (name: string) => {
		const idx = PROVIDER_PRIORITY.indexOf(name);
		return idx === -1 ? PROVIDER_PRIORITY.length : idx;
	};
	return [...list].sort((a, b) => {
		const ra = rank(a);
		const rb = rank(b);
		if (ra !== rb) return ra - rb;
		return a.localeCompare(b);
	});
}

export function ProvidersModelsTab({ extraNavSections }: { extraNavSections?: SettingsSection[] } = {}) {
	const [customProviders, setCustomProviders] = useState<KeatingCustomProvider[]>([]);
	const [settings, patch] = useKeatingUiSettings();
	const [modelPrefs] = useModelPrefs();
	const [providerDialog, setProviderDialog] = useState<ProviderDialogState>({ open: false });
	const [providerError, setProviderError] = useState("");
	const [providerForm, setProviderForm] = useState<ProviderFormState>(INITIAL_PROVIDER_FORM);

	useEffect(() => {
		loadCustomProviders().then(setCustomProviders);
	}, [providerDialog.open]);

	useEffect(() => {
		setProviderError("");
		if (!providerDialog.open) {
			setProviderForm(INITIAL_PROVIDER_FORM);
			return;
		}
		if (providerDialog.provider) {
			// Also fetch apiKey from providerKeys storage in case it was stored separately
			const storage = getAppStorage();
			const apiKey = providerDialog.provider.apiKey ?? "";
			storage.providerKeys.get(providerDialog.provider.name).then((key) => {
				if (key) {
					setProviderForm((prev) => ({ ...prev, apiKey: key }));
				}
			}).catch(() => {});
			setProviderForm({
				name: providerDialog.provider.name,
				type: providerDialog.provider.type,
				gatewayKind: providerDialog.provider.gatewayKind ?? "bifrost",
				baseUrl: providerDialog.provider.baseUrl,
				apiKey,
			});
		} else if (providerDialog.type) {
			setProviderForm({
				name: "",
				type: providerDialog.type,
				gatewayKind: "bifrost",
				baseUrl: PROVIDER_TYPE_DEFAULTS[providerDialog.type] || "",
				apiKey: "",
			});
		}
	}, [providerDialog.provider, providerDialog.type]);

	const providers = sortProvidersByPriority(Array.from(new Set([DIO_PROVIDER_ID, ...getProviders()])));

	const handleToggleProvider = (provider: string, hidden: boolean) => {
		toggleProviderVisibility(provider, hidden);
	};

	const handleAddModel = (model: { name: string; id: string; provider: string; api: string; baseUrl: string; reasoning: boolean; vision: boolean }) => {
		const key = `${model.provider}::${model.api}::${model.id}`;
		addCustomModel({
			key,
			id: model.id,
			name: model.name,
			provider: model.provider,
			api: model.api,
			baseUrl: model.baseUrl.trim() || undefined,
			reasoning: model.reasoning,
			vision: model.vision,
		});
	};

	const handleSaveProvider = async () => {
		setProviderError("");
		if (!providerForm.name.trim() || !providerForm.baseUrl.trim()) {
			setProviderError("Name and Base URL are required");
			return;
		}
		const isEdit = !!providerDialog.provider;
		try {
			const storage = getAppStorage();
			const providerId = providerDialog.provider?.id ?? crypto.randomUUID();
			let provider: KeatingCustomProvider = {
				id: providerId,
				name: providerForm.name.trim(),
				type: providerForm.type,
				gatewayKind: providerForm.type === "gateway" ? providerForm.gatewayKind : undefined,
				baseUrl: providerForm.baseUrl.trim(),
				apiKey: providerForm.apiKey.trim() || undefined,
				models: providerDialog.provider?.models ?? [],
			};
			if (AUTO_DISCOVERY_TYPES.has(provider.type)) {
				const models = await discoverCustomProviderModels(provider);
				if (models.length === 0) {
					setProviderError("Connected successfully, but the provider returned no models. Check the base URL and key.");
					return;
				}
				provider = { ...provider, models };
			}
			await storage.customProviders.set(provider as any);
			if (providerForm.apiKey.trim()) {
				await storage.providerKeys.set(provider.name, providerForm.apiKey.trim());
			}
			await loadCustomProviders().then(setCustomProviders);
			setProviderDialog({ open: false });
			setProviderForm(INITIAL_PROVIDER_FORM);
		} catch (error) {
			console.error("Failed to save provider:", error);
			const message = error instanceof Error ? error.message : "Unknown connection error";
			setProviderError(`${isEdit ? "Failed to update" : "Failed to save"} provider: ${message}`);
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

	const openAddType = (type: import("../lib/provider-models").KeatingCustomProviderType) => {
		setProviderDialog({ open: true, type });
	};

	const openEdit = (provider: KeatingCustomProvider) => {
		setProviderDialog({ open: true, provider });
	};

	return (
		<div className="flex flex-col gap-8">
			<SettingsSectionNav
				sections={[
					{ id: "cloud-providers", label: "Cloud" },
					{ id: "web-search", label: "Web Search" },
					{ id: "provider-visibility", label: "Visibility" },
					{ id: "my-models", label: "My Models" },
					{ id: "custom-providers", label: "Custom Providers" },
					...(extraNavSections ?? []),
				]}
			/>

			<CloudProviderKeysSection providers={providers.filter((p) => !modelPrefs.hiddenProviders.includes(p))} />

			<div className="border-t border-border" />

			<WebSearchSection settings={settings} onPatch={patch} />

			<div className="border-t border-border" />

			<ProviderVisibilitySection
				providers={providers}
				modelPrefs={modelPrefs}
				onToggle={handleToggleProvider}
			/>

			<div className="border-t border-border" />

			<MyModelsSection modelPrefs={modelPrefs} onAddModel={handleAddModel} />

			<div className="border-t border-border" />

			<CustomProvidersSection
				customProviders={customProviders}
				onEdit={openEdit}
				onDelete={handleDeleteProvider}
				onAddType={openAddType}
			/>

			<ProviderDialog
				dialog={providerDialog}
				form={providerForm}
				error={providerError}
				onChange={setProviderForm}
				onClose={() => setProviderDialog({ open: false })}
				onSave={handleSaveProvider}
			/>
		</div>
	);
}