import {
  DESIGN_CONTRACT_VERSION,
  type ColorRole,
  type ContrastRequirement,
  type ContractValidationResult,
  type DesignContract,
  type DesignThemeName,
  type SemanticState,
  type TerminalColorMode,
  type TerminalDesignProfile,
  type TerminalGlyphMode,
  type TerminalStatePresentation,
} from "./types.js";

const COLOR_ROLES: readonly ColorRole[] = [
  "surface", "surfaceRaised", "surfaceMuted", "text", "mutedText", "border",
  "accent", "accentText", "onAccent", "focus", "success", "warning", "danger", "info",
];

const PAPER_SURFACES = ["surface", "surfaceRaised", "surfaceMuted"] as const;
const NORMAL_FOREGROUNDS = ["text", "mutedText", "accentText", "success", "warning", "danger", "info"] as const;

/** Every foreground role is checked on every surface it is permitted to occupy. */
export const REQUIRED_CONTRAST: readonly ContrastRequirement[] = [
  ...NORMAL_FOREGROUNDS.flatMap((foreground) => PAPER_SURFACES.map((background) => ({
    foreground,
    background,
    threshold: 4.5,
    purpose: "normal-text" as const,
  }))),
  ...PAPER_SURFACES.map((background) => ({ foreground: "focus" as const, background, threshold: 3, purpose: "focus" as const })),
  // The source product uses white on the light filled-primary role. It is a
  // large/control-label pairing, so it is assessed at the WCAG large-text bar.
  { foreground: "onAccent", background: "accent", threshold: 3, purpose: "large-text" },
] as const;

/** Source files and exact tokens that establish the current product palette. */
export const PALETTE_PROVENANCE = {
  webSemanticTokens: "web/panda.config.ts",
  rootArtifactTheme: "src/core/artifact-theme.ts",
  rootAnsiTheme: "src/core/theme.ts",
  light: { surface: "#f1ece0", surfaceRaised: "#f6f2e8", surfaceMuted: "#e9e2d2", text: "#1c211b", mutedText: "#4a5247", accent: "#1e9b50", accentText: "#14743c", onAccent: "#ffffff" },
  dark: { surface: "#0c1510", surfaceRaised: "#11201a", surfaceMuted: "#1b2a1f", text: "#dcefe0", mutedText: "#9dbfa8", accent: "#4be388", accentText: "#4be388", onAccent: "#0c1510" },
} as const;

/**
 * Keating's product identity is green-led and paper-readable in light mode,
 * with a phosphor-green terminal-adjacent dark mode. These are roles, not
 * component styles: surfaces choose their own layout and rendering system.
 */
export const keatingDesignContract: DesignContract = {
  version: DESIGN_CONTRACT_VERSION,
  themes: {
    light: {
      colors: {
        surface: PALETTE_PROVENANCE.light.surface,
        surfaceRaised: PALETTE_PROVENANCE.light.surfaceRaised,
        surfaceMuted: PALETTE_PROVENANCE.light.surfaceMuted,
        text: PALETTE_PROVENANCE.light.text,
        mutedText: PALETTE_PROVENANCE.light.mutedText,
        border: "#1c211b",
        accent: PALETTE_PROVENANCE.light.accent,
        accentText: PALETTE_PROVENANCE.light.accentText,
        onAccent: PALETTE_PROVENANCE.light.onAccent,
        focus: PALETTE_PROVENANCE.light.accentText,
        success: PALETTE_PROVENANCE.light.accentText,
        warning: "#805400",
        danger: "#9d2e1e",
        info: "#1d4ed8",
      },
    },
    dark: {
      colors: {
        surface: PALETTE_PROVENANCE.dark.surface,
        surfaceRaised: PALETTE_PROVENANCE.dark.surfaceRaised,
        surfaceMuted: PALETTE_PROVENANCE.dark.surfaceMuted,
        text: PALETTE_PROVENANCE.dark.text,
        mutedText: PALETTE_PROVENANCE.dark.mutedText,
        border: "#6d9279",
        accent: PALETTE_PROVENANCE.dark.accent,
        accentText: PALETTE_PROVENANCE.dark.accentText,
        onAccent: PALETTE_PROVENANCE.dark.onAccent,
        focus: "#7dd3fc",
        success: "#4be388",
        warning: "#f3bd58",
        danger: "#ff9588",
        info: "#93c5fd",
      },
    },
  },
  typography: {
    ui: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
    display: ["Space Mono", "ui-monospace", "Cascadia Mono", "Menlo", "monospace"],
    mono: ["JetBrains Mono", "ui-monospace", "Cascadia Mono", "Menlo", "monospace"],
    bodySizeRem: 1,
    labelSizeRem: 0.75,
    headingScale: { sm: 1.125, md: 1.35, lg: 1.75 },
    bodyLineHeight: 1.55,
    labelLineHeight: 1.2,
  },
  spacing: { xxs: "0.125rem", xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.5rem" },
  radii: { control: "0.25rem", panel: "0.5rem", pill: "999px" },
  states: { focusRingWidth: "2px", focusRingOffset: "2px", disabledOpacity: 0.56, errorTextPrefix: "Error:" },
  motion: { instant: "0ms", fast: "150ms", normal: "220ms", reducedMotion: "none" },
  density: { compactControlHeight: "2rem", regularControlHeight: "2.5rem", minimumTouchTarget: "2.75rem", terminalRowHeight: 1 },
  native: {
    baseUnitDp: 4,
    spacingDp: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    radiiDp: { control: 4, panel: 8, pill: 999 },
    compactControlMinDp: 40,
    regularControlMinDp: 44,
    minimumTouchTargetDp: 44,
    focusRingDp: 2,
  },
} as const;

function hexChannels(color: string): [number, number, number] | null {
  const match = /^#([\da-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = match[1]!;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function linear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const channels = hexChannels(color);
  if (!channels) throw new Error(`Expected a six-digit hex color, received ${color}.`);
  const [red, green, blue] = channels.map(linear) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasValidColor(colors: Record<string, unknown> | undefined, role: ColorRole): colors is Record<ColorRole, string> {
  return typeof colors?.[role] === "string" && hexChannels(colors[role] as string) !== null;
}

function validateNonEmptyString(
  section: string,
  record: Record<string, unknown> | undefined,
  key: string,
  errors: string[],
): void {
  if (typeof record?.[key] !== "string" || record[key].trim().length === 0) {
    errors.push(`${section}.${key} must be a non-empty string.`);
  }
}

function validatePositiveField(
  section: string,
  record: Record<string, unknown> | undefined,
  key: string,
  errors: string[],
): void {
  if (!isPositiveNumber(record?.[key])) {
    errors.push(`${section}.${key} must be a positive finite number.`);
  }
}

function validateFontStack(
  record: Record<string, unknown> | undefined,
  key: string,
  errors: string[],
): void {
  const value = record?.[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((family) => typeof family !== "string" || family.trim().length === 0)) {
    errors.push(`typography.${key} must be a non-empty array of font-family strings.`);
  }
}

export function validateDesignContract(contract: unknown = keatingDesignContract): ContractValidationResult {
  const errors: string[] = [];
  if (!isRecord(contract)) return { ok: false, errors: ["Design contract must be an object."] };
  if (contract.version !== DESIGN_CONTRACT_VERSION) errors.push(`Expected design contract version ${DESIGN_CONTRACT_VERSION}.`);
  const themes = isRecord(contract.themes) ? contract.themes : undefined;
  if (!themes) errors.push("themes is required.");
  for (const themeName of ["light", "dark"] as const) {
    const theme = themes && isRecord(themes[themeName]) ? themes[themeName] : undefined;
    const colors = theme && isRecord(theme.colors) ? theme.colors : undefined;
    if (!theme) errors.push(`${themeName} theme is required.`);
    else if (!colors) errors.push(`${themeName}.colors is required.`);
    for (const role of COLOR_ROLES) {
      const color = colors?.[role];
      if (!color) errors.push(`${themeName}.${role} is required.`);
      else if (typeof color !== "string" || !hexChannels(color)) errors.push(`${themeName}.${role} must be a six-digit hex color.`);
    }
    if (!colors) continue;
    for (const requirement of REQUIRED_CONTRAST) {
      if (!hasValidColor(colors, requirement.foreground) || !hasValidColor(colors, requirement.background)) continue;
      const ratio = contrastRatio(colors[requirement.foreground], colors[requirement.background]);
      if (ratio < requirement.threshold) {
        errors.push(`${themeName}.${requirement.foreground}/${requirement.background} contrast ${ratio.toFixed(2)} is below ${requirement.threshold}.`);
      }
    }
  }
  const density = isRecord(contract.density) ? contract.density : undefined;
  if (!density) errors.push("density is required.");
  else {
    for (const key of ["compactControlHeight", "regularControlHeight", "minimumTouchTarget"] as const) {
      validateNonEmptyString("density", density, key, errors);
    }
    validatePositiveField("density", density, "terminalRowHeight", errors);
    if (density.minimumTouchTarget !== "2.75rem") errors.push("minimumTouchTarget must remain 2.75rem.");
  }
  const native = isRecord(contract.native) ? contract.native : undefined;
  if (!native) errors.push("native is required.");
  else {
    if (native.baseUnitDp !== 4) errors.push("native.baseUnitDp must remain 4.");
    const nativeSpacing = isRecord(native.spacingDp) ? native.spacingDp : undefined;
    if (!nativeSpacing) errors.push("native.spacingDp is required.");
    for (const key of ["xxs", "xs", "sm", "md", "lg", "xl"] as const) {
      validatePositiveField("native.spacingDp", nativeSpacing, key, errors);
    }
    const nativeRadii = isRecord(native.radiiDp) ? native.radiiDp : undefined;
    if (!nativeRadii) errors.push("native.radiiDp is required.");
    for (const key of ["control", "panel", "pill"] as const) {
      validatePositiveField("native.radiiDp", nativeRadii, key, errors);
    }
    for (const key of ["compactControlMinDp", "regularControlMinDp", "minimumTouchTargetDp", "focusRingDp"] as const) {
      validatePositiveField("native", native, key, errors);
    }
    const minimumTouchTargetDp = native.minimumTouchTargetDp;
    if (minimumTouchTargetDp !== 44) errors.push("native.minimumTouchTargetDp must remain 44.");
    if (!isPositiveNumber(native.regularControlMinDp) || !isPositiveNumber(minimumTouchTargetDp) || native.regularControlMinDp < minimumTouchTargetDp) {
      errors.push("native.regularControlMinDp must meet the minimum touch target.");
    }
  }
  const motion = isRecord(contract.motion) ? contract.motion : undefined;
  if (!motion) errors.push("motion is required.");
  else {
    for (const key of ["instant", "fast", "normal"] as const) {
      validateNonEmptyString("motion", motion, key, errors);
    }
    if (motion.reducedMotion !== "none") errors.push("reducedMotion must disable nonessential motion.");
  }
  const states = isRecord(contract.states) ? contract.states : undefined;
  if (!states) errors.push("states is required.");
  else {
    for (const key of ["focusRingWidth", "focusRingOffset", "errorTextPrefix"] as const) {
      validateNonEmptyString("states", states, key, errors);
    }
    if (!(typeof states.disabledOpacity === "number" && states.disabledOpacity > 0 && states.disabledOpacity < 1)) errors.push("disabledOpacity must be between zero and one.");
  }
  const typography = isRecord(contract.typography) ? contract.typography : undefined;
  if (!typography) errors.push("typography is required.");
  else {
    for (const key of ["ui", "display", "mono"] as const) validateFontStack(typography, key, errors);
    for (const key of ["bodySizeRem", "labelSizeRem", "bodyLineHeight", "labelLineHeight"] as const) {
      validatePositiveField("typography", typography, key, errors);
    }
    const headingScale = isRecord(typography.headingScale) ? typography.headingScale : undefined;
    if (!headingScale) errors.push("typography.headingScale is required.");
    for (const key of ["sm", "md", "lg"] as const) validatePositiveField("typography.headingScale", headingScale, key, errors);
  }
  const spacing = isRecord(contract.spacing) ? contract.spacing : undefined;
  if (!spacing) errors.push("spacing is required.");
  for (const key of ["xxs", "xs", "sm", "md", "lg", "xl"] as const) {
    validateNonEmptyString("spacing", spacing, key, errors);
  }
  const radii = isRecord(contract.radii) ? contract.radii : undefined;
  if (!radii) errors.push("radii is required.");
  for (const key of ["control", "panel", "pill"] as const) {
    validateNonEmptyString("radii", radii, key, errors);
  }
  return { ok: errors.length === 0, errors };
}

export function codepointCompare(left: string, right: string): number {
  if (left === right) return 0;
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => codepointCompare(a, b)).map(([key, child]) => [key, sorted(child)]));
}

export function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value));
}

/** Stable portable form for fixtures, generated documentation, and non-web adapters. */
export function exportDesignContract(contract: DesignContract = keatingDesignContract): string {
  return `${JSON.stringify(sorted(contract), null, 2)}\n`;
}

/** Projects every web-consumable section; native dp values remain native-only. */
export function cssVariables(theme: DesignThemeName, contract: DesignContract = keatingDesignContract): string {
  const colors = contract.themes[theme].colors;
  const declarations = COLOR_ROLES.map((role) => `  --keating-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${colors[role]};`);
  declarations.push(
    `  --keating-font-ui: ${contract.typography.ui.join(", ")};`,
    `  --keating-font-display: ${contract.typography.display.join(", ")};`,
    `  --keating-font-mono: ${contract.typography.mono.join(", ")};`,
    `  --keating-body-size: ${contract.typography.bodySizeRem}rem;`,
    `  --keating-label-size: ${contract.typography.labelSizeRem}rem;`,
    `  --keating-heading-sm-scale: ${contract.typography.headingScale.sm};`,
    `  --keating-heading-md-scale: ${contract.typography.headingScale.md};`,
    `  --keating-heading-lg-scale: ${contract.typography.headingScale.lg};`,
    `  --keating-body-line-height: ${contract.typography.bodyLineHeight};`,
    `  --keating-label-line-height: ${contract.typography.labelLineHeight};`,
  );
  for (const [name, value] of Object.entries(contract.spacing)) {
    declarations.push(`  --keating-space-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(contract.radii)) {
    declarations.push(`  --keating-radius-${name}: ${value};`);
  }
  declarations.push(
    `  --keating-focus-ring-width: ${contract.states.focusRingWidth};`,
    `  --keating-focus-ring-offset: ${contract.states.focusRingOffset};`,
    `  --keating-disabled-opacity: ${contract.states.disabledOpacity};`,
    `  --keating-error-text-prefix: ${contract.states.errorTextPrefix};`,
    `  --keating-motion-instant: ${contract.motion.instant};`,
    `  --keating-control-height: ${contract.density.regularControlHeight};`,
    `  --keating-touch-target: ${contract.density.minimumTouchTarget};`,
    `  --keating-motion-fast: ${contract.motion.fast};`,
    `  --keating-motion-normal: ${contract.motion.normal};`,
    `  --keating-motion-reduced: ${contract.motion.reducedMotion};`,
    `  --keating-compact-control-height: ${contract.density.compactControlHeight};`,
    `  --keating-regular-control-height: ${contract.density.regularControlHeight};`,
    `  --keating-minimum-touch-target: ${contract.density.minimumTouchTarget};`,
    `  --keating-terminal-row-height: ${contract.density.terminalRowHeight};`,
  );
  return `:root[data-keating-theme="${theme}"] {\n${declarations.join("\n")}\n}\n`;
}

const TERMINAL_256: Readonly<Record<string, number>> = {
  text: 255, mutedText: 250, accent: 35, focus: 75, success: 35, warning: 178, danger: 167, info: 68,
};
const TERMINAL_16: Readonly<Record<string, number>> = {
  text: 15, mutedText: 7, accent: 2, focus: 6, success: 2, warning: 3, danger: 1, info: 4,
};
const UNICODE_GLYPHS: Readonly<Record<SemanticState, string>> = {
  ready: "○", active: "◐", success: "✓", warning: "▲", error: "✕", disabled: "−",
};
const ASCII_GLYPHS: Readonly<Record<SemanticState, string>> = {
  ready: "o", active: ">", success: "OK", warning: "!", error: "X", disabled: "-",
};
const STATE_LABELS: Readonly<Record<SemanticState, string>> = {
  ready: "Ready", active: "Active", success: "Success", warning: "Warning", error: "Error", disabled: "Unavailable",
};
const STATE_COLOR: Readonly<Record<SemanticState, "mutedText" | "accent" | "success" | "warning" | "danger">> = {
  ready: "mutedText", active: "accent", success: "success", warning: "warning", error: "danger", disabled: "mutedText",
};

export function terminalDesignProfile(
  theme: DesignThemeName,
  colorMode: TerminalColorMode,
  glyphMode: TerminalGlyphMode,
  contract: DesignContract = keatingDesignContract,
): TerminalDesignProfile {
  const colors = contract.themes[theme].colors;
  const token = (role: keyof typeof TERMINAL_256) => colorMode === "none"
    ? undefined
    : {
      ...(colorMode === "truecolor" ? { truecolor: colors[role as ColorRole] } : {}),
      ...(colorMode === "ansi256" ? { ansi256: TERMINAL_256[role] } : {}),
      ...(colorMode === "ansi16" ? { ansi16: TERMINAL_16[role] } : {}),
    };
  const terminalColors = Object.fromEntries(
    (["text", "mutedText", "accent", "focus", "success", "warning", "danger", "info"] as const)
      .map((role) => [role, token(role)]),
  ) as TerminalDesignProfile["colors"];
  const states = Object.fromEntries((Object.keys(STATE_LABELS) as SemanticState[]).map((state) => {
    const presentation: TerminalStatePresentation = {
      state,
      label: STATE_LABELS[state],
      glyph: (glyphMode === "ascii" ? ASCII_GLYPHS : UNICODE_GLYPHS)[state],
      color: terminalColors[STATE_COLOR[state]],
    };
    return [state, presentation];
  })) as TerminalDesignProfile["states"];
  return { colorMode, glyphMode, colors: terminalColors, states };
}

/** Always includes a textual state label, so color and glyph choice are enhancements only. */
export function terminalStateText(state: SemanticState, profile: TerminalDesignProfile): string {
  const presentation = profile.states[state];
  return `${presentation.glyph} ${presentation.label}`;
}
