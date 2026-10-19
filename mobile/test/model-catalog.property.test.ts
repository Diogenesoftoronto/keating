/** Property checks for narrowing the learner's mobile model catalog. */
import { expect, test } from "bun:test";
import fc from "fast-check";

import { filterCatalogModels, parseModelsDevCatalog } from "../src/lib/model-catalog";

const models = parseModelsDevCatalog({
  openai: {
    name: "OpenAI",
    models: {
      "gpt-fast": { id: "gpt-fast", name: "GPT Fast", reasoning: true, temperature: true, tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 200_000, output: 8_000 } },
      "gpt-small": { id: "gpt-small", name: "GPT Small", reasoning: false, temperature: true, tool_call: false,
        modalities: { input: ["text"], output: ["text"] }, limit: { context: 32_000, output: 4_000 } },
    },
  },
  anthropic: {
    name: "Anthropic",
    models: {
      "claude-long": { id: "claude-long", name: "Claude Long", reasoning: true, temperature: false, tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 500_000, output: 16_000 } },
    },
  },
});

const modelIds = fc.uniqueArray(fc.constantFrom(...models.map(model => model.id)), { maxLength: models.length });
const providerFilters = fc.uniqueArray(fc.constantFrom("openai", "anthropic", "google"), { maxLength: 3 });
const capabilities = fc.uniqueArray(fc.constantFrom("thinking", "vision", "long-context" as const), { maxLength: 3 });

test("adding a capability filter only removes catalog results", () => {
  fc.assert(fc.property(modelIds, providerFilters, capabilities, (ids, providers, selectedCapabilities) => {
    const selectedModels = models.filter(model => ids.includes(model.id));
    const existing = filterCatalogModels(selectedModels, "", providers, selectedCapabilities);
    for (const capability of ["thinking", "vision", "long-context"] as const) {
      const narrowed = filterCatalogModels(selectedModels, "", providers, [...selectedCapabilities, capability]);
      expect(narrowed.every(model => existing.some(candidate => candidate.key === model.key))).toBe(true);
    }
  }), { numRuns: 100 });
});
