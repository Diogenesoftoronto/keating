/** Provider/model selection, the model catalog, and stored API-key status. */
import * as Haptics from "expo-haptics";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useMemo, useRef, useState } from "react";
import { providerDefinition, settingsForProvider } from "@/lib/provider-config";
import {
  BUILT_IN_MODEL_CATALOG,
  type CatalogModel,
  mergeCatalogModels,
  modelReasoningLevels,
  modelSupportsReasoning,
  modelSupportsTemperature,
  selectedProviderSettings,
} from "@/lib/model-catalog";
import { deleteProviderKey, setProviderKey } from "@/lib/storage";
import type { ReasoningLevel } from "@/lib/ui-settings";
import type { PersistedAppState, ProviderId, ProviderSettings } from "@/lib/types";
import type { KeyStatus } from "@/state/hydration";

export const emptyKeyStatus: KeyStatus = {
  litert: false,
  openai: false,
  anthropic: false,
  google: false,
  openrouter: false,
  custom: false,
};

/** A provider is usable when it needs no key or one is stored. */
export function providerConfigured(provider: ProviderId, status: KeyStatus): boolean {
  return !providerDefinition(provider).requiresKey || status[provider];
}

export interface ProviderSettingsApi {
  catalog: readonly CatalogModel[];
  setCatalog: Dispatch<SetStateAction<readonly CatalogModel[]>>;
  catalogRef: MutableRefObject<readonly CatalogModel[]>;
  keyStatus: KeyStatus;
  setKeyStatus: Dispatch<SetStateAction<KeyStatus>>;
  isProviderConfigured: boolean;
  supportsReasoning: boolean;
  reasoningLevels: readonly ReasoningLevel[];
  supportsTemperature: boolean;
  setProvider(provider: ProviderId): void;
  selectProviderModel(model: CatalogModel): void;
  updateProviderSettings(patch: Partial<ProviderSettings>): void;
  saveApiKey(provider: ProviderId, apiKey: string): Promise<void>;
  removeApiKey(provider: ProviderId): Promise<void>;
}

export function useProviderSettings(
  providerSettings: ProviderSettings,
  setState: Dispatch<SetStateAction<PersistedAppState>>,
): ProviderSettingsApi {
  const [catalog, setCatalog] = useState<readonly CatalogModel[]>(BUILT_IN_MODEL_CATALOG);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(emptyKeyStatus);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const setProvider = useCallback((provider: ProviderId) => {
    setState((current) => ({ ...current, providerSettings: settingsForProvider(provider) }));
  }, [setState]);

  const selectProviderModel = useCallback((model: CatalogModel) => {
    setCatalog((current) => {
      const next = mergeCatalogModels(current, [model]);
      catalogRef.current = next;
      return next;
    });
    setState((current) => ({
      ...current,
      providerSettings: selectedProviderSettings(current.providerSettings, model),
    }));
    void Haptics.selectionAsync().catch(() => undefined);
  }, [setState]);

  const updateProviderSettings = useCallback((patch: Partial<ProviderSettings>) => {
    setState((current) => ({
      ...current,
      providerSettings: { ...current.providerSettings, ...patch },
    }));
  }, [setState]);

  const saveApiKey = useCallback(async (provider: ProviderId, apiKey: string) => {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error("Enter an API key before saving.");
    await setProviderKey(provider, trimmed);
    setKeyStatus((current) => ({ ...current, [provider]: true }));
  }, []);

  const removeApiKey = useCallback(async (provider: ProviderId) => {
    await deleteProviderKey(provider);
    setKeyStatus((current) => ({ ...current, [provider]: false }));
  }, []);

  const isProviderConfigured = providerConfigured(providerSettings.provider, keyStatus);
  const supportsReasoning = useMemo(
    () => modelSupportsReasoning(catalog, providerSettings),
    [catalog, providerSettings],
  );
  const reasoningLevels = useMemo(
    () => modelReasoningLevels(catalog, providerSettings),
    [catalog, providerSettings],
  );
  const supportsTemperature = useMemo(
    () => modelSupportsTemperature(catalog, providerSettings),
    [catalog, providerSettings],
  );

  return {
    catalog, setCatalog, catalogRef, keyStatus, setKeyStatus,
    isProviderConfigured, supportsReasoning, reasoningLevels, supportsTemperature,
    setProvider, selectProviderModel, updateProviderSettings, saveApiKey, removeApiKey,
  };
}
