import { describe, expect, spyOn, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { releaseFacilitatorOnUnload } from "../rooms/client";
import { resolveFacilitatorModel, type FacilitatorModelDependencies } from "../rooms/facilitator-model";
import { modelKey } from "../lib/model-catalog";
import { DEFAULT_MODEL_PREFS } from "../keating/model-prefs";

const MODEL: Model<Api> = { id: "chosen-model", name: "Chosen model", provider: "test", api: "openai-completions", baseUrl: "https://model.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

describe("room model selection", () => {
  test("honors the explicit Chat model without fallback or inference", async () => {
    let fallback = 0;
    const result = await resolveFacilitatorModel({
      loadPrefs: () => ({ ...DEFAULT_MODEL_PREFS, defaultChatModelKey: modelKey(MODEL) }),
      recent: () => [{ key: "other-model", timestamp: 1 }], selectable: async () => [MODEL],
      resolveAvailable: async () => { fallback++; throw new Error("Must not fall back"); },
    });
    expect(result).toBe(MODEL);
    expect(fallback).toBe(0);
  });

  for (const selection of ["default", "recent"] as const) {
    test(`an unavailable ${selection} selection is a configuration error and never silently switches models`, async () => {
      let fallback = 0;
      const dependencies: Partial<FacilitatorModelDependencies> = {
        loadPrefs: () => ({ ...DEFAULT_MODEL_PREFS, ...(selection === "default" ? { defaultChatModelKey: "missing/model" } : {}) }),
        recent: () => selection === "recent" ? [{ key: "missing/model", timestamp: 1 }] : [],
        selectable: async () => [MODEL], resolveAvailable: async () => { fallback++; return MODEL; },
      };
      await expect(resolveFacilitatorModel(dependencies)).rejects.toThrow("Choose or connect a model in Chat");
      expect(fallback).toBe(0);
    });
  }

  test("with no saved selection follows the existing available-provider path", async () => {
    let calls = 0;
    expect(await resolveFacilitatorModel({
      loadPrefs: () => DEFAULT_MODEL_PREFS, recent: () => [], selectable: async () => { throw new Error("Unexpected catalogue call"); },
      resolveAvailable: async (_model, options) => { calls++; expect(options?.allowFallback).toBe(true); return MODEL; },
    })).toBe(MODEL);
    expect(calls).toBe(1);
  });
});

describe("facilitator unload release", () => {
  test("beacon includes the exact browser lease and encoded room", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let beacon: { url: string; body: Blob } | undefined;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: (url: string, body: Blob) => { beacon = { url, body }; return true; } } });
    const fetch = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Should use beacon"));
    try {
      releaseFacilitatorOnUnload("room/special", "browser_one");
      expect(beacon?.url).toBe("/api/rooms/room%2Fspecial/operations");
      expect(JSON.parse(await beacon!.body.text())).toMatchObject({ type: "facilitator.release", roomId: "room/special", facilitatorId: "browser_one" });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  for (const beacon of ["absent", "false", "throws"] as const) {
    test(`uses keepalive fetch when beacon is ${beacon}`, async () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: beacon === "absent" ? {} : { sendBeacon: () => { if (beacon === "throws") throw new Error("Navigation blocked beacon"); return false; } } });
      const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
      try {
        releaseFacilitatorOnUnload("room_test", "browser_one");
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0]!;
        expect(url).toBe("/api/rooms/room_test/operations");
        expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { "content-type": "application/json" } });
        expect(JSON.parse(String(init?.body))).toMatchObject({ facilitatorId: "browser_one", type: "facilitator.release" });
      } finally {
        fetch.mockRestore();
        if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
        else Reflect.deleteProperty(globalThis, "navigator");
      }
    });
  }
});
