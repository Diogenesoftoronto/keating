import { describe, expect, test } from "bun:test";

import { formatModelContextWindow, modelChoices, modelKey, modelName, modelPickerTitle, modelProviderChoices } from "../src/tui/model-picker.js";
import type { KeatingPiModel } from "../src/runtime/pty-rpc-client.js";

const models: KeatingPiModel[] = [
  { provider: "openai-codex", id: "gpt-5.5", name: "GPT-5.5", contextWindow: 272_000, reasoning: true },
  { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 1_000_000, reasoning: true, input: ["text", "image"] },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200_000, reasoning: true },
];

describe("TUI model picker", () => {
  test("formats model metadata for a searchable current-model-highlighted list", () => {
    expect(modelKey(models[0]!)).toBe("openai-codex/gpt-5.5");
    expect(modelName({ provider: "local", id: "llama" })).toBe("llama");
    expect(formatModelContextWindow(1_000_000)).toBe("1M ctx");
    expect(formatModelContextWindow(272_000)).toBe("272k ctx");
    const choices = modelChoices(models, models[1]);
    expect(choices[0]).toMatchObject({ key: "anthropic/claude-sonnet-4-6" });
    expect(choices[0]?.label).toContain("●");
    expect(choices[0]?.label).toContain("Claude Sonnet 4.6");
    expect(choices[0]?.label).toContain("anthropic/claude-sonnet-4-6");
    expect(choices[0]?.description).toContain("vision");
  });

  test("describes the configured provider scope without inventing catalog entries", () => {
    expect(modelPickerTitle(models)).toBe("Models · 3 configured across 2 providers");
    expect(modelChoices(models).map((choice) => choice.key)).toEqual([
      "anthropic/claude-haiku-4-5",
      "anthropic/claude-sonnet-4-6",
      "openai-codex/gpt-5.5",
    ]);
  });

  test("groups the complete configured catalog by provider with the current provider first", () => {
    expect(modelProviderChoices(models, "openai-codex")).toEqual([
      { provider: "openai-codex", label: "● openai-codex", description: "1 configured model", count: 1 },
      { provider: "anthropic", label: "  anthropic", description: "2 configured models", count: 2 },
    ]);
    expect(modelChoices(models.filter((model) => model.provider === "anthropic"))).toHaveLength(2);
  });

  test("does not truncate a large provider catalog", () => {
    const catalog = Array.from({ length: 25 }, (_, index) => ({
      provider: "anthropic",
      id: `claude-${index + 1}`,
      name: `Claude ${index + 1}`,
      contextWindow: 200_000,
    }));
    expect(modelChoices(catalog)).toHaveLength(25);
    expect(modelProviderChoices(catalog)).toEqual([
      { provider: "anthropic", label: "  anthropic", description: "25 configured models", count: 25 },
    ]);
  });
});
