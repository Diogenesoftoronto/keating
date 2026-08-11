import { describe, expect, test } from "bun:test";
import {
  catalogSections,
  filterCatalogModels,
  isCatalogModel,
  isNativeTransportCompatible,
  LONG_CONTEXT_THRESHOLD,
  NATIVE_PROVIDER_TRANSPORT,
  modelReasoningLevels,
  modelSupportsTemperature,
  modelSupportsToolCalls,
  parseModelsDevCatalog,
  resolveModelReasoningLevel,
  selectedProviderSettings,
} from "../src/lib/model-catalog";
import type { ProviderSettings } from "../src/lib/types";

const payload = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-chat": {
        id: "gpt-chat",
        name: "GPT Chat",
        description: "A reasoning chat model",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["none", "low", "high", "max"] }],
        temperature: false,
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: LONG_CONTEXT_THRESHOLD, output: 32_000 },
      },
      "gpt-image": {
        id: "gpt-image",
        name: "GPT Image",
        modalities: { input: ["text"], output: ["image"] },
        limit: { context: 0, output: 0 },
      },
      "text-embedding-3-small": {
        id: "text-embedding-3-small",
        name: "Embedding",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 8_192, output: 1_536 },
      },
    },
  },
  unsupported: {
    id: "unsupported",
    name: "Unsupported",
    models: {
      hidden: {
        id: "hidden",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 128_000, output: 8_000 },
      },
    },
  },
};

describe("models.dev mobile catalog", () => {
  test("keeps every validated provider/model result discoverable with explicit native callability", () => {
    const models = parseModelsDevCatalog(payload);
    expect(models).toHaveLength(4);
    expect(models.find((model) => model.key === "openai::gpt-chat")).toMatchObject({
      key: "openai::gpt-chat",
      provider: "openai",
      providerLabel: "OpenAI",
      reasoning: true,
      reasoningLevels: ["off", "low", "high", "xhigh"],
      temperature: false,
      toolCall: true,
      vision: true,
      contextWindow: LONG_CONTEXT_THRESHOLD,
      nativeProvider: "openai",
      transport: "openai-responses",
      callable: true,
      unavailabilityReason: null,
      source: "models.dev",
    });
    expect(models.find((model) => model.key === "unsupported::hidden")).toMatchObject({
      provider: "unsupported",
      nativeProvider: null,
      transport: null,
      callable: false,
      unavailabilityReason: "Unsupported has no native transport in Keating Mobile.",
      recoveryHint: "custom-or-router",
    });
    expect(models.find((model) => model.key === "openai::gpt-image")?.unavailabilityReason)
      .toBe("GPT Image does not produce text responses.");
    expect(models.find((model) => model.key === "openai::text-embedding-3-small")?.unavailabilityReason)
      .toContain("requires an endpoint Keating Mobile cannot call");
    expect(modelSupportsToolCalls(models, {
      provider: "openai", model: "gpt-chat", baseUrl: "https://api.openai.com/v1", temperature: 0.2,
    })).toBe(true);
    expect(models.find((model) => model.key === "unsupported::hidden")?.toolCall).toBe(false);
  });

  test("preserves exact per-model controls and clamps a stored tier", () => {
    const models = parseModelsDevCatalog(payload);
    const settings: ProviderSettings = {
      provider: "openai",
      model: "gpt-chat",
      baseUrl: "https://api.openai.com/v1",
      temperature: 0.6,
    };
    expect(modelReasoningLevels(models, settings)).toEqual(["off", "low", "high", "xhigh"]);
    expect(resolveModelReasoningLevel(models, settings, "minimal")).toBe("low");
    expect(resolveModelReasoningLevel(models, settings, "medium")).toBe("low");
    expect(resolveModelReasoningLevel(models, settings, "xhigh")).toBe("xhigh");
    expect(modelSupportsTemperature(models, settings)).toBe(false);
  });

  test("rejects malformed or model-empty catalogs instead of showing a false success", () => {
    expect(() => parseModelsDevCatalog(null)).toThrow("invalid catalog");
    expect(() => parseModelsDevCatalog({ openai: { models: {} } })).toThrow("no valid provider models");
  });

  test("uses an explicit native transport gate for specialized non-chat endpoints", () => {
    expect(NATIVE_PROVIDER_TRANSPORT).toEqual({
      openai: "openai-responses",
      anthropic: "anthropic-messages",
      google: "google-generative-ai",
      openrouter: "openai-chat-completions",
      custom: "openai-chat-completions",
    });
    expect(isNativeTransportCompatible("openai", "gpt-5.6-luna")).toBe(true);
    expect(isNativeTransportCompatible("openai", "gpt-realtime-2.1")).toBe(false);
    expect(isNativeTransportCompatible("openai", "text-embedding-3-small")).toBe(false);
    expect(isNativeTransportCompatible("google", "gemini-3.5-flash")).toBe(true);
    expect(isNativeTransportCompatible("google", "gemini-3.5-live-translate-preview")).toBe(false);
    expect(isNativeTransportCompatible("openrouter", "openai/gpt-image-2")).toBe(false);
  });

  test("rejects poisoned cache records and transport/provider mismatches", () => {
    const valid = parseModelsDevCatalog(payload).find((model) => model.callable)!;
    expect(isCatalogModel(valid)).toBe(true);
    expect(isCatalogModel({ ...valid, provider: "untrusted" })).toBe(false);
    expect(isCatalogModel({ ...valid, transport: "openai-chat-completions" })).toBe(false);
    expect(isCatalogModel({ ...valid, nativeProvider: null, callable: false, transport: null, unavailabilityReason: "No transport", recoveryHint: "custom-or-router" })).toBe(false);
    expect(isCatalogModel({ ...valid, key: "openai::different" })).toBe(false);
    expect(isCatalogModel({ ...valid, contextWindow: Number.NaN })).toBe(false);
  });

  test("matches web search, provider, and all-selected-capability semantics", () => {
    const models = parseModelsDevCatalog(payload);
    expect(filterCatalogModels(models, "openai", [], [])).toHaveLength(3);
    expect(filterCatalogModels(models, "gpt-chat", [], [])).toHaveLength(1);
    expect(filterCatalogModels(models, "missing", [], [])).toHaveLength(0);
    expect(filterCatalogModels(models, "", ["anthropic"], [])).toHaveLength(0);
    expect(filterCatalogModels(models, "", [], ["thinking", "vision", "long-context"])).toHaveLength(1);
  });

  test("promotes up to the selected recent keys only when search is empty", () => {
    const models = parseModelsDevCatalog(payload);
    const callable = models.find((model) => model.callable)!;
    expect(catalogSections(models, [callable.key], true).recent).toEqual([callable]);
    expect(catalogSections(models, [models[0]!.key], false).recent).toEqual([]);
  });

  test("builds an atomic provider/model/base URL change while preserving temperature", () => {
    const current: ProviderSettings = {
      provider: "openai",
      model: "old",
      baseUrl: "https://api.openai.com/v1",
      temperature: 0.42,
    };
    const model = parseModelsDevCatalog({
      google: {
        name: "Google",
        models: {
          gemini: {
            id: "gemini",
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 1_000_000, output: 64_000 },
          },
        },
      },
    })[0]!;
    expect(selectedProviderSettings(current, model)).toEqual({
      provider: "google",
      model: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      temperature: 0.42,
    });
  });

  test("does not mutate active provider settings for an unavailable discovery result", () => {
    const current: ProviderSettings = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com/v1",
      temperature: 0.2,
    };
    const unavailable = parseModelsDevCatalog(payload).find((model) => model.key === "unsupported::hidden")!;
    expect(unavailable.callable).toBe(false);
    expect(selectedProviderSettings(current, unavailable)).toBe(current);
  });
});
