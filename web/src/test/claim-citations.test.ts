import { afterEach, beforeEach, expect, test } from "bun:test";
import type { JudgementCaller, JudgementRequest } from "@keating/learner-contracts";
import { checkReplyClaims, type ClaimCheckDependencies } from "../keating/judgement/claim-citations";
import { clearClaimCheckCache, getClaimCheck, saveClaimCheck } from "../keating/judgement/claim-citation-store";

const backend = { backend: "system-one" as const, model: "fixture", calibrationSha256: null };
const reply = "Paris is the capital of France. The Eiffel Tower was completed in 1889. Its original lifespan permit ran for 20 years.";

/** Answers each Noul from a table keyed by question id, or by claim text for support questions. */
function judge(answers: Record<string, number>, seen: JudgementRequest[] = []): JudgementCaller {
  return async request => {
    seen.push(request);
    const claim = typeof request.state === "object" && request.state && "claim" in request.state ? String((request.state as { claim: string }).claim) : null;
    return { ok: true, response: { backend, answers: Object.fromEntries(Object.keys(request.questions).map(key =>
      [key, { type: "noul" as const, noul: claim ? answers[`supported:${claim}`] ?? 0 : answers[key] ?? 0 }])) } };
  };
}

function deps(overrides: Partial<ClaimCheckDependencies> = {}): ClaimCheckDependencies & { searches: string[] } {
  const searches: string[] = [];
  return {
    searches,
    extract: async () => ["Paris is the capital of France.", "The Eiffel Tower was completed in 1889.", "Its original lifespan permit ran for 20 years."],
    search: async query => { searches.push(query); return { text: `Results for ${query}`, sites: [{ url: `https://example.test/${searches.length}`, title: "Example" }] }; },
    judge: judge({ common_0: 0.95, common_1: 0.2, common_2: 0.1,
      "supported:The Eiffel Tower was completed in 1889.": 0.9,
      "supported:Its original lifespan permit ran for 20 years.": 0.9 }),
    ...overrides,
  };
}

const signal = () => new AbortController().signal;

test("common knowledge is not searched, and sourced claims bring their pages", async () => {
  const d = deps();
  const result = await checkReplyClaims(reply, [], d, signal());
  expect(result.status).toBe("supported");
  expect(result.claims.map(claim => claim.verdict)).toEqual(["common", "supported", "supported"]);
  expect(d.searches).toEqual(["The Eiffel Tower was completed in 1889.", "Its original lifespan permit ran for 20 years."]);
  expect(result.sources.map(source => source.url)).toEqual(["https://example.test/1", "https://example.test/2"]);
});

test("a claim no search result supports marks the reply unsupported", async () => {
  const result = await checkReplyClaims(reply, [], deps({ judge: judge({ common_0: 0.95, common_1: 0.2, common_2: 0.1,
    "supported:The Eiffel Tower was completed in 1889.": 0.9,
    "supported:Its original lifespan permit ran for 20 years.": 0.2 }) }), signal());
  expect(result.status).toBe("unsupported");
  expect(result.claims.find(claim => claim.verdict === "unsupported")?.quote).toBe("Its original lifespan permit ran for 20 years.");
});

test("a search with no results is unsupported, not unchecked", async () => {
  const result = await checkReplyClaims(reply, [], deps({ search: async () => ({ text: "", sites: [] }) }), signal());
  expect(result.status).toBe("unsupported");
});

test("claims the turn's own sources support are not searched again", async () => {
  const d = deps({ judge: judge({ common_0: 0.95, common_1: 0.1, cited_1: 0.9, common_2: 0.1, cited_2: 0.9 }) });
  const result = await checkReplyClaims(reply, [{ id: "web-1", url: "https://source.test", text: "Completed in 1889 with a 20-year permit." }], d, signal());
  expect(result.status).toBe("supported");
  expect(result.claims.map(claim => claim.verdict)).toEqual(["common", "cited", "cited"]);
  expect(d.searches).toEqual([]);
});

test("unavailable extraction, search or judgement leaves the reply unchecked", async () => {
  expect((await checkReplyClaims(reply, [], deps({ extract: async () => null }), signal())).status).toBe("unchecked");
  expect((await checkReplyClaims(reply, [], deps({ search: async () => null }), signal())).status).toBe("unchecked");
  expect((await checkReplyClaims(reply, [], deps({ judge: async () => ({ ok: false, error: { code: "backend-unavailable", retryable: false } }) }), signal())).status).toBe("unchecked");
  expect((await checkReplyClaims(reply, [], deps({ search: async () => { throw new Error("offline"); } }), signal())).status).toBe("unchecked");
});

test("a reply with no factual claims is supported without any search", async () => {
  const d = deps({ extract: async () => [] });
  expect((await checkReplyClaims(reply, [], d, signal())).status).toBe("supported");
  expect(d.searches).toEqual([]);
});

test("extracted text that is not in the reply is ignored, and short replies are skipped", async () => {
  const d = deps({ extract: async () => ["The Moon is made of cheese."] });
  expect((await checkReplyClaims(reply, [], d, signal())).claims).toEqual([]);
  expect((await checkReplyClaims("Short.", [], deps(), signal())).status).toBe("unchecked");
});

test("cancellation stops the check as unchecked", async () => {
  const controller = new AbortController();
  const result = checkReplyClaims(reply, [], deps({ extract: async () => { controller.abort(); return ["The Eiffel Tower was completed in 1889."]; } }), controller.signal);
  expect((await result).status).toBe("unchecked");
});

let previousStorage: PropertyDescriptor | undefined;
beforeEach(() => {
  const data = new Map<string, string>();
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: {
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear(), key: () => null, get length() { return data.size; } } });
  clearClaimCheckCache();
});
afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("results are stored per message and survive a cache reset", () => {
  saveClaimCheck("s1", "assistant-3-100", { status: "unsupported", sources: [{ url: "https://example.test/a" }],
    claims: [{ quote: "X happened in 1901.", verdict: "unsupported", sources: [] }] }, 5);
  clearClaimCheckCache();
  expect(getClaimCheck("s1", ["other", "assistant-3-100"])).toEqual({ status: "unsupported", sources: [{ url: "https://example.test/a" }], unsupported: ["X happened in 1901."], checkedAt: 5 });
  expect(getClaimCheck("s2", ["assistant-3-100"])).toBeNull();
});
