/**
 * Curated choices name stable model families. The browser resolves each family to
 * its newest release in the models.dev catalog it already fetches, so a provider's
 * new version needs no code change.
 */

/** The models.dev fields that ranking needs. */
export interface CatalogModel {
  provider: string;
  id: string;
  name: string;
  family?: string;
  releaseDate?: string;
  status?: string;
}

/** Rolling aliases, specialty builds and alternate tool profiles never represent a family. */
const VARIANT_ID = /(?:^|-)latest(?:-|$)|healthcare|customtools/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const RELEASE_DATE = /^\d{4}-\d{2}(?:-\d{2})?$/;

function isCurrent(model: CatalogModel): boolean {
  return model.status !== "deprecated" && model.status !== "alpha" && !VARIANT_ID.test(model.id);
}

/** A family's current releases, newest first. Same-day duplicates prefer the undated alias. */
export function familyReleases(models: readonly CatalogModel[], provider: string, family: string): CatalogModel[] {
  return models
    .filter(model => model.provider === provider && model.family === family && isCurrent(model))
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "")
      || a.id.length - b.id.length || a.id.localeCompare(b.id));
}

export function latestInFamily(models: readonly CatalogModel[], provider: string, family: string): CatalogModel | undefined {
  return familyReleases(models, provider, family)[0];
}

/** Preference order: families in the given order, each family's releases newest first. */
export function familyPreferenceIds(models: readonly CatalogModel[], provider: string, families: readonly string[]): string[] {
  return [...new Set(families.flatMap(family => familyReleases(models, provider, family).map(model => model.id)))];
}

/** Live entries replace snapshot entries with the same provider and ID. */
export function mergeCatalogModels(...sources: ReadonlyArray<readonly CatalogModel[]>): CatalogModel[] {
  const merged = new Map<string, CatalogModel>();
  for (const source of sources) for (const model of source) merged.set(`${model.provider}::${model.id}`, model);
  return [...merged.values()];
}

/**
 * Read text-chat models from a models.dev payload. The payload is untrusted:
 * only well-formed IDs, names and dates are kept, and nothing else is copied.
 */
export function catalogModelsFromModelsDev(payload: unknown, providers: readonly string[]): CatalogModel[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  const result: CatalogModel[] = [];
  for (const provider of providers) {
    const entry = (payload as Record<string, unknown>)[provider];
    const models = entry !== null && typeof entry === "object" ? (entry as { models?: unknown }).models : undefined;
    if (models === null || typeof models !== "object" || Array.isArray(models)) continue;
    for (const [key, value] of Object.entries(models as Record<string, unknown>)) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const data = value as Record<string, unknown>;
      const id = typeof data.id === "string" && data.id.trim() ? data.id : key;
      if (!MODEL_ID.test(id)) continue;
      const modalities = data.modalities !== null && typeof data.modalities === "object" ? data.modalities as Record<string, unknown> : {};
      const output = Array.isArray(modalities.output) ? modalities.output : [];
      if (output.length !== 1 || output[0] !== "text") continue;
      if (data.type !== undefined && data.type !== "chat" && data.type !== "language") continue;
      const name = typeof data.name === "string" && data.name.trim() && data.name.length <= 120 ? data.name.trim() : id;
      const family = typeof data.family === "string" && MODEL_ID.test(data.family) ? data.family : undefined;
      const releaseDate = typeof data.release_date === "string" && RELEASE_DATE.test(data.release_date) ? data.release_date : undefined;
      const status = typeof data.status === "string" && /^[a-z]{1,20}$/.test(data.status) ? data.status : undefined;
      result.push({ provider, id, name, ...(family ? { family } : {}), ...(releaseDate ? { releaseDate } : {}), ...(status ? { status } : {}) });
    }
  }
  return result.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}

/**
 * The browser's curated choices, as families rather than versions. Edit these only
 * to change which tiers Keating prefers; new releases in a family arrive by themselves.
 */
export const MODEL_FAMILIES = {
  /** First-run fallback order when a learner connects one of these providers. */
  webChat: {
    openai: ["gpt-sol", "gpt-astra", "gpt", "gpt-pro"],
    anthropic: ["claude-sonnet", "claude-opus", "claude-fable", "claude-haiku"],
    google: ["gemini", "gemini-flash", "gemini-pro"],
  },
  /** Cheap, fast tiers first: these models only run supporting web searches. */
  auxiliarySearch: {
    openai: ["gpt-luna", "gpt-sol", "gpt", "gpt-mini"],
    google: ["gemini-flash", "gemini-pro", "gemini"],
    anthropic: ["claude-haiku", "claude-sonnet"],
  },
} as const satisfies Record<"webChat" | "auxiliarySearch", Record<string, readonly string[]>>;
