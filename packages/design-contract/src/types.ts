/** Browser-, native-, and terminal-neutral semantic design vocabulary. */

export const DESIGN_CONTRACT_VERSION = 1 as const;

export type DesignThemeName = "light" | "dark";
export type TerminalColorMode = "truecolor" | "ansi256" | "ansi16" | "none";
export type TerminalGlyphMode = "unicode" | "ascii";
export type SemanticState = "ready" | "active" | "success" | "warning" | "error" | "disabled";

export type ColorRole =
  | "surface"
  | "surfaceRaised"
  | "surfaceMuted"
  | "text"
  | "mutedText"
  | "border"
  | "accent"
  | "accentText"
  | "onAccent"
  | "focus"
  | "success"
  | "warning"
  | "danger"
  | "info";

export type ColorRoles = Readonly<Record<ColorRole, string>>;

export interface TypographyRoles {
  ui: readonly string[];
  display: readonly string[];
  mono: readonly string[];
  bodySizeRem: number;
  labelSizeRem: number;
  headingScale: Readonly<Record<"sm" | "md" | "lg", number>>;
  bodyLineHeight: number;
  labelLineHeight: number;
}

export interface SpacingRoles {
  xxs: string;
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

export interface RadiusRoles {
  control: string;
  panel: string;
  pill: string;
}

export interface StateRoles {
  focusRingWidth: string;
  focusRingOffset: string;
  disabledOpacity: number;
  errorTextPrefix: string;
}

export interface MotionRoles {
  instant: string;
  fast: string;
  normal: string;
  reducedMotion: "none";
}

export interface DensityRoles {
  compactControlHeight: string;
  regularControlHeight: string;
  minimumTouchTarget: string;
  terminalRowHeight: number;
}

/** Numeric projection for native renderers. 44dp is the non-negotiable target. */
export interface NativeDesignProjection {
  baseUnitDp: number;
  spacingDp: Readonly<Record<keyof SpacingRoles, number>>;
  radiiDp: Readonly<Record<keyof RadiusRoles, number>>;
  compactControlMinDp: number;
  regularControlMinDp: number;
  minimumTouchTargetDp: number;
  focusRingDp: number;
}

export interface ThemeRoles {
  colors: ColorRoles;
}

export interface DesignContract {
  version: typeof DESIGN_CONTRACT_VERSION;
  themes: Readonly<Record<DesignThemeName, ThemeRoles>>;
  typography: TypographyRoles;
  spacing: SpacingRoles;
  radii: RadiusRoles;
  states: StateRoles;
  motion: MotionRoles;
  density: DensityRoles;
  native: NativeDesignProjection;
}

export interface TerminalColorToken {
  truecolor?: string;
  ansi256?: number;
  ansi16?: number;
}

export interface TerminalStatePresentation {
  state: SemanticState;
  label: string;
  glyph: string;
  color: TerminalColorToken | undefined;
}

export interface TerminalDesignProfile {
  colorMode: TerminalColorMode;
  glyphMode: TerminalGlyphMode;
  colors: Readonly<Record<"text" | "mutedText" | "accent" | "focus" | "success" | "warning" | "danger" | "info", TerminalColorToken | undefined>>;
  states: Readonly<Record<SemanticState, TerminalStatePresentation>>;
}

export interface ContrastRequirement {
  foreground: ColorRole;
  background: ColorRole;
  threshold: number;
  purpose: "normal-text" | "large-text" | "focus";
}

export interface ContractValidationResult {
  ok: boolean;
  errors: string[];
}
