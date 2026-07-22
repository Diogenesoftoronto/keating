import type { TextStyle, ViewStyle } from "react-native";

export const colors = {
  background: "#0c1510",
  backgroundDeep: "#08100b",
  surface: "#11201a",
  surfaceRaised: "#17291f",
  surfacePressed: "#20382a",
  text: "#dcefe0",
  textMuted: "#9dbfa8",
  textFaint: "#71907a",
  primary: "#4be388",
  primaryStrong: "#1e9b50",
  primaryInk: "#07150c",
  border: "#294235",
  borderStrong: "#3d624b",
  error: "#ff8b82",
  errorSurface: "#321a18",
  warning: "#e8a33d",
  success: "#4be388",
  userBubble: "#1b4d31",
  overlay: "rgba(3, 9, 5, 0.72)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700" } satisfies TextStyle,
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "700" } satisfies TextStyle,
  body: { fontSize: 16, lineHeight: 24 } satisfies TextStyle,
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" } satisfies TextStyle,
  caption: { fontSize: 12, lineHeight: 17 } satisfies TextStyle,
  mono: { fontFamily: "monospace" } satisfies TextStyle,
} as const;

export const hairline: ViewStyle = {
  borderColor: colors.border,
  borderWidth: 1,
};
