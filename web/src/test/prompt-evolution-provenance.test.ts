import { expect, test } from "bun:test";
import type { KeatingStorage } from "../keating/storage";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
  (globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}

test("browser prompt evolution retains deterministic proposals and labels their provenance without invoking a judge or activation", async () => {
  const [{ createImprovementTools }, { getActiveKeatingPrompt }, { evolvePromptTemplate }] = await Promise.all([
    import("../keating/browser-tools/improvement"), import("../keating/browser-tools/prompt"), import("../keating/core"),
  ]);
  const saved: any[] = [];
  const storage = { savePromptEvolution: async (name: string, value: unknown) => saved.push({ name, value }) } as unknown as KeatingStorage;
  const base = await getActiveKeatingPrompt(storage);
  const expected = evolvePromptTemplate(base, "learn", 4);
  let judgeCalls = 0;
  const entry = createImprovementTools(storage, {}, async () => [], {
    runtime: { settings: { backend: "off", localModelId: "local", gatewayPath: "/api/judgement" }, policy: { calibration: { entries: {} }, tiers: [{ key: { backend: "system-one", model: "judgement", calibrationSha256: null }, call: async () => { judgeCalls++; throw new Error("must not run"); } }] } },
  store: { put: async () => {} },
  }).find(tool => tool.name === "prompt_evolve")!;
  const result = await entry.execute("evolve", { name: "learn" });
  expect(judgeCalls).toBe(0); expect(saved).toHaveLength(1);
  expect(saved[0].value.bestPrompt).toBe(expected.best.prompt); expect(saved[0].value.bestScore).toBe(expected.best.score);
  expect(saved[0].value.report).toContain("Deterministic heuristic keyword scores");
  expect(JSON.stringify(result)).toContain("typed baseline not-requested (disabled)");
  expect(await getActiveKeatingPrompt(storage)).toBe(base);
});
