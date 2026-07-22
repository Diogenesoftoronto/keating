import type { ProviderId, ProviderSettings } from "./types";

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
    id: "openai",
    label: "OpenAI",
    description: "OpenAI chat models",
    defaultModel: "gpt-5.4",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models",
    defaultModel: "claude-sonnet-4-6",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    requiresKey: true,
  },
  {
    id: "google",
    label: "Google",
    description: "Gemini models",
    defaultModel: "gemini-3.5-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Models routed through OpenRouter",
    defaultModel: "anthropic/claude-sonnet-4.6",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresKey: true,
  },
  {
    id: "custom",
    label: "Custom",
    description: "OpenAI-compatible local or hosted endpoint",
    defaultModel: "default",
    defaultBaseUrl: "http://10.0.2.2:11434/v1",
    requiresKey: false,
  },
] as const;

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: "openai",
  model: "gpt-5.4",
  baseUrl: "https://api.openai.com/v1",
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
