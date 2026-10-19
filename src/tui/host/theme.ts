/**
 * Terminal theme for the OpenTUI host: resolves the presentation profile into
 * OpenTUI colours, border glyphs and the markdown syntax style. Pure value
 * construction; nothing here touches the renderer.
 */
import { RGBA, SyntaxStyle, type ColorInput } from "@opentui/core";
import { terminalSurfaceColor, type TuiPresentationProfile } from "../terminal-profile.js";

export type TerminalColorRole = keyof TuiPresentationProfile["design"]["colors"];

export const ASCII_BORDER_CHARS = {
  topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+",
  horizontal: "-", vertical: "|", topT: "+", bottomT: "+",
  leftT: "+", rightT: "+", cross: "+",
} as const;

export interface TuiTheme {
  profile: TuiPresentationProfile;
  /** Surface from the profile, before `colorMode: none` falls back to the terminal default. */
  configuredSurfaceColor: string | undefined;
  surfaceColor: ColorInput | undefined;
  sidebarSurfaceColor: ColorInput;
  customBorderChars: typeof ASCII_BORDER_CHARS | undefined;
  textColor: ColorInput | undefined;
  mutedColor: ColorInput | undefined;
  accentColor: ColorInput | undefined;
  borderColor: ColorInput | undefined;
}

export function openTuiColor(profile: TuiPresentationProfile, role: TerminalColorRole): ColorInput | undefined {
  if (profile.design.colorMode === "none") return RGBA.defaultForeground();
  const token = profile.design.colors[role];
  if (!token) return undefined;
  if (profile.design.colorMode === "truecolor") return token.truecolor;
  const index = profile.design.colorMode === "ansi256" ? token.ansi256 : token.ansi16;
  return index === undefined ? undefined : RGBA.fromIndex(index);
}

export function markdownSyntaxStyle(profile: TuiPresentationProfile): SyntaxStyle {
  const style = (role: TerminalColorRole, attributes: Record<string, boolean> = {}) => {
    const fg = openTuiColor(profile, role);
    return { ...(fg ? { fg } : {}), ...attributes };
  };
  // Hierarchy comes from weight, not hue: only the top heading is accented,
  // so warning and danger colours keep their meaning.
  const heading = style("text", { bold: true });
  return SyntaxStyle.fromStyles({
    default: style("text"),
    "markup.heading": heading,
    "markup.heading.1": style("accent", { bold: true }),
    "markup.heading.2": heading,
    "markup.heading.3": heading,
    "markup.heading.4": style("mutedText", { bold: true }),
    "markup.heading.5": style("mutedText", { bold: true }),
    "markup.heading.6": style("mutedText", { bold: true }),
    "markup.strong": style("text", { bold: true }),
    "markup.italic": style("text", { italic: true }),
    "markup.strikethrough": style("mutedText", { dim: true }),
    "markup.raw": style("info"),
    "markup.raw.block": style("info"),
    "markup.link": style("info", { underline: true }),
    "markup.link.label": style("info", { underline: true }),
    "markup.link.url": style("mutedText", { underline: true }),
    "markup.list": style("accent"),
    "markup.list.checked": style("success", { bold: true }),
    "markup.list.unchecked": style("mutedText"),
    "markup.quote": style("mutedText", { italic: true }),
    label: style("mutedText"),
    "punctuation.special": style("mutedText"),
  });
}

export function createTuiTheme(profile: TuiPresentationProfile): TuiTheme {
  const configuredSurfaceColor = terminalSurfaceColor(profile);
  const surfaceColor: ColorInput | undefined = profile.design.colorMode === "none"
    ? RGBA.defaultBackground()
    : configuredSurfaceColor;
  const mutedColor = openTuiColor(profile, "mutedText");
  return {
    profile,
    configuredSurfaceColor,
    surfaceColor,
    sidebarSurfaceColor: surfaceColor ?? RGBA.defaultBackground(),
    customBorderChars: profile.design.glyphMode === "ascii" ? ASCII_BORDER_CHARS : undefined,
    textColor: openTuiColor(profile, "text"),
    mutedColor,
    accentColor: openTuiColor(profile, "accent"),
    borderColor: mutedColor,
  };
}
