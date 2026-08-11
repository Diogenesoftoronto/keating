import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { openProductLink } from "@/lib/open-product-link";
import { PRODUCT_LINKS } from "@/lib/product-links";

export default function LiveScreen() {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const { colors } = theme;
  return (
    <Screen title="Live" subtitle="Talk to Keating and show what you are working on">
      <View style={styles.hero}>
        <Image
          accessible={false}
          accessibilityIgnoresInvertColors
          source={require("../../../assets/brand/mascot-head-v2.png")}
          style={styles.mascot}
          resizeMode="contain"
        />
        <Text style={styles.heading}>Live with Keating</Text>
        <Text style={styles.body}>Voice, camera, and screen sessions must share the same conversation as Tutor.</Text>
      </View>

      <View style={styles.status} accessibilityRole="alert">
        <Ionicons name="information-circle-outline" size={22} color={colors.textMuted} />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>Native Live is not available in this build</Text>
          <Text style={styles.statusBody}>
            Web Live starts a separate browser conversation and uses browser-side account or key setup, not this app's Android key or current Tutor session. Voice, camera, and model-dependent screen sharing are available there. Native permissions, transport, and transcript continuity remain required before mobile reaches feature parity.
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button onPress={() => void openProductLink("Keating Live", PRODUCT_LINKS.live)}>Open Live on web</Button>
      </View>
    </Screen>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    hero: { alignItems: "center", paddingVertical: spacing.lg },
    mascot: { width: 112, height: 112 },
    heading: { ...type.heading, marginTop: spacing.lg, color: colors.text },
    body: { ...type.body, maxWidth: 500, marginTop: spacing.sm, color: colors.textMuted, textAlign: "center" },
    status: {
      flexDirection: "row",
      gap: spacing.md,
      marginVertical: spacing.xl,
      paddingVertical: spacing.lg,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    statusCopy: { flex: 1, minWidth: 0 },
    statusTitle: { ...type.label, color: colors.text },
    statusBody: { ...type.body, marginTop: spacing.xs, color: colors.textMuted },
    actions: { gap: spacing.md },
  });
}
