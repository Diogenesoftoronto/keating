import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { useNotOrganicAccount } from "@/state/NotOrganicAccountProvider";

export default function AccountScreen() {
  const router = useRouter();
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const { status, session, account, error, login, logout, refresh } = useNotOrganicAccount();
  const signedIn = status === "signed-in";
  const identity = account?.handle ?? account?.display_name ?? account?.did ?? account?.id ?? session?.accountId;

  return (
    <Screen
      title="Not Organic account"
      subtitle="One account for hosted inference and shared learning evolution"
      action={<Button compact variant="quiet" onPress={() => router.back()}>Done</Button>}
    >
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View style={[styles.icon, signedIn && styles.iconActive]}>
            <Ionicons name={signedIn ? "checkmark" : "person-outline"} size={22} color={signedIn ? theme.colors.primaryInk : theme.colors.textMuted} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.heading}>{signedIn ? "Signed in" : status === "authorizing" ? "Signing in…" : "Not signed in"}</Text>
            <Text style={styles.detail}>{identity ? String(identity) : "Connect mobile to the same Not Organic account you use in the browser."}</Text>
          </View>
        </View>
        {session ? <Text style={styles.scope}>Access: {session.scope.split(" ").join(" · ")}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {signedIn ? (
          <View style={styles.actions}>
            <Button variant="secondary" onPress={() => void refresh()}>Refresh account</Button>
            <Button variant="danger" onPress={() => void logout()}>Sign out</Button>
          </View>
        ) : (
          <Button loading={status === "authorizing" || status === "loading"} onPress={() => void login()}>Sign in with Not Organic</Button>
        )}
      </View>

      <View style={styles.note}>
        <Text style={styles.noteTitle}>What connects</Text>
        <Text style={styles.noteBody}>Your wallet, hosted model access, account sync key, and future prompt/MAP-Elites evolution records use this account. The signing key stays on this device.</Text>
      </View>
    </Screen>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    card: { gap: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
    statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfacePressed },
    iconActive: { backgroundColor: colors.primary },
    copy: { flex: 1, minWidth: 0 },
    heading: { ...type.heading, color: colors.text },
    detail: { ...type.body, marginTop: spacing.xs, color: colors.textMuted },
    scope: { ...type.caption, ...type.mono, color: colors.textMuted },
    error: { ...type.body, color: colors.error },
    actions: { gap: spacing.sm },
    note: { marginTop: spacing.xl, gap: spacing.sm },
    noteTitle: { ...type.label, color: colors.text },
    noteBody: { ...type.body, color: colors.textMuted },
  });
}
