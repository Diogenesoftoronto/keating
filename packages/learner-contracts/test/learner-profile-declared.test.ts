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


describe("declared additional-language fluencies", () => {
  it("adds empty ratings without changing legacy language names or prompt output", () => {
    const profile = parseDeclaredProfile({ otherLanguages: ["French", "Spanish"], instructionLanguageFluency: "fluent" });
    expect(defaultDeclaredProfile().otherLanguageFluencies).toEqual({});
    expect(profile.otherLanguageFluencies).toEqual({});
    expect(declaredProfilePromptLines(profile)).toEqual([
      "Also speaks: French, Spanish", "Fluency in the language of instruction: fluent",
    ]);
    const legacy = { ...profile };
    delete legacy.otherLanguageFluencies;
    expect(declaredProfilePromptLines(legacy)).toEqual(declaredProfilePromptLines(profile));
    expect(answeredDeclaredProfileFields(legacy)).toEqual(["otherLanguages", "instructionLanguageFluency"]);
  });

  it("matches trimmed case-insensitive names to the retained display spelling", () => {
    const profile = parseDeclaredProfile({
      otherLanguages: [" French ", "FRENCH", "Spanish", "German"],
      otherLanguageFluencies: { " french ": "intermediate", FRENCH: "native", spanish: "beginner", Portuguese: "fluent", German: "unknown" },
    });
    expect(profile.otherLanguages).toEqual(["French", "Spanish", "German"]);
    expect(profile.otherLanguageFluencies).toEqual({ French: "intermediate", Spanish: "beginner" });
    expect(declaredProfilePromptLines(profile)).toContain("Also speaks: French (self-reported fluency: intermediate), Spanish (self-reported fluency: beginner), German");
    expect(declaredProfilePromptLines(profile)).toContain("Other-language fluencies are self-reported communication context, not evidence of subject knowledge or mastery.");
    expect(profile.instructionLanguageFluency).toBe("");
  });

  it("drops removed or renamed ratings without inventing a fluency for the new name", () => {
    const saved = parseDeclaredProfile({ otherLanguages: ["French", "Spanish"], otherLanguageFluencies: { French: "native", Spanish: "fluent" } });
    expect(parseDeclaredProfile({ ...saved, otherLanguages: [" french "] }).otherLanguageFluencies).toEqual({ french: "native" });
    const renamed = parseDeclaredProfile({ ...saved, otherLanguages: ["German"] });
    expect(renamed.otherLanguageFluencies).toEqual({});
    expect(declaredProfilePromptLines(renamed)).toEqual(["Also speaks: German"]);
    expect(parseDeclaredProfile({ ...saved, otherLanguages: [] }).otherLanguageFluencies).toEqual({});
  });

  it("bounds language names and retains ratings only for the first eight unique names", () => {
    const names = Array.from({ length: 10 }, (_, index) => `language-${index}`);
    const longName = "L".repeat(70);
    const profile = parseDeclaredProfile({ otherLanguages: [longName, ...names], otherLanguageFluencies: Object.fromEntries([longName, ...names].map(name => [name, "fluent"])) });
    expect(profile.otherLanguages).toHaveLength(8);
    expect(profile.otherLanguages[0]).toHaveLength(60);
    expect(Object.keys(profile.otherLanguageFluencies!)).toEqual(profile.otherLanguages);
    expect(profile.otherLanguageFluencies!["language-7"]).toBeUndefined();
  });

  it("rejects malformed maps and invalid fluencies without inferring unknown ratings", () => {
    for (const malformed of [null, [], ["native"], "fluent", 42, true]) {
      expect(parseDeclaredProfile({ otherLanguages: ["French"], otherLanguageFluencies: malformed }).otherLanguageFluencies).toEqual({});
    }
    for (const rating of ["", "Native", "unknown", "expert", null, 1, {}, ["fluent"]]) {
      const profile = parseDeclaredProfile({ otherLanguages: ["French"], otherLanguageFluencies: { French: rating } });
      expect(profile.otherLanguageFluencies).toEqual({});
      expect(declaredProfilePromptLines(profile)).toEqual(["Also speaks: French"]);
    }
    const malformed = parseDeclaredProfile({ otherLanguageFluencies: { French: "fluent" } });
    expect(isDeclaredProfileEmpty(malformed)).toBe(true);
    expect(answeredDeclaredProfileFields(malformed)).toEqual([]);
  });

  it("ignores inherited maps and entries while handling prototype-looking language names safely", () => {
    const inheritedRatings = Object.create({ French: "native" });
    inheritedRatings.Spanish = "intermediate";
    expect(parseDeclaredProfile({ otherLanguages: ["French", "Spanish"], otherLanguageFluencies: inheritedRatings }).otherLanguageFluencies)
      .toEqual({ Spanish: "intermediate" });
    const inheritedProfile = Object.create({ otherLanguageFluencies: { French: "native" } });
    inheritedProfile.otherLanguages = ["French"];
    expect(parseDeclaredProfile(inheritedProfile).otherLanguageFluencies).toEqual({});
    const accessorMap = Object.defineProperty({}, "French", { enumerable: true, get() { throw new Error("must-not-read"); } });
    expect(parseDeclaredProfile({ otherLanguages: ["French"], otherLanguageFluencies: accessorMap }).otherLanguageFluencies).toEqual({});
    const accessorProfile = Object.defineProperty({ otherLanguages: ["French"] }, "otherLanguageFluencies", { get() { throw new Error("must-not-read"); } });
    expect(parseDeclaredProfile(accessorProfile).otherLanguageFluencies).toEqual({});
    const nullPrototypeMap = Object.assign(Object.create(null), { French: "fluent" });
    expect(parseDeclaredProfile({ otherLanguages: ["French"], otherLanguageFluencies: nullPrototypeMap }).otherLanguageFluencies).toEqual({ French: "fluent" });
    const special = parseDeclaredProfile('{"otherLanguages":["__proto__","constructor","toString"],"otherLanguageFluencies":{"__proto__":"fluent","constructor":"beginner","toString":"native"}}');
    expect(Object.getPrototypeOf(special.otherLanguageFluencies)).toBe(Object.prototype);
    expect(Object.hasOwn(special.otherLanguageFluencies!, "__proto__")).toBe(true);
    expect(special.otherLanguageFluencies!["__proto__"]).toBe("fluent");
    expect(declaredProfilePromptLines(special)).toContain("Also speaks: __proto__ (self-reported fluency: fluent), constructor (self-reported fluency: beginner), toString (self-reported fluency: native)");
    expect(({} as Record<string, unknown>).French).toBeUndefined();
  });

  it("persists canonical ratings through the existing JSON codec and lists telemetry field ids only", () => {
    const profile = parseDeclaredProfile({ otherLanguages: [" French ", "Spanish"], otherLanguageFluencies: { french: "fluent" }, weeklyMinutes: 10_080 });
    expect(parseDeclaredProfile(JSON.stringify(profile))).toEqual(profile);
    const answered = answeredDeclaredProfileFields(profile);
    expect(answered).toEqual(["otherLanguages", "otherLanguageFluencies", "weeklyMinutes"]);
    expect(answered.join(" ")).not.toContain("French");
    expect(answered.join(" ")).not.toContain("fluent");
    expect(profile.weeklyMinutes).toBe(10_080);
    expect(declaredProfilePromptLines(profile).some(line => /mastered|proficient in subject|strong student/i.test(line))).toBe(false);
  });
});
