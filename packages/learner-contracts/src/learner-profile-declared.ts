/**
 * Facts a learner *declares* about themselves, as opposed to the mastery and
 * retention values Keating *infers* from evidence. Nothing here is a
 * measurement: a declared profile records preferences and circumstances the
 * learner chose to share, and every field is optional.
 *
 * Dependency-free so the web app, the mobile app and the CLI can share one
 * shape without agreeing on a runtime.
 */

import {
  type Pursuit,
  currentPursuit,
  normalizePursuits,
  pursuitKey,
  startPursuit,
} from "./pursuit.js";

export const DECLARED_PROFILE_SCHEMA_VERSION = 1;

/** Matches the web runtime's existing free-text cap so migration never truncates. */
export const MAX_DECLARED_NOTES_LENGTH = 4_000;

export const DECLARED_PROFILE_GROUPS = [
  "identity",
  "language",
  "context",
  "goals",
  "pedagogy",
  "accessibility",
] as const;
export type DeclaredProfileGroup = (typeof DECLARED_PROFILE_GROUPS)[number];

/**
 * Bands, never a date of birth. A band is enough to pick vocabulary and
 * examples, and it cannot be used to identify anyone.
 */
export const AGE_BANDS = [
  "under-13",
  "13-17",
  "18-24",
  "25-34",
  "35-49",
  "50-64",
  "65-plus",
  "prefer-not-to-say",
] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Only locales the app actually ships; "system" defers to the browser. */
export const INTERFACE_LOCALES = ["system", "en-CA", "fr-CA"] as const;
export type InterfaceLocale = (typeof INTERFACE_LOCALES)[number];

export const LANGUAGE_FLUENCIES = ["beginner", "intermediate", "fluent", "native"] as const;
export type LanguageFluency = (typeof LANGUAGE_FLUENCIES)[number];

export const EDUCATION_STAGES = [
  "primary",
  "secondary",
  "undergraduate",
  "graduate",
  "self-taught",
  "professional",
  "returning",
  "prefer-not-to-say",
] as const;
export type EducationStage = (typeof EDUCATION_STAGES)[number];

export const LEARNING_MOTIVATIONS = [
  "curiosity",
  "school",
  "career",
  "exam",
  "hobby",
  "teaching-others",
] as const;
export type LearningMotivation = (typeof LEARNING_MOTIVATIONS)[number];

export const SOCRATIC_INTENSITIES = ["light", "balanced", "deep"] as const;
export type SocraticIntensity = (typeof SOCRATIC_INTENSITIES)[number];

export const HINT_LEVELS = ["minimal", "moderate", "generous"] as const;
export type HintLevel = (typeof HINT_LEVELS)[number];

export const TEACHING_TONES = ["warm", "neutral", "direct", "playful"] as const;
export type TeachingTone = (typeof TEACHING_TONES)[number];

export const EXPLANATION_DEPTHS = ["overview", "standard", "rigorous"] as const;
export type ExplanationDepth = (typeof EXPLANATION_DEPTHS)[number];

export const TEXT_SCALES = ["default", "large", "larger"] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/**
 * `""` means the learner has not answered; `"prefer-not-to-say"` means they
 * answered by declining. Those are different facts and the tutor treats them
 * differently, so they are not collapsed.
 */
export interface DeclaredLearnerProfile {
  schemaVersion: number;

  preferredName: string;
  pronouns: string;
  ageBand: AgeBand | "";

  interfaceLocale: InterfaceLocale;
  explainInLanguage: string;
  otherLanguages: string[];
  instructionLanguageFluency: LanguageFluency | "";

  educationStage: EducationStage | "";
  priorKnowledge: string;
  interests: string[];

  /**
   * What the learner typed when asked. Deliberately not the source of truth:
   * it seeds the first pursuit and is then free to go stale, because a goal
   * written before the first conversation usually does.
   */
  goalText: string;
  /**
   * The durable list, with at most one `current`. A session confirms the
   * current pursuit rather than inheriting it; see `pursuitStanceForSession`.
   */
  pursuits: Pursuit[];
  motivation: LearningMotivation | "";
  deadline: string;
  weeklyMinutes: number | null;
  preferredSessionMinutes: number | null;

  socraticIntensity: SocraticIntensity | "";
  hintLevel: HintLevel | "";
  tone: TeachingTone | "";
  depth: ExplanationDepth | "";
  examplesFirst: boolean | null;
  analogyDomains: string[];

  reduceMotion: boolean;
  textScale: TextScale | "";
  highContrast: boolean;
  dyslexiaFriendlyFont: boolean;
  screenReader: boolean;
  captionsPreferred: boolean;
  plainLanguage: boolean;

  notes: string;

  updatedAt: string;
  skippedGroups: DeclaredProfileGroup[];
}

export function defaultDeclaredProfile(): DeclaredLearnerProfile {
  return {
    schemaVersion: DECLARED_PROFILE_SCHEMA_VERSION,
    preferredName: "",
    pronouns: "",
    ageBand: "",
    interfaceLocale: "system",
    explainInLanguage: "",
    otherLanguages: [],
    instructionLanguageFluency: "",
    educationStage: "",
    priorKnowledge: "",
    interests: [],
    goalText: "",
    pursuits: [],
    motivation: "",
    deadline: "",
    weeklyMinutes: null,
    preferredSessionMinutes: null,
    socraticIntensity: "",
    hintLevel: "",
    tone: "",
    depth: "",
    examplesFirst: null,
    analogyDomains: [],
    reduceMotion: false,
    textScale: "",
    highContrast: false,
    dyslexiaFriendlyFont: false,
    screenReader: false,
    captionsPreferred: false,
    plainLanguage: false,
    notes: "",
    updatedAt: "",
    skippedGroups: [],
  };
}

function str(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | "" {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Tri-state: `null` keeps "not answered" distinguishable from "answered no". */
function triBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function positiveInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? Math.min(rounded, max) : null;
}

function stringList(value: unknown, maxEntries: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = str(entry, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxEntries) break;
  }
  return out;
}

/**
 * Never throws and never returns a partial object: malformed storage yields
 * defaults, so a corrupted profile degrades to "not answered" rather than
 * breaking the prompt.
 */
export function parseDeclaredProfile(value: unknown): DeclaredLearnerProfile {
  const fallback = defaultDeclaredProfile();
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const input = raw as Record<string, unknown>;

  return {
    schemaVersion: DECLARED_PROFILE_SCHEMA_VERSION,
    preferredName: str(input.preferredName, 80),
    pronouns: str(input.pronouns, 40),
    ageBand: oneOf(input.ageBand, AGE_BANDS),
    interfaceLocale: oneOf(input.interfaceLocale, INTERFACE_LOCALES) || "system",
    explainInLanguage: str(input.explainInLanguage, 60),
    otherLanguages: stringList(input.otherLanguages, 8, 60),
    instructionLanguageFluency: oneOf(input.instructionLanguageFluency, LANGUAGE_FLUENCIES),
    educationStage: oneOf(input.educationStage, EDUCATION_STAGES),
    priorKnowledge: str(input.priorKnowledge, 600),
    interests: stringList(input.interests, 12, 60),
    goalText: str(input.goalText, 1_000),
    pursuits: normalizePursuits(input.pursuits),
    motivation: oneOf(input.motivation, LEARNING_MOTIVATIONS),
    deadline: str(input.deadline, 40),
    weeklyMinutes: positiveInt(input.weeklyMinutes, 10_080),
    preferredSessionMinutes: positiveInt(input.preferredSessionMinutes, 480),
    socraticIntensity: oneOf(input.socraticIntensity, SOCRATIC_INTENSITIES),
    hintLevel: oneOf(input.hintLevel, HINT_LEVELS),
    tone: oneOf(input.tone, TEACHING_TONES),
    depth: oneOf(input.depth, EXPLANATION_DEPTHS),
    examplesFirst: triBool(input.examplesFirst),
    analogyDomains: stringList(input.analogyDomains, 8, 60),
    reduceMotion: bool(input.reduceMotion),
    textScale: oneOf(input.textScale, TEXT_SCALES),
    highContrast: bool(input.highContrast),
    dyslexiaFriendlyFont: bool(input.dyslexiaFriendlyFont),
    screenReader: bool(input.screenReader),
    captionsPreferred: bool(input.captionsPreferred),
    plainLanguage: bool(input.plainLanguage),
    notes: str(input.notes, MAX_DECLARED_NOTES_LENGTH),
    updatedAt: str(input.updatedAt, 40),
    skippedGroups: stringList(input.skippedGroups, DECLARED_PROFILE_GROUPS.length, 32)
      .filter((group): group is DeclaredProfileGroup =>
        (DECLARED_PROFILE_GROUPS as readonly string[]).includes(group)),
  };
}

/** Field ids only — used for telemetry and completeness, never carrying values. */
export const DECLARED_PROFILE_FIELD_GROUPS: Record<DeclaredProfileGroup, readonly (keyof DeclaredLearnerProfile)[]> = {
  identity: ["preferredName", "pronouns", "ageBand"],
  language: ["interfaceLocale", "explainInLanguage", "otherLanguages", "instructionLanguageFluency"],
  context: ["educationStage", "priorKnowledge", "interests"],
  goals: ["goalText", "pursuits", "motivation", "deadline", "weeklyMinutes", "preferredSessionMinutes"],
  pedagogy: ["socraticIntensity", "hintLevel", "tone", "depth", "examplesFirst", "analogyDomains"],
  accessibility: [
    "reduceMotion",
    "textScale",
    "highContrast",
    "dyslexiaFriendlyFont",
    "screenReader",
    "captionsPreferred",
    "plainLanguage",
  ],
};

function isAnswered(profile: DeclaredLearnerProfile, field: keyof DeclaredLearnerProfile): boolean {
  const value = profile[field];
  if (field === "interfaceLocale") return value !== "system";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "boolean") return value;
  return value !== null && value !== undefined;
}

/** Answered field ids, for telemetry counts and the getting-started checklist. */
export function answeredDeclaredProfileFields(profile: DeclaredLearnerProfile): string[] {
  return Object.values(DECLARED_PROFILE_FIELD_GROUPS)
    .flat()
    .filter((field) => isAnswered(profile, field))
    .map((field) => String(field));
}

export function isDeclaredProfileEmpty(profile: DeclaredLearnerProfile): boolean {
  return answeredDeclaredProfileFields(profile).length === 0 && profile.notes.length === 0;
}

/**
 * Turn the optional onboarding/settings starting point into a real current
 * pursuit. The raw text remains as historical context, but the pursuit list is
 * what changes from then on.
 */
export function seedCurrentPursuitFromGoal(
  profile: DeclaredLearnerProfile,
  options: { readonly now?: number; readonly sessionId?: string | null } = {},
): DeclaredLearnerProfile {
  const title = profile.goalText.trim();
  if (!title) return profile;
  return {
    ...profile,
    pursuits: startPursuit(profile.pursuits, {
      title,
      motivation: profile.motivation,
      startedInSessionId: options.sessionId,
      now: options.now,
    }),
  };
}

const AGE_BAND_LABELS: Record<AgeBand, string> = {
  "under-13": "under 13",
  "13-17": "13 to 17",
  "18-24": "18 to 24",
  "25-34": "25 to 34",
  "35-49": "35 to 49",
  "50-64": "50 to 64",
  "65-plus": "65 or older",
  "prefer-not-to-say": "declined to say",
};

const MINUTES = (value: number) => (value >= 60 && value % 60 === 0 ? `${value / 60} h` : `${value} min`);

/**
 * Compact `Label: value` lines for the system prompt. Returns `[]` for an empty
 * profile so callers can omit the whole block rather than sending an empty one.
 */
export function declaredProfilePromptLines(profile: DeclaredLearnerProfile): string[] {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined | null) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  add("Preferred name", profile.preferredName);
  add("Pronouns", profile.pronouns);
  add("Age band", profile.ageBand ? AGE_BAND_LABELS[profile.ageBand] : "");
  add("Explain in language", profile.explainInLanguage);
  add("Also speaks", profile.otherLanguages.join(", "));
  add("Fluency in the language of instruction", profile.instructionLanguageFluency);
  add("Education stage", profile.educationStage);
  add("Prior knowledge (self-reported)", profile.priorKnowledge);
  add("Interests", profile.interests.join(", "));
  const live = currentPursuit(profile.pursuits);
  // Profile prompts are rebuilt outside any one session, so this is a standing
  // fact, not permission to steer the current conversation back to it.
  add("Standing pursuit (not assumed for this session)", live?.title);
  // Only worth showing when it still says something the pursuit does not.
  if (profile.goalText && (!live || pursuitKey(live.title) !== pursuitKey(profile.goalText))) {
    add("Goal as first written", profile.goalText);
  }
  add("Motivation", profile.motivation);
  add("Target date", profile.deadline);
  add("Time available each week", profile.weeklyMinutes ? MINUTES(profile.weeklyMinutes) : "");
  add("Preferred session length", profile.preferredSessionMinutes ? MINUTES(profile.preferredSessionMinutes) : "");
  add("Socratic intensity requested", profile.socraticIntensity);
  add("Hint level requested", profile.hintLevel);
  add("Tone requested", profile.tone);
  add("Depth requested", profile.depth);
  if (profile.examplesFirst !== null) {
    add("Sequencing requested", profile.examplesFirst ? "concrete example before the general rule" : "general rule before the example");
  }
  add("Preferred analogy domains", profile.analogyDomains.join(", "));

  const access: string[] = [];
  if (profile.plainLanguage) access.push("plain language");
  if (profile.screenReader) access.push("uses a screen reader — describe visuals in text");
  if (profile.captionsPreferred) access.push("prefers captions/transcripts");
  if (profile.dyslexiaFriendlyFont) access.push("dyslexia-friendly typography");
  if (profile.reduceMotion) access.push("reduced motion");
  if (profile.highContrast) access.push("high contrast");
  if (profile.textScale && profile.textScale !== "default") access.push(`${profile.textScale} text`);
  add("Accessibility", access.join("; "));

  return lines;
}
