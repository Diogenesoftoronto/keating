import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { colors, radii, spacing, type } from "@/constants/theme";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.container}>
      <Text style={styles.mark} accessibilityElementsHidden>✦</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  mark: { ...type.mono, color: colors.primary, fontSize: 32, marginBottom: spacing.md },
  title: { ...type.heading, color: colors.text, textAlign: "center" },
  body: { ...type.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, maxWidth: 420 },
  action: { marginTop: spacing.xl, minWidth: 160 },
});
