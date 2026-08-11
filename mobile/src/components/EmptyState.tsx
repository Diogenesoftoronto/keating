import { Image, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  const styles = createStyles(useKeatingTheme());
  return (
    <View style={styles.container}>
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel="Keating"
        source={require("../../assets/brand/logo-lockup.png")}
        style={styles.mark}
        resizeMode="contain"
      />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: 40,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mark: { width: 132, height: 44, marginBottom: spacing.md },
  title: { ...type.heading, color: colors.text, textAlign: "center" },
  body: { ...type.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, maxWidth: 420 },
  action: { marginTop: spacing.xl, minWidth: 160 },
  });
}
