import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { openProductLink } from "@/lib/open-product-link";
import { PRODUCT_LINKS } from "@/lib/product-links";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export default function MoreScreen() {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const { colors } = theme;
  const router = useRouter();

  return (
    <Screen title="More" subtitle="Library, account, help, and app controls">
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Learning</Text>
        <MenuRow icon="today-outline" label="Learn & Coming Up" detail="Goals, due reviews, practice, and learner evidence" color={colors.primaryText} onPress={() => router.push("/learn" as never)} styles={styles} />
        <MenuRow icon="analytics-outline" label="Usage & study activity" detail="Lessons, topics, attachments, feedback, and model tokens" color={colors.primaryText} onPress={() => router.push("/usage" as never)} styles={styles} />
        <MenuRow icon="library-outline" label="Library" detail="Saved notes, plans, maps, and quizzes" color={colors.textMuted} onPress={() => router.push("/artifacts")} styles={styles} />
        <MenuRow icon="school-outline" label="Tutorial" detail="Set up Keating and begin a lesson" color={colors.textMuted} onPress={() => void openProductLink("tutorial", PRODUCT_LINKS.tutorial)} styles={styles} />
        <MenuRow icon="book-outline" label="Manual" detail="Commands, workflows, and technical reference" color={colors.textMuted} onPress={() => void openProductLink("manual", PRODUCT_LINKS.manual)} styles={styles} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <MenuRow icon="wallet-outline" label="Buy tokens / credits" detail="Open account checkout and wallet options" color={colors.primaryText} onPress={() => void openProductLink("token checkout", PRODUCT_LINKS.credits)} styles={styles} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App</Text>
        <MenuRow icon="settings-outline" label="Settings" detail="Models, keys, teaching style, and local data" color={colors.textMuted} onPress={() => router.push("/settings")} styles={styles} />
      </View>
    </Screen>
  );
}

function MenuRow({
  icon,
  label,
  detail,
  color,
  onPress,
  styles,
}: {
  icon: IconName;
  label: string;
  detail: string;
  color: ColorValue;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Ionicons name={icon} size={22} color={color} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={color} />
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    section: { marginBottom: spacing.xl },
    sectionTitle: { ...type.label, marginBottom: spacing.sm, color: colors.textMuted },
    row: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      borderRadius: radii.sm,
    },
    rowPressed: { backgroundColor: colors.surfacePressed },
    rowCopy: { flex: 1, minWidth: 0 },
    rowLabel: { ...type.label, color: colors.text },
    rowDetail: { ...type.caption, marginTop: 2, color: colors.textMuted },
  });
}
