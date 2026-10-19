import { DEFAULT_MODELS, SERVICE_ENDPOINTS } from "@keating/runtime-config";
import type { ProviderId, ProviderSettings } from "./types";
import { OFFLINE_MODEL } from "./offline-model-contract";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  description: string;
  defaultModel: string;
  defaultBaseUrl: string;
  requiresKey: boolean;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "litert",
    label: "On this device",
    description: "MiniCPM5 text tutor or Gemma 4 E4B with images and audio. Optional downloads in Offline tutor settings.",
    defaultModel: OFFLINE_MODEL.id,
    defaultBaseUrl: "",
    requiresKey: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "OpenAI chat models",
    defaultModel: DEFAULT_MODELS.mobile.openai,
    defaultBaseUrl: SERVICE_ENDPOINTS.openai,
    requiresKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models",
    defaultModel: DEFAULT_MODELS.mobile.anthropic,
    defaultBaseUrl: SERVICE_ENDPOINTS.anthropic,
    requiresKey: true,
  },
  {
    id: "google",
    label: "Google",
    description: "Gemini models",
    defaultModel: DEFAULT_MODELS.mobile.google,
    defaultBaseUrl: SERVICE_ENDPOINTS.google,
    requiresKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Models routed through OpenRouter",
    defaultModel: DEFAULT_MODELS.mobile.openrouter,
    defaultBaseUrl: SERVICE_ENDPOINTS.openrouter,
    requiresKey: true,
  },
  {
    id: "custom",
    label: "Custom",
    description: "OpenAI-compatible local or hosted endpoint",
    defaultModel: DEFAULT_MODELS.mobile.custom,
    defaultBaseUrl: SERVICE_ENDPOINTS.mobileLocal,
    requiresKey: false,
  },
] as const;

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: "openai",
  model: DEFAULT_MODELS.mobile.openai,
  baseUrl: SERVICE_ENDPOINTS.openai,
  temperature: 0.6,
};

export function providerDefinition(provider: ProviderId): ProviderDefinition {
  return PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0];
}

export function settingsForProvider(provider: ProviderId): ProviderSettings {
  const definition = providerDefinition(provider);
  return {
    provider,
    model: definition.defaultModel,
    baseUrl: definition.defaultBaseUrl,
    temperature: DEFAULT_PROVIDER_SETTINGS.temperature,
  };
}
