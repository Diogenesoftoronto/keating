import type { PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { colors, radii, spacing, type } from "@/constants/theme";

interface ButtonProps extends PropsWithChildren {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  compact?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function Button({
  children,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  compact = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.compact : styles.regular,
        styles[variant],
        pressed && !inactive ? styles[`${variant}Pressed`] : null,
        inactive ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "primary" ? colors.primaryInk : colors.text} />
      ) : (
        <Text style={[styles.label, variant === "primary" ? styles.primaryLabel : styles.defaultLabel]}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  regular: { paddingHorizontal: spacing.lg, paddingVertical: 10 },
  compact: { minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  label: { ...type.label, textAlign: "center" },
  primaryLabel: { color: colors.primaryInk },
  defaultLabel: { color: colors.text },
  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryStrong },
  secondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong },
  secondaryPressed: { backgroundColor: colors.surfacePressed },
  quiet: { backgroundColor: "transparent" },
  quietPressed: { backgroundColor: colors.surfacePressed },
  danger: { backgroundColor: colors.errorSurface, borderWidth: 1, borderColor: "#63322e" },
  dangerPressed: { backgroundColor: "#45211e" },
  disabled: { opacity: 0.48 },
});
