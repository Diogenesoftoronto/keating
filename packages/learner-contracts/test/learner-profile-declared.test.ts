import { describe, expect, it } from "bun:test";
import {
  AGE_BANDS,
  DECLARED_PROFILE_SCHEMA_VERSION,
  MAX_DECLARED_NOTES_LENGTH,
  answeredDeclaredProfileFields,
  declaredProfilePromptLines,
  defaultDeclaredProfile,
  isDeclaredProfileEmpty,
  parseDeclaredProfile,
  seedCurrentPursuitFromGoal,
} from "../src/learner-profile-declared.js";
import { currentPursuit } from "../src/pursuit.js";

describe("declared learner profile", () => {
  it("starts empty with every field unanswered", () => {
    const profile = defaultDeclaredProfile();
    expect(profile.schemaVersion).toBe(DECLARED_PROFILE_SCHEMA_VERSION);
    expect(isDeclaredProfileEmpty(profile)).toBe(true);
    expect(answeredDeclaredProfileFields(profile)).toEqual([]);
    expect(declaredProfilePromptLines(profile)).toEqual([]);
  });

  it("falls back to defaults for malformed JSON rather than throwing", () => {
    expect(parseDeclaredProfile("{not json")).toEqual(defaultDeclaredProfile());
    expect(parseDeclaredProfile(null)).toEqual(defaultDeclaredProfile());
    expect(parseDeclaredProfile([1, 2, 3])).toEqual(defaultDeclaredProfile());
    expect(parseDeclaredProfile(42)).toEqual(defaultDeclaredProfile());
  });

  it("drops values outside the declared vocabularies", () => {
    const profile = parseDeclaredProfile({
      ageBand: "42",
      motivation: "world-domination",
      tone: "warm",
      interfaceLocale: "klingon",
    });
    expect(profile.ageBand).toBe("");
    expect(profile.motivation).toBe("");
    expect(profile.tone).toBe("warm");
    expect(profile.interfaceLocale).toBe("system");
  });

  it("keeps 'not answered' distinct from 'declined to answer'", () => {
    expect(parseDeclaredProfile({}).ageBand).toBe("");
    expect(parseDeclaredProfile({ ageBand: "prefer-not-to-say" }).ageBand).toBe("prefer-not-to-say");
    expect(AGE_BANDS).toContain("prefer-not-to-say");
  });

  it("keeps examplesFirst tri-state so 'no' is not read as 'unanswered'", () => {
    expect(parseDeclaredProfile({}).examplesFirst).toBeNull();
    expect(parseDeclaredProfile({ examplesFirst: false }).examplesFirst).toBe(false);
    expect(declaredProfilePromptLines(parseDeclaredProfile({ examplesFirst: false })))
      .toContain("Sequencing requested: general rule before the example");
  });

  it("caps notes and de-duplicates list fields", () => {
    const profile = parseDeclaredProfile({
      notes: "n".repeat(MAX_DECLARED_NOTES_LENGTH + 500),
      interests: ["Cycling", "cycling", "  Baking  ", "", 7],
      otherLanguages: Array.from({ length: 30 }, (_, index) => `lang-${index}`),
    });
    expect(profile.notes).toHaveLength(MAX_DECLARED_NOTES_LENGTH);
    expect(profile.interests).toEqual(["Cycling", "Baking"]);
    expect(profile.otherLanguages).toHaveLength(8);
  });

  it("rejects non-positive or absurd durations", () => {
    expect(parseDeclaredProfile({ weeklyMinutes: 0 }).weeklyMinutes).toBeNull();
    expect(parseDeclaredProfile({ weeklyMinutes: -30 }).weeklyMinutes).toBeNull();
    expect(parseDeclaredProfile({ weeklyMinutes: "120" }).weeklyMinutes).toBeNull();
    expect(parseDeclaredProfile({ weeklyMinutes: 120.4 }).weeklyMinutes).toBe(120);
    expect(parseDeclaredProfile({ weeklyMinutes: 99_999 }).weeklyMinutes).toBe(10_080);
  });

  it("renders only answered fields into prompt lines", () => {
    const lines = declaredProfilePromptLines(parseDeclaredProfile({
      preferredName: "Sam",
      ageBand: "13-17",
      interests: ["skateboarding", "music"],
      hintLevel: "minimal",
      screenReader: true,
      plainLanguage: true,
    }));
    expect(lines).toContain("Preferred name: Sam");
    expect(lines).toContain("Age band: 13 to 17");
    expect(lines).toContain("Interests: skateboarding, music");
    expect(lines).toContain("Hint level requested: minimal");
    expect(lines.some((line) => line.startsWith("Accessibility:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Goal:"))).toBe(false);
    expect(lines.some((line) => line.startsWith("Tone"))).toBe(false);
  });

  it("formats whole-hour durations readably", () => {
    const lines = declaredProfilePromptLines(parseDeclaredProfile({ weeklyMinutes: 120, preferredSessionMinutes: 25 }));
    expect(lines).toContain("Time available each week: 2 h");
    expect(lines).toContain("Preferred session length: 25 min");
  });

  it("counts answered fields without exposing their values", () => {
    const answered = answeredDeclaredProfileFields(parseDeclaredProfile({ preferredName: "Sam", reduceMotion: true }));
    expect(answered).toEqual(["preferredName", "reduceMotion"]);
    expect(answered.join(" ")).not.toContain("Sam");
  });

  it("treats the default system locale as unanswered", () => {
    expect(answeredDeclaredProfileFields(parseDeclaredProfile({ interfaceLocale: "system" }))).toEqual([]);
    expect(answeredDeclaredProfileFields(parseDeclaredProfile({ interfaceLocale: "fr-CA" }))).toEqual(["interfaceLocale"]);
  });

  it("keeps only known skipped groups", () => {
    expect(parseDeclaredProfile({ skippedGroups: ["identity", "nonsense"] }).skippedGroups).toEqual(["identity"]);
  });

  it("turns the optional starting point into the current pursuit when onboarding finishes", () => {
    const profile = seedCurrentPursuitFromGoal(parseDeclaredProfile({
      goalText: "Understand recursion",
      motivation: "curiosity",
    }), { now: 100 });
    expect(currentPursuit(profile.pursuits)).toMatchObject({
      title: "Understand recursion",
      motivation: "curiosity",
      status: "current",
      source: "declared",
    });
    expect(profile.goalText).toBe("Understand recursion");
  });

  it("does not invent a pursuit when the starting point was skipped", () => {
    const profile = defaultDeclaredProfile();
    expect(seedCurrentPursuitFromGoal(profile, { now: 100 })).toBe(profile);
  });

  it("labels a standing pursuit without implying it is this session's subject", () => {
    const profile = seedCurrentPursuitFromGoal(parseDeclaredProfile({ goalText: "Learn Rust" }), { now: 100 });
    const lines = declaredProfilePromptLines(profile);
    expect(lines).toContain("Standing pursuit (not assumed for this session): Learn Rust");
    expect(lines.some((line) => line.startsWith("Current pursuit:"))).toBe(false);
  });
});
