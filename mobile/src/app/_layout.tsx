import "react-native-gesture-handler";

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono/700Bold";
import { Roboto_400Regular } from "@expo-google-fonts/roboto/400Regular";
import { Roboto_700Bold } from "@expo-google-fonts/roboto/700Bold";
import { SpaceMono_400Regular } from "@expo-google-fonts/space-mono/400Regular";
import { SpaceMono_700Bold } from "@expo-google-fonts/space-mono/700Bold";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeatingThemeProvider, spacing, useKeatingTheme } from "@/constants/theme";
import { KeatingProvider, useKeating } from "@/state/KeatingProvider";
import { UiSettingsProvider, useUiSettings } from "@/state/UiSettingsProvider";

void SplashScreen.preventAutoHideAsync();

function AppNavigator() {
  const { hydrated } = useKeating();
  const theme = useKeatingTheme();
  const { loaded: settingsLoaded } = useUiSettings();
  const [fontsLoaded] = useFonts({
    SpaceMono: SpaceMono_400Regular,
    SpaceMonoBold: SpaceMono_700Bold,
    JetBrainsMono: JetBrainsMono_400Regular,
    JetBrainsMonoBold: JetBrainsMono_700Bold,
    Roboto: Roboto_400Regular,
    RobotoBold: Roboto_700Bold,
  });
  const ready = hydrated && fontsLoaded && settingsLoaded;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <Image accessibilityLabel="Keating" source={require("../../assets/brand/logo-lockup.png")} style={styles.lockup} resizeMode="contain" />
        <ActivityIndicator color={theme.colors.primaryText} size="small" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme.statusBarStyle} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <UiSettingsProvider>
          <KeatingThemeProvider>
            <KeatingProvider>
              <AppNavigator />
            </KeatingProvider>
          </KeatingThemeProvider>
        </UiSettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    backgroundColor: "transparent",
  },
  lockup: { width: 176, height: 56 },
});
