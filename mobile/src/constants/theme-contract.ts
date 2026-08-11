import { keatingDesignContract, type DesignThemeName } from "@keating/design-contract";

export type NativeThemeName = DesignThemeName;

export interface NativeTheme {
  readonly name: NativeThemeName;
  readonly colors: {
    readonly background: string;
    readonly backgroundDeep: string;
    readonly surface: string;
    readonly surfaceRaised: string;
    readonly surfacePressed: string;
    readonly text: string;
    readonly textMuted: string;
    readonly textFaint: string;
    readonly primary: string;
    readonly primaryStrong: string;
    readonly primaryInk: string;
    /**
     * Accent used as *text or icon on a surface*. The contract only validates
     * `accent` as a background, so light mode needs the darker `accentText`
     * role to clear 4.5:1. Identical to `primary` in dark mode.
     */
    readonly primaryText: string;
    readonly border: string;
    readonly borderStrong: string;
    readonly error: string;
    readonly errorSurface: string;
    readonly warning: string;
    readonly success: string;
    readonly info: string;
    readonly userBubble: string;
    readonly overlay: string;
  };
  readonly statusBarStyle: "light" | "dark";
}

function mixHex(background: string, foreground: string, foregroundWeight: number): string {
  const channels = (value: string) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const base = channels(background);
  const overlay = channels(foreground);
  return `#${base.map((channel, index) => Math.round(channel * (1 - foregroundWeight) + overlay[index]! * foregroundWeight)
    .toString(16)
    .padStart(2, "0")).join("")}`;
}

/** Native state roles projected from the browser- and terminal-neutral contract. */
export function projectNativeTheme(name: NativeThemeName): NativeTheme {
  const colors = keatingDesignContract.themes[name].colors;
  const selectedSurface = mixHex(colors.surfaceRaised, colors.accent, name === "dark" ? 0.12 : 0.08);
  const pressedSurface = mixHex(colors.surfaceRaised, colors.accent, name === "dark" ? 0.22 : 0.15);
  const dangerSurface = mixHex(colors.surfaceMuted, colors.danger, name === "dark" ? 0.18 : 0.1);
  return {
    name,
    colors: {
      background: colors.surface,
      backgroundDeep: colors.surfaceMuted,
      surface: colors.surfaceRaised,
      surfaceRaised: selectedSurface,
      surfacePressed: pressedSurface,
      text: colors.text,
      textMuted: colors.mutedText,
      textFaint: colors.mutedText,
      primary: colors.accent,
      primaryStrong: colors.accentText === colors.accent
        ? mixHex(colors.accent, colors.onAccent, 0.25)
        : colors.accentText,
      primaryInk: colors.onAccent,
      primaryText: colors.accentText,
      border: colors.border,
      borderStrong: colors.border,
      error: colors.danger,
      errorSurface: dangerSurface,
      warning: colors.warning,
      success: colors.success,
      info: colors.info,
      userBubble: mixHex(colors.surfaceMuted, colors.accent, name === "dark" ? 0.14 : 0.08),
      overlay: name === "dark" ? "rgba(0, 0, 0, 0.72)" : "rgba(28, 33, 27, 0.28)",
    },
    statusBarStyle: name === "dark" ? "light" : "dark",
  };
}
