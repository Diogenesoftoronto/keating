import {
  keatingDesignContract,
  terminalDesignProfile,
  type DesignThemeName,
  type TerminalColorMode,
  type TerminalDesignProfile,
  type TerminalGlyphMode,
} from "./design-contract.js";

export type TerminalEnvironment = Readonly<Record<string, string | undefined>>;

export interface TuiTerminalMarks {
  user: string;
  assistant: string;
  tool: string;
  artifact: string;
  notice: string;
  error: string;
}

export interface TuiPresentationProfile {
  theme: DesignThemeName;
  design: TerminalDesignProfile;
  marks: TuiTerminalMarks;
}

export type TuiLayoutSize = "compact" | "regular" | "wide";

export interface TuiLayoutProfile {
  width: number;
  height: number;
  size: TuiLayoutSize;
  showActivityRail: boolean;
  activityRailWidth: number;
  shellPadding: number;
  transcriptTableStyle: "columns" | "grid";
  compactStatus: boolean;
}

function envFlag(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

export function detectTerminalColorMode(env: TerminalEnvironment = process.env): TerminalColorMode {
  if (Object.prototype.hasOwnProperty.call(env, "NO_COLOR") || env.FORCE_COLOR === "0") return "none";
  if (env.FORCE_COLOR === "3") return "truecolor";
  if (env.FORCE_COLOR === "2") return "ansi256";
  if (env.FORCE_COLOR === "1") return "ansi16";
  const colorTerm = env.COLORTERM?.toLowerCase() ?? "";
  const term = env.TERM?.toLowerCase() ?? "";
  if (colorTerm.includes("truecolor") || colorTerm.includes("24bit") || term.includes("direct")) return "truecolor";
  if (term.includes("256color")) return "ansi256";
  if (term === "dumb" || term === "") return "none";
  return "ansi16";
}

export function detectTerminalGlyphMode(env: TerminalEnvironment = process.env): TerminalGlyphMode {
  if (envFlag(env.KEATING_ASCII) || env.TERM?.toLowerCase() === "dumb") return "ascii";
  const locale = (env.LC_ALL || env.LC_CTYPE || env.LANG || "").toUpperCase();
  return locale === "C" || locale === "POSIX" ? "ascii" : "unicode";
}

export function detectTerminalTheme(env: TerminalEnvironment = process.env): DesignThemeName {
  if (env.KEATING_THEME === "light" || env.KEATING_THEME === "dark") return env.KEATING_THEME;
  const background = Number.parseInt(env.COLORFGBG?.split(";").at(-1) ?? "", 10);
  return Number.isFinite(background) && (background === 7 || background >= 9) ? "light" : "dark";
}

export function createTuiPresentationProfile(
  env: TerminalEnvironment = process.env,
): TuiPresentationProfile {
  const theme = detectTerminalTheme(env);
  const glyphMode = detectTerminalGlyphMode(env);
  const design = terminalDesignProfile(theme, detectTerminalColorMode(env), glyphMode);
  return {
    theme,
    design,
    marks: glyphMode === "ascii"
      ? { user: ">", assistant: "K", tool: "->", artifact: "#", notice: ".", error: "X" }
      : { user: ">", assistant: "◆", tool: "→", artifact: "▣", notice: "·", error: design.states.error.glyph },
  };
}

export function terminalSurfaceColor(
  profile: TuiPresentationProfile,
): string | undefined {
  return profile.design.colorMode === "truecolor"
    ? keatingDesignContract.themes[profile.theme].colors.surface
    : undefined;
}

export function terminalLayoutProfile(width: number, height: number): TuiLayoutProfile {
  const safeWidth = Math.max(20, Math.floor(width));
  const safeHeight = Math.max(8, Math.floor(height));
  const size: TuiLayoutSize = safeWidth >= 140 && safeHeight >= 35
    ? "wide"
    : safeWidth >= 100 && safeHeight >= 28
      ? "regular"
      : "compact";
  return {
    width: safeWidth,
    height: safeHeight,
    size,
    showActivityRail: size !== "compact",
    activityRailWidth: size === "wide" ? 32 : 26,
    shellPadding: size === "compact" ? 0 : 1,
    transcriptTableStyle: size === "wide" ? "grid" : "columns",
    compactStatus: size === "compact",
  };
}
