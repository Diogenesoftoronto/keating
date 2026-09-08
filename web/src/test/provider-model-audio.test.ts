import { afterEach, expect, it } from "bun:test";
import { buildSavedModel, discoverCustomProviderModels, modelInputModalities, modelSupportsAudio } from "../lib/provider-models";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

it("recognizes declared audio input without inferring it from generic provider names", () => {
 for (const record of [{ input: ["text", "audio"] }, { input_modalities: ["audio"] }, { architecture: { input_modalities: ["text", "audio"] } }, { inputModalities: ["audio"] }]) expect(modelSupportsAudio(record)).toBe(true);
 expect(modelSupportsAudio({ provider: "openrouter", id: "generic-text-model", input: ["text"] })).toBe(false);
 expect(modelSupportsAudio({ id: "thinkingmachines/inkling" })).toBe(true);
 expect(modelSupportsAudio({ id: "thinkingmachines/inkling:free" })).toBe(true);
 expect(modelSupportsAudio({ id: "some-other-inkling" })).toBe(false);
});

it("preserves richer audio metadata when rebuilding saved models", () => {
 const model = buildSavedModel({ id: "custom-audio", name: "Audio", provider: "gateway", api: "openai-completions", inputModalities: ["text", "audio"] });
 expect(model.input).toEqual(["text"]);
 expect(modelInputModalities(model)).toEqual(["text", "audio"]);
 expect(modelSupportsAudio(model)).toBe(true);
});

it("retains OpenRouter architecture input modalities across model discovery", async () => {
 globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: "custom-audio", architecture: { input_modalities: ["text", "audio"] } }] }), { status: 200 })) as unknown as typeof fetch;
 const models = await discoverCustomProviderModels({ id: "router", name: "Audio router", type: "openai-completions", baseUrl: "https://router.example/v1", models: [] });
 expect(models).toHaveLength(1);
 expect(models[0].input).toEqual(["text"]);
 expect(modelSupportsAudio(models[0])).toBe(true);
});
