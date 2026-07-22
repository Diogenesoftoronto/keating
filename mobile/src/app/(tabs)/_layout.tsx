import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { StyleSheet, type ColorValue } from "react-native";
import { colors, type } from "@/constants/theme";
import { useGT } from "gt-react-native";

function TabGlyph({ name, color }: { name: React.ComponentProps<typeof Ionicons>["name"]; color: ColorValue }) {
  return <Ionicons name={name} color={color} size={21} />;
}

export default function TabLayout() {
  const gt = useGT();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarHideOnKeyboard: true,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: gt("Tutor"), tabBarIcon: ({ color }) => <TabGlyph name="sparkles-outline" color={color} /> }}
      />
      <Tabs.Screen
        name="sessions"
        options={{ title: gt("Sessions"), tabBarIcon: ({ color }) => <TabGlyph name="chatbubbles-outline" color={color} /> }}
      />
      <Tabs.Screen
        name="artifacts"
        options={{ title: gt("Library"), tabBarIcon: ({ color }) => <TabGlyph name="library-outline" color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: gt("Settings"), tabBarIcon: ({ color }) => <TabGlyph name="settings-outline" color={color} /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 68,
    paddingTop: 7,
    paddingBottom: 8,
    backgroundColor: colors.backgroundDeep,
    borderTopColor: colors.border,
  },
  tabLabel: { ...type.caption, fontWeight: "600" },
});
