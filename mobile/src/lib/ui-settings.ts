/**
 * Device-local UI preferences, mirroring the web app's `keating_ui_settings`
 * store. Kept free of React Native imports so the normalizer stays unit
 * testable under `bun test`.
 */

/** Follows the OS unless the learner pins a scheme. */
export type ThemePreference = "system" | "light" | "dark";

/**
 * Named options restyle the whole app; JetBrains Mono is the Keating/web
 * default, while `system` remains available for platform-native typography.
 */
export type UiFontFamily = "system" | "space-mono" | "jetbrains-mono" | "roboto";

/** Same ladder the web app exposes, mapped per provider at request time. */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface KeatingUiSettings {
  theme: ThemePreference;
  fontFamily: UiFontFamily;
  /** Render interactive quiz/question/goal cards instead of the raw tag text. */
  showToolUi: boolean;
  /** Keep provider-designated reasoning summaries available in assistant turns. */
  showReasoning: boolean;
  /** Open reasoning disclosures when a turn first renders. */
  autoExpandReasoning: boolean;
  /** Allow redacted tool arguments and results to expand in the transcript. */
  showToolDetails: boolean;
  /** Show the provider's own error text rather than a short summary. */
  showRawErrors: boolean;
  reasoningLevel: ReasoningLevel;
}

export const DEFAULT_UI_SETTINGS: KeatingUiSettings = {
  theme: "system",
  fontFamily: "jetbrains-mono",
  showToolUi: true,
  showReasoning: true,
  autoExpandReasoning: false,
  showToolDetails: true,
  showRawErrors: false,
  reasoningLevel: "medium",
};

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const FONT_FAMILY_OPTIONS: ReadonlyArray<{
  value: UiFontFamily;
  label: string;
  description: string;
}> = [
  { value: "system", label: "System", description: "The platform UI face, with Space Mono for accents." },
  { value: "space-mono", label: "Space Mono", description: "Retro monospace across the whole app." },
  { value: "jetbrains-mono", label: "JetBrains Mono", description: "Keating's default monospace, matching the web app." },
  { value: "roboto", label: "Roboto", description: "Clean sans serif for prose." },
];

export const REASONING_LEVEL_OPTIONS: ReadonlyArray<{
  value: ReasoningLevel;
  label: string;
  description: string;
}> = [
  { value: "off", label: "Off", description: "Answer without a thinking budget." },
  { value: "minimal", label: "Minimal", description: "The smallest budget the model accepts." },
  { value: "low", label: "Low", description: "Quick reasoning for routine questions." },
  { value: "medium", label: "Medium", description: "Balanced depth and latency." },
  { value: "high", label: "High", description: "Longer deliberation on hard problems." },
  { value: "xhigh", label: "Max", description: "The largest budget the provider allows." },
];

const THEME_VALUES = new Set<ThemePreference>(["system", "light", "dark"]);
const FONT_VALUES = new Set<UiFontFamily>(["system", "space-mono", "jetbrains-mono", "roboto"]);
const REASONING_VALUES = new Set<ReasoningLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

export function normalizeUiSettings(value: unknown): KeatingUiSettings {
  const record = (typeof value === "object" && value !== null ? value : {}) as Partial<KeatingUiSettings>;
  return {
    theme: THEME_VALUES.has(record.theme as ThemePreference) ? record.theme as ThemePreference : DEFAULT_UI_SETTINGS.theme,
    fontFamily: FONT_VALUES.has(record.fontFamily as UiFontFamily)
      ? record.fontFamily as UiFontFamily
      : DEFAULT_UI_SETTINGS.fontFamily,
    showToolUi: typeof record.showToolUi === "boolean" ? record.showToolUi : DEFAULT_UI_SETTINGS.showToolUi,
    showReasoning: typeof record.showReasoning === "boolean" ? record.showReasoning : DEFAULT_UI_SETTINGS.showReasoning,
    autoExpandReasoning: typeof record.autoExpandReasoning === "boolean" ? record.autoExpandReasoning : DEFAULT_UI_SETTINGS.autoExpandReasoning,
    showToolDetails: typeof record.showToolDetails === "boolean" ? record.showToolDetails : DEFAULT_UI_SETTINGS.showToolDetails,
    showRawErrors: typeof record.showRawErrors === "boolean" ? record.showRawErrors : DEFAULT_UI_SETTINGS.showRawErrors,
    reasoningLevel: REASONING_VALUES.has(record.reasoningLevel as ReasoningLevel)
      ? record.reasoningLevel as ReasoningLevel
      : DEFAULT_UI_SETTINGS.reasoningLevel,
  };
}

/**
 * Resolves the preference against the OS scheme. `null`/`undefined` from
 * `useColorScheme()` means the platform could not report one, which stays dark
 * because that is the app's designed default.
 */
export function resolveThemeName(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  return systemScheme === "light" ? "light" : "dark";
}
