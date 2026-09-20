import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Match the shim convention used by the other storage-backed web tests, but
// keep a real listener registry so the subscribe test exercises dispatch.
const values = new Map<string, string>();
const listeners = new Map<string, Array<(event: unknown) => void>>();
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
};
(globalThis as any).window = {
  dispatchEvent: (event: { type: string }) => {
    for (const listener of listeners.get(event.type) ?? []) listener(event);
    return true;
  },
  addEventListener: (type: string, listener: (event: unknown) => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  },
  removeEventListener: (type: string, listener: (event: unknown) => void) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
  },
};
(globalThis as any).CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

import {
  DEFAULT_JUDGEMENT_MODEL_SETTINGS,
  loadJudgementModelSettings,
  saveJudgementModelSettings,
  subscribeJudgementModelSettings,
} from "../keating/judgement-model";
import { DESKTOP_OFFLINE_MODEL } from "../lib/desktop-offline";

const KEY = "keating:judgement-model";

beforeEach(() => { localStorage.clear(); delete window.keatingOffline; });
afterEach(() => { localStorage.clear(); delete window.keatingOffline; });

describe("the judgement model is configured independently of the tutor model", () => {
  test("defaults to the installed local model with the hosted tier opted out", () => {
    const settings = loadJudgementModelSettings();
    expect(settings.backend).toBe("local");
    expect(settings.localModelId).toBe("RASMUS/MiniCPM5-2B-ONNX");
  });
  test("a chosen judgement model round-trips without touching tutor settings", () => {
    saveJudgementModelSettings({ ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, localModelId: "LiquidAI/LFM2.5-2.6B-ONNX" });
    expect(loadJudgementModelSettings().localModelId).toBe("LiquidAI/LFM2.5-2.6B-ONNX");
    expect(localStorage.getItem("keating_model_prefs")).toBeNull();
    expect(localStorage.getItem("keating_ui_settings")).toBeNull();
  });
  test("escalating to the hosted tier is an explicit stored choice", () => {
    expect(loadJudgementModelSettings().backend).not.toBe("hosted");
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
  test("an unknown backend value does not silently become hosted", () => {
    localStorage.setItem(KEY, JSON.stringify({ backend: "everything", localModelId: "m", gatewayPath: "/g" }));
    expect(loadJudgementModelSettings().backend).toBe("local");
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
