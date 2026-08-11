import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type CatalogModel,
  isCatalogModel,
  MODELS_DEV_CATALOG_URL,
  parseModelsDevCatalog,
} from "./model-catalog";

const CATALOG_CACHE_KEY = "keating.mobile.model-catalog.v1";
const RECENT_MODELS_KEY = "keating.mobile.recent-models.v1";
const MAX_RECENT_MODELS = 7;

interface CachedCatalog {
  updatedAt: number;
  models: CatalogModel[];
}

interface RecentModel {
  key: string;
  timestamp: number;
}

export async function readCachedModelCatalog(): Promise<CatalogModel[]> {
  const raw = await AsyncStorage.getItem(CATALOG_CACHE_KEY);
  if (!raw) return [];
  try {
    const cached = JSON.parse(raw) as Partial<CachedCatalog>;
    return Array.isArray(cached.models) ? cached.models.filter(isCatalogModel) : [];
  } catch {
    return [];
  }
}

export async function refreshModelsDevCatalog(
  fetchImpl: typeof fetch = fetch,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CatalogModel[]> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(MODELS_DEV_CATALOG_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`models.dev refresh failed (HTTP ${response.status}).`);
    const models = parseModelsDevCatalog(await response.json());
    const cache: CachedCatalog = { updatedAt: Date.now(), models };
    await AsyncStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(cache));
    return models;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new Error("models.dev refresh timed out. Check the connection and retry.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function getRecentModelKeys(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(RECENT_MODELS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is RecentModel => (
        typeof entry === "object" && entry !== null
        && typeof (entry as RecentModel).key === "string"
        && typeof (entry as RecentModel).timestamp === "number"
      ))
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, MAX_RECENT_MODELS)
      .map((entry) => entry.key);
  } catch {
    return [];
  }
}

export async function addRecentModelKey(key: string): Promise<void> {
  const existing = await getRecentModelKeys();
  const next: RecentModel[] = [key, ...existing.filter((entry) => entry !== key)]
    .slice(0, MAX_RECENT_MODELS)
    .map((entry, index) => ({ key: entry, timestamp: Date.now() - index }));
  await AsyncStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next));
}
