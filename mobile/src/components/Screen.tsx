import type { PropsWithChildren, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, type } from "@/constants/theme";

interface ScreenProps extends PropsWithChildren {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  scroll?: boolean;
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
}

export function Screen({
  children,
  title,
  subtitle,
  action,
  scroll = true,
  contentContainerStyle,
}: ScreenProps) {
  const content = (
    <View style={[styles.content, contentContainerStyle]}>
      {(title || action) && (
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {action}
        </View>
      )}
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  content: {
    width: "100%",
    maxWidth: 760,
    flex: 1,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.body, marginTop: spacing.xs, color: colors.textMuted },
});
