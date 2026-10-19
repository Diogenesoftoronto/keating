import { describe, expect, test } from "bun:test";
import { startHydration, type HydrationLoaders, type HydrationSinks } from "../src/state/hydration";

const settings = { provider: "openai", model: "m", baseUrl: "u", temperature: 0.5 } as never;
const persisted = (id: string) => ({
  schemaVersion: 4, sessions: [{ id, title: id, createdAt: 1, updatedAt: 1, messages: [] }], activeSessionId: id,
  artifacts: [], providerSettings: settings, learnerFeedback: { helpful: 0, missed: 0 },
}) as never;

function harness(overrides: Partial<HydrationLoaders> = {}) {
  const log: string[] = [];
  let closed = 0;
  const repository = { close: async () => { closed++; }, records: { snapshot: async () => ({ marker: "snapshot" }), getLocalAttachments: async () => [] } } as never;
  const loaders: HydrationLoaders = {
    providerIds: ["openai", "litert"],
    hasProviderKey: async (provider) => provider === "openai" ? "sk" : "",
    readCachedModelCatalog: async () => [{ id: "cached" } as never],
    loadPersona: async () => "persona",
    bootstrapRepository: async () => ({ repository }),
    loadPersistedState: async () => persisted("s1"),
    loadLearnerContext: async () => "context",
    listJudgementReviews: async () => [],
    project: (_snapshot, _settings, _locations, activeId) => ({ state: persisted(activeId ?? "none"), unprojected: {} }) as never,
    defaultProviderSettings: settings,
    ...overrides,
  };
  const sinks: HydrationSinks = {
    setKeyStatus: (status) => log.push(`keys:${JSON.stringify(status)}`),
    mergeCachedCatalog: (cached) => log.push(`catalog:${cached.length}`),
    setPersona: (text) => log.push(`persona:${text}`),
    setStorageError: (message) => log.push(`error:${message}`),
    attachRepository: (_repo, state) => log.push(`attach:${state.activeSessionId}`),
    setJudgementReviews: () => log.push("reviews"),
    setLearnerContext: (text) => log.push(`context:${text}`),
    markRepositoryReady: () => log.push("repository-ready"),
    useCacheOnly: (state) => log.push(`cache-only:${state.activeSessionId}`),
    markHydrated: () => log.push("hydrated"),
    releaseRepository: (opened) => log.push(`release:${opened ? "repo" : "none"}`),
  };
  return { log, loaders, sinks, closed: () => closed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("start-up hydration", () => {
  test("fills every store, attaches the repository, and marks hydrated last", async () => {
    const { log, loaders, sinks } = harness();
    startHydration(loaders, sinks);
    await settle();
    expect(log).toContain('keys:{"openai":true,"litert":false}');
    expect(log).toContain("catalog:1");
    expect(log).toContain("persona:persona");
    const order = ["attach:s1", "reviews", "context:context", "repository-ready", "hydrated"].map((entry) => log.indexOf(entry));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("an empty cached catalog is not merged", async () => {
    const { log, loaders, sinks } = harness({ readCachedModelCatalog: async () => [] });
    startHydration(loaders, sinks);
    await settle();
    expect(log.some((entry) => entry.startsWith("catalog:"))).toBe(false);
  });

  test("a repository that cannot open falls back to the preserved cache and still hydrates", async () => {
    const { log, loaders, sinks } = harness({ bootstrapRepository: async () => { throw new Error("db locked"); } });
    startHydration(loaders, sinks);
    await settle();
    expect(log).toContain("error:SQLite learner repository: db locked");
    expect(log).toContain("cache-only:s1");
    expect(log).not.toContain("repository-ready");
    expect(log.at(-1)).toBe("hydrated");
  });

  test("an unreadable cache after a failed open leaves the primary error as the explanation", async () => {
    const { log, loaders, sinks } = harness({
      bootstrapRepository: async () => { throw "nope"; },
      loadPersistedState: async () => { throw new Error("cache corrupt"); },
    });
    startHydration(loaders, sinks);
    await settle();
    expect(log).toContain("error:Could not open the SQLite learner repository.");
    expect(log.some((entry) => entry.startsWith("cache-only"))).toBe(false);
    expect(log.at(-1)).toBe("hydrated");
  });

  test("credential and persona failures are reported without blocking the rest", async () => {
    const { log, loaders, sinks } = harness({
      hasProviderKey: async () => { throw new Error("keystore"); },
      loadPersona: async () => { throw new Error("no persona"); },
    });
    startHydration(loaders, sinks);
    await settle();
    expect(log).toContain("error:keystore");
    expect(log).toContain("error:no persona");
    expect(log).toContain("repository-ready");
  });

  test("tearing down before the repository opens closes it and publishes nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { log, loaders, sinks, closed } = harness();
    const open = loaders.bootstrapRepository;
    loaders.bootstrapRepository = async () => { await gate; return open(); };
    const stop = startHydration(loaders, sinks);
    stop();
    release();
    await settle();
    expect(log).not.toContain("repository-ready");
    expect(log).not.toContain("hydrated");
    expect(log).not.toContain("persona:persona");
    expect(closed()).toBe(1);
    expect(log).toContain("release:none");
  });

  test("teardown hands the opened repository to the release sink", async () => {
    const { log, loaders, sinks } = harness();
    const stop = startHydration(loaders, sinks);
    await settle();
    stop();
    expect(log.at(-1)).toBe("release:repo");
  });
});
