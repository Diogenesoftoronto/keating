import { useEffect, useReducer, useState } from "react";
import { getProviders } from "@earendil-works/pi-ai/compat";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { css } from "../../styled-system/css";
import { settingsSection } from "../../styled-system/recipes";
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

const stackClass = css({ display: "flex", flexDirection: "column", gap: "2rem" });
const dividerClass = css({ borderTop: "1px solid var(--border)" });

type ProviderEditorState = {
	dialog: ProviderDialogState;
	form: ProviderFormState;
	error: string;
	notice: string;
	saving: boolean;
};

type ProviderEditorAction =
	| { type: "open-add"; providerType: import("../lib/provider-models").KeatingCustomProviderType }
	| { type: "open-edit"; provider: KeatingCustomProvider; apiKey: string }
	| { type: "change"; form: ProviderFormState }
	| { type: "save-start" }
	| { type: "save-failed"; message: string }
	| { type: "save-finished"; notice: string }
	| { type: "close" };

const INITIAL_PROVIDER_EDITOR: ProviderEditorState = {
	dialog: { open: false },
	form: INITIAL_PROVIDER_FORM,
	error: "",
	notice: "",
	saving: false,
};

function providerEditorReducer(
	state: ProviderEditorState,
	action: ProviderEditorAction,
): ProviderEditorState {
	switch (action.type) {
		case "open-add":
			return {
				...INITIAL_PROVIDER_EDITOR,
				dialog: { open: true, type: action.providerType },
				form: {
					...INITIAL_PROVIDER_FORM,
					type: action.providerType,
					baseUrl: PROVIDER_TYPE_DEFAULTS[action.providerType] || "",
				},
				notice: state.notice,
			};
		case "open-edit":
			return {
				...INITIAL_PROVIDER_EDITOR,
				dialog: { open: true, provider: action.provider },
				form: {
					name: action.provider.name,
					type: action.provider.type,
					gatewayKind: action.provider.gatewayKind ?? "bifrost",
					baseUrl: action.provider.baseUrl,
					apiKey: action.apiKey || action.provider.apiKey || "",
				},
				notice: state.notice,
			};
		case "change":
			return { ...state, form: action.form, error: "" };
		case "save-start":
			return { ...state, saving: true, error: "" };
		case "save-failed":
			return { ...state, saving: false, error: action.message };
		case "save-finished":
			return { ...INITIAL_PROVIDER_EDITOR, notice: action.notice };
		case "close":
			return { ...INITIAL_PROVIDER_EDITOR, notice: state.notice };
	}
}

export function ProvidersModelsTab({ extraNavSections }: { extraNavSections?: SettingsSection[] } = {}) {
	const [customProviders, setCustomProviders] = useState<KeatingCustomProvider[]>([]);
	const [settings, patch] = useKeatingUiSettings();
	const [modelPrefs] = useModelPrefs();
	const [providerEditor, dispatchProviderEditor] = useReducer(
		providerEditorReducer,
		INITIAL_PROVIDER_EDITOR,
	);

	useEffect(() => {
		loadCustomProviders().then(setCustomProviders);
	}, []);

	const providers = sortProvidersByPriority(Array.from(new Set([DIO_PROVIDER_ID, ...getProviders()])));

	const handleToggleProvider = (provider: string, hidden: boolean) => {
		toggleProviderVisibility(provider, hidden);
	};

	const handleAddModel = async (model: { name: string; id: string; provider: string; api: string; baseUrl: string; apiKey: string; reasoning: boolean; vision: boolean }) => {
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
		if (model.apiKey.trim()) {
			await getAppStorage().providerKeys.set(model.provider, model.apiKey.trim());
		}
	};

	const handleSaveProvider = async () => {
		const { dialog, form } = providerEditor;
		if (!form.name.trim() || !form.baseUrl.trim()) {
			dispatchProviderEditor({ type: "save-failed", message: "Name and Base URL are required" });
			return;
		}
		const isEdit = !!dialog.provider;
		dispatchProviderEditor({ type: "save-start" });
		try {
			const storage = getAppStorage();
			const providerId = dialog.provider?.id ?? crypto.randomUUID();
			let provider: KeatingCustomProvider = {
				id: providerId,
				name: form.name.trim(),
				type: form.type,
				gatewayKind: form.type === "gateway" ? form.gatewayKind : undefined,
				baseUrl: form.baseUrl.trim(),
				apiKey: form.apiKey.trim() || undefined,
				models: dialog.provider?.models ?? [],
			};
			let discoveryWarning = "";
			if (AUTO_DISCOVERY_TYPES.has(provider.type)) {
				try {
					const models = await discoverCustomProviderModels(provider);
					provider = { ...provider, models };
					if (models.length === 0) {
						discoveryWarning = " Saved, but no models were listed. Add the model manually below.";
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : "model listing failed";
					discoveryWarning = ` Saved, but automatic model discovery failed (${message}). Add the model manually below.`;
				}
			}
			await storage.customProviders.set(provider as any);
			const oldName = dialog.provider?.name;
			if (oldName && oldName !== provider.name) {
				await storage.providerKeys.delete(oldName);
			}
			if (form.apiKey.trim()) {
				await storage.providerKeys.set(provider.name, form.apiKey.trim());
			} else {
				await storage.providerKeys.delete(provider.name);
			}
			await loadCustomProviders().then(setCustomProviders);
			dispatchProviderEditor({
				type: "save-finished",
				notice: `${provider.name} ${isEdit ? "updated" : "saved"}.${discoveryWarning}`,
			});
		} catch (error) {
			console.error("Failed to save provider:", error);
			const message = error instanceof Error ? error.message : "Unknown connection error";
			dispatchProviderEditor({
				type: "save-failed",
				message: `${isEdit ? "Failed to update" : "Failed to save"} provider: ${message}`,
			});
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
		dispatchProviderEditor({ type: "open-add", providerType: type });
	};

	const openEdit = async (provider: KeatingCustomProvider) => {
		const apiKey = await getAppStorage().providerKeys.get(provider.name).catch(() => undefined);
		dispatchProviderEditor({ type: "open-edit", provider, apiKey: apiKey ?? "" });
	};

	return (
		<div className={settingsSection()}>
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

			<div className={dividerClass} />

			<WebSearchSection settings={settings} onPatch={patch} />

			<div className={dividerClass} />

			<ProviderVisibilitySection
				providers={providers}
				modelPrefs={modelPrefs}
				onToggle={handleToggleProvider}
			/>

			<div className={dividerClass} />

			<MyModelsSection
				modelPrefs={modelPrefs}
				customProviders={customProviders}
				onAddModel={handleAddModel}
			/>

			<div className={dividerClass} />

			<CustomProvidersSection
				customProviders={customProviders}
				notice={providerEditor.notice}
				onEdit={openEdit}
				onDelete={handleDeleteProvider}
				onAddType={openAddType}
			/>

			<ProviderDialog
				dialog={providerEditor.dialog}
				form={providerEditor.form}
				error={providerEditor.error}
				saving={providerEditor.saving}
				onChange={(form) => dispatchProviderEditor({ type: "change", form })}
				onClose={() => dispatchProviderEditor({ type: "close" })}
				onSave={handleSaveProvider}
			/>
		</div>
	);
}
