import { providerDefinition } from "./provider-config";
import type { ProviderId, ProviderSettings } from "./types";
import type { ReasoningLevel } from "./ui-settings";

export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json";
export const LONG_CONTEXT_THRESHOLD = 256_000;

export const MODEL_CAPABILITY_FILTERS = [
  { value: "thinking", label: "Thinking" },
  { value: "vision", label: "Vision" },
  { value: "long-context", label: "Long context" },
] as const;

export type ModelCapabilityFilter = (typeof MODEL_CAPABILITY_FILTERS)[number]["value"];

export type NativeModelTransport =
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "openai-chat-completions";

export const NATIVE_PROVIDER_TRANSPORT: Readonly<Record<ProviderId, NativeModelTransport>> = {
  openai: "openai-responses",
  anthropic: "anthropic-messages",
  google: "google-generative-ai",
  openrouter: "openai-chat-completions",
  custom: "openai-chat-completions",
};

export interface CatalogModel {
  key: string;
  /** Provider identifier exactly as published by models.dev. */
  provider: string;
  providerLabel: string;
  id: string;
  name: string;
  description: string;
  reasoning: boolean;
  reasoningLevels: ReasoningLevel[];
  temperature: boolean;
  toolCall: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  /** Native mobile provider, when this catalog entry has one. */
  nativeProvider: ProviderId | null;
  /** The concrete transport used by the native client, when callable. */
  transport: NativeModelTransport | null;
  /** Only callable entries may change the active provider/model settings. */
  callable: boolean;
  /** Stable, user-facing reason for a discovery-only entry. */
  unavailabilityReason: string | null;
  /** The recovery path the selector can offer for a discovery-only entry. */
  recoveryHint: "custom-or-router" | null;
  source: "models.dev" | "built-in" | "custom";
}

export interface CatalogSections {
  recent: CatalogModel[];
  cloud: CatalogModel[];
  custom: CatalogModel[];
}

type ModelsDevProviderId = Exclude<ProviderId, "custom">;

const MODELS_DEV_PROVIDERS = new Set<ModelsDevProviderId>(["openai", "anthropic", "google", "openrouter"]);
const PROVIDER_IDS = new Set<ProviderId>(["openai", "anthropic", "google", "openrouter", "custom"]);
const MODEL_SOURCES = new Set<CatalogModel["source"]>(["models.dev", "built-in", "custom"]);
const REASONING_LEVELS = new Set<ReasoningLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const REASONING_ORDER: readonly ReasoningLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const TRANSPORT_INCOMPATIBLE_ID_PATTERNS: Readonly<Record<ModelsDevProviderId, readonly RegExp[]>> = {
  openai: [/embedding/i, /realtime/i, /transcri/i, /whisper/i, /\btts\b/i, /moderation/i, /image/i, /audio/i],
  anthropic: [],
  google: [/embedding/i, /(?:^|[-/])live(?:[-/]|$)/i, /image/i, /lyria/i, /robotics/i, /deep-research/i],
  openrouter: [/embedding/i, /realtime/i, /transcri/i, /whisper/i, /(?:^|[-/])tts(?:[-/]|$)/i, /moderation/i, /image/i, /audio/i],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function catalogKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

function nativeProviderFor(value: string): ModelsDevProviderId | null {
  return MODELS_DEV_PROVIDERS.has(value as ModelsDevProviderId) ? value as ModelsDevProviderId : null;
}

function unavailableModel(
  provider: string,
  providerLabel: string,
  model: Record<string, unknown>,
  id: string,
  contextWindow: number,
): Pick<CatalogModel, "nativeProvider" | "transport" | "callable" | "unavailabilityReason" | "recoveryHint"> {
  const nativeProvider = nativeProviderFor(provider);
  const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : id;
  if (!nativeProvider) {
    return {
      nativeProvider: null,
      transport: null,
      callable: false,
      unavailabilityReason: `${providerLabel} has no native transport in Keating Mobile.`,
      recoveryHint: "custom-or-router",
    };
  }
  const outputs = stringArray(isRecord(model.modalities) ? model.modalities.output : undefined);
  if (!outputs.includes("text")) {
    return {
      nativeProvider,
      transport: null,
      callable: false,
      unavailabilityReason: `${name} does not produce text responses.`,
      recoveryHint: "custom-or-router",
    };
  }
  if (contextWindow <= 0) {
    return {
      nativeProvider,
      transport: null,
      callable: false,
      unavailabilityReason: `${name} does not advertise a usable text-chat context window.`,
      recoveryHint: "custom-or-router",
    };
  }
  if (!isNativeTransportCompatible(nativeProvider, id)) {
    return {
      nativeProvider,
      transport: null,
      callable: false,
      unavailabilityReason: `${name} requires an endpoint Keating Mobile cannot call through ${NATIVE_PROVIDER_TRANSPORT[nativeProvider]}.`,
      recoveryHint: "custom-or-router",
    };
  }
  return {
    nativeProvider,
    transport: NATIVE_PROVIDER_TRANSPORT[nativeProvider],
    callable: true,
    unavailabilityReason: null,
    recoveryHint: null,
  };
}

function normalizeReasoningLevel(value: unknown): ReasoningLevel | null {
  if (value === "none") return "off";
  if (value === "max") return "xhigh";
  return REASONING_LEVELS.has(value as ReasoningLevel) ? value as ReasoningLevel : null;
}

function reasoningLevelsForModel(model: Record<string, unknown>): ReasoningLevel[] {
  if (model.reasoning !== true) return [];
  const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : [];
  const effort = options.find((option) => isRecord(option) && option.type === "effort");
  const advertised = isRecord(effort) && Array.isArray(effort.values)
    ? effort.values.map(normalizeReasoningLevel).filter((level): level is ReasoningLevel => level !== null)
    : [];
  const levels = new Set<ReasoningLevel>(["off", ...advertised]);

  // Budget-only models expose a numeric floor instead of named effort tiers.
  // Mobile maps the shared ladder to provider-specific token budgets, so all
  // named controls are usable for that shape.
  if (advertised.length === 0 && options.some((option) => isRecord(option) && option.type === "budget_tokens")) {
    REASONING_ORDER.forEach((level) => levels.add(level));
  }
  // Older cached/public records may only carry `reasoning: true`. Retain the
  // safe shared ladder rather than hiding a capability the provider supports.
  if (levels.size === 1) REASONING_ORDER.forEach((level) => levels.add(level));
  return REASONING_ORDER.filter((level) => levels.has(level));
}

export function isCatalogModel(value: unknown): value is CatalogModel {
  if (!isRecord(value) || typeof value.provider !== "string" || !value.provider) return false;
  const provider = value.provider;
  const nativeProvider = value.nativeProvider === null
    ? null
    : PROVIDER_IDS.has(value.nativeProvider as ProviderId) ? value.nativeProvider as ProviderId : undefined;
  if (nativeProvider === undefined) return false;
  const callable = value.callable === true;
  return typeof value.id === "string"
    && value.id.length > 0
    && value.key === catalogKey(provider, value.id)
    && typeof value.providerLabel === "string"
    && typeof value.name === "string"
    && typeof value.description === "string"
    && typeof value.reasoning === "boolean"
    && Array.isArray(value.reasoningLevels)
    && value.reasoningLevels.every((level) => REASONING_LEVELS.has(level as ReasoningLevel))
    && typeof value.temperature === "boolean"
    && typeof value.toolCall === "boolean"
    && typeof value.vision === "boolean"
    && typeof value.contextWindow === "number"
    && Number.isFinite(value.contextWindow)
    && value.contextWindow >= 0
    && typeof value.maxOutputTokens === "number"
    && Number.isFinite(value.maxOutputTokens)
    && value.maxOutputTokens >= 0
    && typeof value.callable === "boolean"
    && (value.transport === null || Object.values(NATIVE_PROVIDER_TRANSPORT).includes(value.transport as NativeModelTransport))
    && (typeof value.unavailabilityReason === "string" || value.unavailabilityReason === null)
    && (value.recoveryHint === null || value.recoveryHint === "custom-or-router")
    && (nativeProvider === null ? !PROVIDER_IDS.has(provider as ProviderId) : provider === nativeProvider)
    && (callable
      ? nativeProvider !== null
        && value.transport === NATIVE_PROVIDER_TRANSPORT[nativeProvider]
        && value.unavailabilityReason === null
        && value.recoveryHint === null
      : value.transport === null
        && typeof value.unavailabilityReason === "string"
        && value.recoveryHint === "custom-or-router")
    && MODEL_SOURCES.has(value.source as CatalogModel["source"]);
}

export function isNativeTransportCompatible(provider: ModelsDevProviderId, modelId: string): boolean {
  return !TRANSPORT_INCOMPATIBLE_ID_PATTERNS[provider].some((pattern) => pattern.test(modelId));
}

/**
 * Validate and normalize the public models.dev provider catalog. Only models
 * as discovery entries. Native-callable entries retain their concrete transport;
 * unsupported providers and specialized endpoints remain visible but cannot be
 * selected into the active provider settings.
 */
export function parseModelsDevCatalog(payload: unknown): CatalogModel[] {
  if (!isRecord(payload)) throw new Error("models.dev returned an invalid catalog.");
  const models: CatalogModel[] = [];

  for (const [providerKey, providerValue] of Object.entries(payload)) {
    if (!isRecord(providerValue)) continue;
    const provider = providerKey.trim();
    if (!provider) continue;
    const providerLabel = typeof providerValue.name === "string"
      ? providerValue.name
      : nativeProviderFor(provider) ? providerDefinition(nativeProviderFor(provider)!).label : provider;
    if (!isRecord(providerValue.models)) continue;

    for (const [recordKey, modelValue] of Object.entries(providerValue.models)) {
      if (!isRecord(modelValue)) continue;
      const id = typeof modelValue.id === "string" && modelValue.id.trim() ? modelValue.id.trim() : recordKey.trim();
      if (!id) continue;
      const modalities = isRecord(modelValue.modalities) ? modelValue.modalities : {};
      const inputs = stringArray(modalities.input);
      const limits = isRecord(modelValue.limit) ? modelValue.limit : {};
      const contextWindow = finiteNonNegative(limits.context);
      const availability = unavailableModel(provider, providerLabel, modelValue, id, contextWindow);

      models.push({
        key: catalogKey(provider, id),
        provider,
        providerLabel,
        id,
        name: typeof modelValue.name === "string" && modelValue.name.trim() ? modelValue.name.trim() : id,
        description: typeof modelValue.description === "string" ? modelValue.description.trim() : "",
        reasoning: modelValue.reasoning === true,
        reasoningLevels: reasoningLevelsForModel(modelValue),
        temperature: modelValue.temperature === true,
        toolCall: modelValue.tool_call === true,
        vision: inputs.includes("image"),
        contextWindow,
        maxOutputTokens: finiteNonNegative(limits.output),
        ...availability,
        source: "models.dev",
      });
    }
  }

  if (models.length === 0) throw new Error("models.dev returned no valid provider models.");
  return dedupeModels(models).sort(compareModels);
}

export function modelHasCapabilities(
  model: CatalogModel,
  capabilities: readonly ModelCapabilityFilter[],
): boolean {
  return capabilities.every((capability) => {
    if (capability === "thinking") return model.reasoning;
    if (capability === "vision") return model.vision;
    return model.contextWindow >= LONG_CONTEXT_THRESHOLD;
  });
}

export function filterCatalogModels(
  models: readonly CatalogModel[],
  query: string,
  providers: readonly string[],
  capabilities: readonly ModelCapabilityFilter[],
): CatalogModel[] {
  const normalized = query.trim().toLowerCase();
  return models.filter((model) => {
    if (providers.length > 0 && !providers.includes(model.provider)) return false;
    if (!modelHasCapabilities(model, capabilities)) return false;
    if (!normalized) return true;
    return `${model.name} ${model.id} ${model.provider} ${model.providerLabel}`.toLowerCase().includes(normalized);
  });
}

export function catalogSections(
  models: readonly CatalogModel[],
  recentKeys: readonly string[],
  includeRecents: boolean,
): CatalogSections {
  const recentSet = new Set(includeRecents ? recentKeys : []);
  return {
    recent: models.filter((model) => model.callable && recentSet.has(model.key)),
    cloud: models.filter((model) => model.source !== "custom" && (!model.callable || !recentSet.has(model.key))),
    custom: models.filter((model) => model.source === "custom" && !recentSet.has(model.key)),
  };
}

export function customCatalogModel(settings: ProviderSettings): CatalogModel | null {
  if (settings.provider !== "custom" || !settings.model.trim()) return null;
  return {
    key: catalogKey("custom", settings.model.trim()),
    provider: "custom",
    providerLabel: "Custom",
    id: settings.model.trim(),
    name: settings.model.trim(),
    description: settings.baseUrl,
    reasoning: false,
    reasoningLevels: [],
    temperature: true,
    toolCall: false,
    vision: false,
    contextWindow: 0,
    maxOutputTokens: 0,
    nativeProvider: "custom",
    transport: NATIVE_PROVIDER_TRANSPORT.custom,
    callable: true,
    unavailabilityReason: null,
    recoveryHint: null,
    source: "custom",
  };
}

/**
 * Whether the currently selected model advertises a thinking budget. Providers
 * reject reasoning parameters on models that do not support them, so the
 * thinking control is only offered — and only sent — when this is true.
 */
export function modelSupportsReasoning(
  models: readonly CatalogModel[],
  settings: ProviderSettings,
): boolean {
  const key = catalogKey(settings.provider, settings.model.trim());
  return models.some((model) => model.callable && model.key === key && model.reasoning);
}

export function modelReasoningLevels(
  models: readonly CatalogModel[],
  settings: ProviderSettings,
): readonly ReasoningLevel[] {
  const key = catalogKey(settings.provider, settings.model.trim());
  return models.find((model) => model.callable && model.key === key)?.reasoningLevels ?? [];
}

export function resolveModelReasoningLevel(
  models: readonly CatalogModel[],
  settings: ProviderSettings,
  requested: ReasoningLevel,
): ReasoningLevel {
  const available = modelReasoningLevels(models, settings);
  if (available.includes(requested)) return requested;
  if (available.length === 0) return "off";
  if (requested === "off") return available.includes("off") ? "off" : available[0] ?? "off";
  const reasoningOnly = available.filter((level) => level !== "off");
  const requestedIndex = REASONING_ORDER.indexOf(requested);
  const below = [...reasoningOnly]
    .filter((level) => REASONING_ORDER.indexOf(level) <= requestedIndex)
    .at(-1);
  return below ?? reasoningOnly[0] ?? "off";
}

export function modelSupportsTemperature(
  models: readonly CatalogModel[],
  settings: ProviderSettings,
): boolean {
  const key = catalogKey(settings.provider, settings.model.trim());
  return models.find((model) => model.callable && model.key === key)?.temperature ?? settings.provider !== "openai";
}

export function modelSupportsToolCalls(
  models: readonly CatalogModel[],
  settings: ProviderSettings,
): boolean {
  const key = catalogKey(settings.provider, settings.model.trim());
  return models.find((model) => model.callable && model.key === key)?.toolCall ?? false;
}

export function selectedProviderSettings(current: ProviderSettings, model: CatalogModel): ProviderSettings {
  if (!model.callable || !model.nativeProvider) return current;
  return {
    provider: model.nativeProvider,
    model: model.id,
    baseUrl: model.nativeProvider === "custom" ? current.baseUrl : providerDefinition(model.nativeProvider).defaultBaseUrl,
    temperature: current.temperature,
  };
}

export function mergeCatalogModels(...groups: ReadonlyArray<readonly CatalogModel[]>): CatalogModel[] {
  return dedupeModels(groups.flat()).sort(compareModels);
}

function dedupeModels(models: readonly CatalogModel[]): CatalogModel[] {
  return Array.from(new Map(models.map((model) => [model.key, model])).values());
}

function compareModels(left: CatalogModel, right: CatalogModel): number {
  return left.providerLabel.localeCompare(right.providerLabel) || left.name.localeCompare(right.name);
}

export const BUILT_IN_MODEL_CATALOG: readonly CatalogModel[] = [
  {
    key: "openai::gpt-5.4",
    provider: "openai",
    providerLabel: "OpenAI",
    id: "gpt-5.4",
    name: "GPT-5.4",
    description: "Built-in offline fallback",
    reasoning: true,
    reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
    temperature: false,
    toolCall: true,
    vision: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    nativeProvider: "openai",
    transport: NATIVE_PROVIDER_TRANSPORT.openai,
    callable: true,
    unavailabilityReason: null,
    recoveryHint: null,
    source: "built-in",
  },
  {
    key: "anthropic::claude-sonnet-4-6",
    provider: "anthropic",
    providerLabel: "Anthropic",
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    description: "Built-in offline fallback",
    reasoning: true,
    reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
    temperature: true,
    toolCall: true,
    vision: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    nativeProvider: "anthropic",
    transport: NATIVE_PROVIDER_TRANSPORT.anthropic,
    callable: true,
    unavailabilityReason: null,
    recoveryHint: null,
    source: "built-in",
  },
  {
    key: "google::gemini-3.5-flash",
    provider: "google",
    providerLabel: "Google",
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    description: "Built-in offline fallback",
    reasoning: true,
    reasoningLevels: ["off", "minimal", "low", "medium", "high"],
    temperature: true,
    toolCall: true,
    vision: true,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    nativeProvider: "google",
    transport: NATIVE_PROVIDER_TRANSPORT.google,
    callable: true,
    unavailabilityReason: null,
    recoveryHint: null,
    source: "built-in",
  },
  {
    key: "openrouter::anthropic/claude-sonnet-4.6",
    provider: "openrouter",
    providerLabel: "OpenRouter",
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    description: "Built-in offline fallback",
    reasoning: true,
    reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
    temperature: true,
    toolCall: true,
    vision: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    nativeProvider: "openrouter",
    transport: NATIVE_PROVIDER_TRANSPORT.openrouter,
    callable: true,
    unavailabilityReason: null,
    recoveryHint: null,
    source: "built-in",
  },
] as const;
