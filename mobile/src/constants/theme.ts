import { keatingDesignContract } from "@keating/design-contract";
import { createContext, createElement, type PropsWithChildren, useContext, useMemo } from "react";
import { useColorScheme, type TextStyle, type ViewStyle } from "react-native";
import { resolveThemeName, type UiFontFamily } from "@/lib/ui-settings";
import { useUiSettings } from "@/state/UiSettingsProvider";
import { projectNativeTheme, type NativeTheme } from "./theme-contract";

export { projectNativeTheme } from "./theme-contract";
export type { NativeTheme, NativeThemeName } from "./theme-contract";

export const spacing = {
  ...keatingDesignContract.native.spacingDp,
  xxl: keatingDesignContract.native.spacingDp.xl + keatingDesignContract.native.spacingDp.sm,
} as const;
export const radii = {
  sm: keatingDesignContract.native.radiiDp.control,
  md: keatingDesignContract.native.radiiDp.panel,
  lg: keatingDesignContract.native.radiiDp.panel,
  pill: keatingDesignContract.native.radiiDp.pill,
} as const;

export interface KeatingTypography {
  readonly title: TextStyle;
  readonly heading: TextStyle;
  readonly body: TextStyle;
  readonly label: TextStyle;
  readonly caption: TextStyle;
  /** Spread *after* a scale entry to switch that text to the monospace face. */
  readonly mono: TextStyle;
  /** Bold monospace face for terminal-style labels and badges. */
  readonly monoBold: TextStyle;
}

/**
 * The loaded font names registered in `_layout.tsx`. `undefined` means "leave
 * it to the platform", which is how the app rendered before the setting
 * existed. Roboto is a proportional face, so it keeps Space Mono for the
 * terminal-style accents — the same split the web build uses.
 */
const UI_FONT_FACE: Record<UiFontFamily, string | undefined> = {
  system: undefined,
  "space-mono": "SpaceMono",
  "jetbrains-mono": "JetBrainsMono",
  roboto: "Roboto",
};

const UI_FONT_BOLD_FACE: Record<UiFontFamily, string | undefined> = {
  system: undefined,
  "space-mono": "SpaceMonoBold",
  "jetbrains-mono": "JetBrainsMonoBold",
  roboto: "RobotoBold",
};

const MONO_FONT_FACE: Record<UiFontFamily, string> = {
  system: "SpaceMono",
  "space-mono": "SpaceMono",
  "jetbrains-mono": "JetBrainsMono",
  roboto: "SpaceMono",
};

const MONO_FONT_BOLD_FACE: Record<UiFontFamily, string> = {
  system: "SpaceMonoBold",
  "space-mono": "SpaceMonoBold",
  "jetbrains-mono": "JetBrainsMonoBold",
  roboto: "SpaceMonoBold",
};

export function createTypography(fontFamily: UiFontFamily): KeatingTypography {
  const ui = UI_FONT_FACE[fontFamily];
  const face: TextStyle = ui ? { fontFamily: ui } : {};
  const boldUi = UI_FONT_BOLD_FACE[fontFamily];
  const boldFace: TextStyle = boldUi ? { fontFamily: boldUi } : { fontWeight: "700" };
  return {
    title: { fontSize: 24, lineHeight: 30, ...boldFace },
    heading: { fontSize: 18, lineHeight: 24, ...boldFace },
    body: { fontSize: 16, lineHeight: 24, ...face },
    label: { fontSize: 14, lineHeight: 20, ...boldFace },
    caption: { fontSize: 12, lineHeight: 17, ...face },
    mono: { fontFamily: MONO_FONT_FACE[fontFamily] },
    monoBold: { fontFamily: MONO_FONT_BOLD_FACE[fontFamily] },
  };
}

export interface KeatingTheme extends NativeTheme {
  readonly type: KeatingTypography;
}

/**
 * Static scale kept for the isolated repository smoke screen, which renders
 * outside the providers.
 */
export const type = createTypography("jetbrains-mono");

const ThemeContext = createContext<KeatingTheme | null>(null);

export function KeatingThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const { settings } = useUiSettings();
  const theme = useMemo<KeatingTheme>(() => ({
    ...projectNativeTheme(resolveThemeName(settings.theme, systemScheme)),
    type: createTypography(settings.fontFamily),
  }), [settings.theme, settings.fontFamily, systemScheme]);
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useKeatingTheme(): KeatingTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useKeatingTheme must be used within KeatingThemeProvider.");
  return theme;
}

/** Dark fallback retained only for the isolated repository smoke screen. */
export const colors = projectNativeTheme("dark").colors;
export const hairline: ViewStyle = { borderColor: colors.border, borderWidth: 1 };
