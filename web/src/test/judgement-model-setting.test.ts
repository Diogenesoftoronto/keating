import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Isolate storage and use native events so this fixture cannot change the
// constructors used by EventTargets in later test files.
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
};

import {
  DEFAULT_JUDGEMENT_MODEL_SETTINGS,
  loadJudgementModelSettings,
  saveJudgementModelSettings,
  subscribeJudgementModelSettings,
} from "../keating/judgement-model";
import { DESKTOP_OFFLINE_MODEL } from "../lib/desktop-offline";

const KEY = "keating:judgement-model";

let previousWindow: PropertyDescriptor | undefined;
let previousStorage: PropertyDescriptor | undefined;
beforeEach(() => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  values.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: Object.assign(new EventTarget(), { CustomEvent }) });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
});
afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("the judgement model is configured independently of the tutor model", () => {
  test("direct TypeSafe model persists separately from credentials and survives switching back", () => {
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, hostedProvider: "typesafe", customModel: "jev-1.13" });
    expect(loadJudgementModelSettings()).toMatchObject({ hostedProvider: "typesafe", customModel: "jev-1.13" });
    expect(values.get(KEY)).not.toContain("apiKey");
    saveJudgementModelSettings({ ...loadJudgementModelSettings(), hostedProvider: "notorganic" });
    expect(loadJudgementModelSettings().hostedProvider).toBeUndefined();
    expect(loadJudgementModelSettings().customModel).toBe("jev-1.13");
  });
  test("defaults to hosted review while retaining the selected local fallback model", () => {
    const settings = loadJudgementModelSettings();
    expect(settings.backend).toBe("hosted");
    expect(settings.localModelId).toBe("RASMUS/MiniCPM5-2B-ONNX");
  });
  test("a chosen judgement model round-trips without touching tutor settings", () => {
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, localModelId: "LiquidAI/LFM2.5-2.6B-ONNX" });
    expect(loadJudgementModelSettings().localModelId).toBe("LiquidAI/LFM2.5-2.6B-ONNX");
    expect(localStorage.getItem("keating_model_prefs")).toBeNull();
    expect(localStorage.getItem("keating_ui_settings")).toBeNull();
  });
  test("an explicit local-only choice persists until hosted review is selected", () => {
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, backend: "local" });
    expect(loadJudgementModelSettings().backend).toBe("local");
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, backend: "hosted" });
    expect(loadJudgementModelSettings().backend).toBe("hosted");
  });
  test("judgement can be switched off entirely, leaving the deterministic tier", () => {
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, backend: "off" });
    expect(loadJudgementModelSettings().backend).toBe("off");
  });
  test("an unset desktop preference uses its native scorer without changing tutor settings", () => {
    window.keatingOffline = { scoreLabels: async () => null } as unknown as NonNullable<Window["keatingOffline"]>;
    expect(loadJudgementModelSettings().localModelId).toBe(DESKTOP_OFFLINE_MODEL.id);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem("keating_model_prefs")).toBeNull();
  });
  test("the desktop default preserves an explicit existing local model choice", () => {
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, localModelId: "selected-model" });
    window.keatingOffline = { scoreLabels: async () => null } as unknown as NonNullable<Window["keatingOffline"]>;
    expect(loadJudgementModelSettings().localModelId).toBe("selected-model");
  });
  test("an older desktop bridge without scoring cannot silently select a native scorer", () => {
    window.keatingOffline = {} as NonNullable<Window["keatingOffline"]>;
    expect(loadJudgementModelSettings().localModelId).toBe(DEFAULT_JUDGEMENT_MODEL_SETTINGS.localModelId);
  });
});

describe("stored settings are normalized rather than trusted", () => {
  test("corrupt or unparseable storage falls back to the defaults", () => {
    for (const raw of ["", "{oops", "null", "[]", '"a string"']) {
      localStorage.setItem(KEY, raw);
      expect(loadJudgementModelSettings()).toEqual(DEFAULT_JUDGEMENT_MODEL_SETTINGS);
    }
  });
  test("an unknown backend value falls back to the default review mode", () => {
    localStorage.setItem(KEY, JSON.stringify({ backend: "everything", localModelId: "m", gatewayPath: "/g" }));
    expect(loadJudgementModelSettings().backend).toBe(DEFAULT_JUDGEMENT_MODEL_SETTINGS.backend);
  });
  test("an off-origin gateway is rejected so a credential cannot be shipped to a third party", () => {
    for (const gatewayPath of [
      "https://evil.example/v1/judgement",
      "//evil.example/v1/judgement",
      "api/judgement",
      "",
    ]) {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, gatewayPath }));
      expect(loadJudgementModelSettings().gatewayPath).toBe("/api/judgement");
    }
  });
  test("a same-origin gateway path is preserved", () => {
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, gatewayPath: "/internal/judge" });
    expect(loadJudgementModelSettings().gatewayPath).toBe("/internal/judge");
  });
  test("an empty local model id falls back rather than leaving the scorer unnamed", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, localModelId: "   " }));
    expect(loadJudgementModelSettings().localModelId).toBe("RASMUS/MiniCPM5-2B-ONNX");
  });
});

describe("subscribers observe changes", () => {
  test("saving notifies listeners with the normalized value", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeJudgementModelSettings((settings) => seen.push(settings.backend));
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, backend: "hosted" });
    unsubscribe();
    expect(seen).toContain("hosted");
  });
});
