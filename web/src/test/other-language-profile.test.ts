import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defaultDeclaredProfile } from "@keating/learner-contracts";
import { DECLARED_PROFILE_STORAGE_KEY, loadDeclaredProfile, saveDeclaredProfile } from "../keating/learner-profile-store";
import { learnerContextPrompt } from "../keating/learner-context";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const records = new Map<string, string>();
const storage: Storage = {
  get length() { return records.size; },
  getItem: key => records.get(key) ?? null,
  setItem: (key, value) => { records.set(key, value); },
  removeItem: key => { records.delete(key); },
  clear: () => records.clear(),
  key: index => Array.from(records.keys())[index] ?? null,
};
beforeEach(() => {
  records.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("other-language profile persistence and teaching context", () => {
  test("legacy language arrays load and save without invented fluency ratings", () => {
    const legacy = { ...defaultDeclaredProfile(), otherLanguages: ["French", "Mandarin Chinese"] };
    delete legacy.otherLanguageFluencies;
    storage.setItem(DECLARED_PROFILE_STORAGE_KEY, JSON.stringify(legacy));
    const loaded = loadDeclaredProfile();
    expect(loaded.otherLanguages).toEqual(["French", "Mandarin Chinese"]);
    expect(loaded.otherLanguageFluencies).toEqual({});
    saveDeclaredProfile(loaded);
    expect(loadDeclaredProfile().otherLanguageFluencies).toEqual({});
    const prompt = learnerContextPrompt("", loadDeclaredProfile());
    expect(prompt).toContain("Also speaks: French, Mandarin Chinese");
    expect(prompt).not.toContain("self-reported fluency:");
  });

  test("named multiword language ratings survive actual web save and load", () => {
    saveDeclaredProfile({ ...defaultDeclaredProfile(), otherLanguages: [" French ", "Mandarin Chinese", "Klingon"],
      otherLanguageFluencies: { french: "fluent", "mandarin chinese": "intermediate" } });
    const loaded = loadDeclaredProfile();
    expect(loaded.otherLanguages).toEqual(["French", "Mandarin Chinese", "Klingon"]);
    expect(loaded.otherLanguageFluencies).toEqual({ French: "fluent", "Mandarin Chinese": "intermediate" });
    const stored = JSON.parse(storage.getItem(DECLARED_PROFILE_STORAGE_KEY)!);
    expect(stored.otherLanguageFluencies).toEqual(loaded.otherLanguageFluencies);
    expect(Object.hasOwn(loaded.otherLanguageFluencies!, "Klingon")).toBe(false);
  });

  test("removing a language prunes its rating from storage and tutor context", () => {
    saveDeclaredProfile({ ...defaultDeclaredProfile(), otherLanguages: ["French", "Mandarin Chinese"],
      otherLanguageFluencies: { French: "fluent", "Mandarin Chinese": "beginner" } });
    const before = loadDeclaredProfile();
    saveDeclaredProfile({ ...before, otherLanguages: ["French"] });
    const after = loadDeclaredProfile();
    expect(after.otherLanguages).toEqual(["French"]);
    expect(after.otherLanguageFluencies).toEqual({ French: "fluent" });
    expect(JSON.parse(storage.getItem(DECLARED_PROFILE_STORAGE_KEY)!).otherLanguageFluencies).toEqual({ French: "fluent" });
    expect(learnerContextPrompt("", after)).not.toContain("Mandarin Chinese");
  });

  test("tutor context receives both ratings as self-reported communication context", () => {
    saveDeclaredProfile({ ...defaultDeclaredProfile(), explainInLanguage: "English", otherLanguages: ["French", "Mandarin Chinese"],
      otherLanguageFluencies: { French: "native", "Mandarin Chinese": "beginner" } });
    const prompt = learnerContextPrompt("", loadDeclaredProfile());
    expect(prompt).toContain("French (self-reported fluency: native)");
    expect(prompt).toContain("Mandarin Chinese (self-reported fluency: beginner)");
    expect(prompt).toContain("self-reported communication context, not evidence of subject knowledge or mastery");
    expect(prompt).toContain("Do not infer ability");
    expect(loadDeclaredProfile().instructionLanguageFluency).toBe("");
  });

  test("optional unanswered ratings stay absent after save and reload", () => {
    saveDeclaredProfile({ ...defaultDeclaredProfile(), otherLanguages: ["French", "Mandarin Chinese"],
      otherLanguageFluencies: { French: "fluent" } });
    saveDeclaredProfile({ ...loadDeclaredProfile(), otherLanguageFluencies: {} });
    expect(loadDeclaredProfile().otherLanguages).toEqual(["French", "Mandarin Chinese"]);
    expect(loadDeclaredProfile().otherLanguageFluencies).toEqual({});
    expect(learnerContextPrompt("", loadDeclaredProfile())).not.toContain("self-reported fluency:");
  });
});
