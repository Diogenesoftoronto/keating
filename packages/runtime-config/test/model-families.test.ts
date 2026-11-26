/** Curated families resolve to new releases without a code change. */
import { expect, test } from "bun:test";
import { MODEL_FAMILIES, catalogModelsFromModelsDev, familyPreferenceIds, latestInFamily, mergeCatalogModels } from "../src/index.js";

const entry = (id: string, family: string, release_date: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id.toUpperCase(), family, release_date, modalities: { input: ["text"], output: ["text"] }, ...extra });

const payload = {
  anthropic: { models: {
    "claude-haiku-4-5": entry("claude-haiku-4-5", "claude-haiku", "2025-10-15"),
    "claude-haiku-4-5-20251001": entry("claude-haiku-4-5-20251001", "claude-haiku", "2025-10-15"),
    "claude-haiku-5-5": entry("claude-haiku-5-5", "claude-haiku", "2026-10-07"),
    "claude-sonnet-4-5": entry("claude-sonnet-4-5", "claude-sonnet", "2025-09-29", { status: "deprecated" }),
    "claude-sonnet-5-5": entry("claude-sonnet-5-5", "claude-sonnet", "2026-09-28"),
  } },
  openai: { models: {
    "gpt-6.2-sol": entry("gpt-6.2-sol", "gpt-sol", "2026-11-17"),
    "gpt-6.2-sol-healthcare": entry("gpt-6.2-sol-healthcare", "gpt-sol", "2026-11-24"),
    "gpt-daybreak-blue-latest": entry("gpt-daybreak-blue-latest", "gpt-sol", "2026-11-25"),
    "gpt-6.1-sol": entry("gpt-6.1-sol", "gpt-sol", "2026-09-29"),
    "gpt-image-2": entry("gpt-image-2", "gpt-image", "2026-04-21", { modalities: { input: ["text"], output: ["image"] } }),
    "text-embedding-3-small": entry("text-embedding-3-small", "text-embedding", "2024-01-25", { type: "embedding" }),
  } },
  google: { models: {
    "gemini-3.5-flash": entry("gemini-3.5-flash", "gemini-flash", "2026-05-19", { status: "deprecated" }),
    "gemini-3.8-flash": entry("gemini-3.8-flash", "gemini-flash", "2026-09-02"),
    "gemini-flash-latest": entry("gemini-flash-latest", "gemini-flash", "2026-11-20"),
    "bad id; drop": entry("bad id; drop", "gemini-flash", "2026-12-01"),
  } },
};

test("reads only well-formed text-chat entries from an untrusted payload", () => {
  const models = catalogModelsFromModelsDev(payload, ["anthropic", "openai", "google", "absent"]);
  expect(models.map(model => model.id)).not.toContain("gpt-image-2");
  expect(models.map(model => model.id)).not.toContain("text-embedding-3-small");
  expect(models.map(model => model.id)).not.toContain("bad id; drop");
  expect(models.find(model => model.id === "claude-sonnet-4-5")).toMatchObject({ status: "deprecated", releaseDate: "2025-09-29" });
  for (const malformed of [null, [], "x", { anthropic: { models: [] } }, { anthropic: { models: { a: null } } }]) {
    expect(catalogModelsFromModelsDev(malformed, ["anthropic"])).toEqual([]);
  }
});

test("each family resolves to its newest current release", () => {
  const models = catalogModelsFromModelsDev(payload, ["anthropic", "openai", "google"]);
  expect(latestInFamily(models, "anthropic", "claude-haiku")?.id).toBe("claude-haiku-5-5");
  // Specialty builds and rolling aliases never represent a family.
  expect(latestInFamily(models, "openai", "gpt-sol")?.id).toBe("gpt-6.2-sol");
  expect(latestInFamily(models, "google", "gemini-flash")?.id).toBe("gemini-3.8-flash");
  expect(latestInFamily(models, "anthropic", "claude-fable")).toBeUndefined();
  // Families in curated order, releases newest first; deprecated and same-day dated duplicates follow the alias.
  expect(familyPreferenceIds(models, "anthropic", ["claude-sonnet", "claude-haiku"]))
    .toEqual(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-4-5", "claude-haiku-4-5-20251001"]);
});

test("a new release joins its family with no code change", () => {
  const before = catalogModelsFromModelsDev(payload, ["anthropic"]);
  const next = catalogModelsFromModelsDev({ anthropic: { models: { "claude-haiku-6": entry("claude-haiku-6", "claude-haiku", "2027-02-01") } } }, ["anthropic"]);
  expect(familyPreferenceIds(mergeCatalogModels(before, next), "anthropic", MODEL_FAMILIES.auxiliarySearch.anthropic)[0]).toBe("claude-haiku-6");
});
