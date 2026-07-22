import "react-native-gesture-handler";

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors, spacing, type } from "@/constants/theme";
import { KeatingGTProvider } from "@/i18n/general-translation";
import { KeatingProvider, useKeating } from "@/state/KeatingProvider";

void SplashScreen.preventAutoHideAsync();

function AppNavigator() {
  const { hydrated } = useKeating();

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <Text style={styles.wordmark}>KEATING</Text>
        <ActivityIndicator color={colors.primary} size="small" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeatingGTProvider>
          <KeatingProvider>
            <AppNavigator />
          </KeatingProvider>
        </KeatingGTProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    backgroundColor: colors.background,
  },
  wordmark: { ...type.mono, color: colors.primary, fontSize: 24, fontWeight: "800", letterSpacing: 2 },
});
