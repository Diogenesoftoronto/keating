import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { useKeatingTheme } from "@/constants/theme";
import { NOTORGANIC_MOBILE_REDIRECT_URI } from "@/lib/notorganic-account/contracts";
import { useNotOrganicAccount } from "@/state/NotOrganicAccountProvider";

export default function NotOrganicCallbackScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const router = useRouter();
  const theme = useKeatingTheme();
  const { completeLogin, error } = useNotOrganicAccount();
  const callbackUrl = useMemo(() => {
    const url = new URL(NOTORGANIC_MOBILE_REDIRECT_URI);
    for (const [key, raw] of Object.entries(params)) {
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }, [params]);

  useEffect(() => {
    void completeLogin(callbackUrl).then(() => router.replace("/account" as never)).catch(() => undefined);
  }, [callbackUrl, completeLogin, router]);

  return (
    <Screen title="Completing sign-in" subtitle="Returning securely from Not Organic">
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.primaryText} />
        {error ? <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ center: { alignItems: "center", gap: 16, paddingTop: 48 }, error: { textAlign: "center" } });
