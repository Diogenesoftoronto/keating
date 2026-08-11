import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { Image, StyleSheet, type ColorValue } from "react-native";
import { useKeatingTheme } from "@/constants/theme";
import { KeatingGTProvider } from "@/i18n/general-translation";
import { useGT } from "gt-react-native";

function TabGlyph({ name, color }: { name: React.ComponentProps<typeof Ionicons>["name"]; color: ColorValue }) {
  return <Ionicons name={name} color={color} size={21} />;
}

function TutorTabIcon({ focused }: { focused: boolean }) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={require("../../../assets/brand/mascot-head-v2.png")}
      style={[styles.tutorTabIcon, !focused && styles.tutorTabIconInactive]}
      resizeMode="contain"
    />
  );
}

function TranslatedTabs() {
  const gt = useGT();
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryText,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarHideOnKeyboard: true,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: gt("Tutor"), tabBarIcon: ({ focused }) => <TutorTabIcon focused={focused} /> }}
      />
      <Tabs.Screen
        name="sessions"
        options={{ title: gt("Sessions"), tabBarIcon: ({ color }) => <TabGlyph name="chatbubbles-outline" color={color} /> }}
      />
      <Tabs.Screen
        name="courses"
        options={{ title: gt("Courses"), tabBarIcon: ({ color }) => <TabGlyph name="school-outline" color={color} /> }}
      />
      {/*
        Live is reached from the composer inside a lesson, not from the tab
        bar — starting a voice session only makes sense against the
        conversation you are already in.
      */}
      <Tabs.Screen
        name="live"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="artifacts"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="settings"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: gt("More"), tabBarIcon: ({ color }) => <TabGlyph name="menu-outline" color={color} /> }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <KeatingGTProvider>
      <TranslatedTabs />
    </KeatingGTProvider>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
  tabBar: {
    height: 68,
    paddingTop: 7,
    paddingBottom: 8,
    backgroundColor: colors.backgroundDeep,
    borderTopColor: colors.border,
  },
  tabLabel: { ...type.caption, fontWeight: "600" },
  });
}

const styles = StyleSheet.create({
  tutorTabIcon: { width: 28, height: 28 },
  tutorTabIconInactive: { opacity: 0.58 },
});
