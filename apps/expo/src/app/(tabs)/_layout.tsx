import { Tabs } from "expo-router";

// SafeAreaView/Tabs native props can't read Tamagui tokens. These mirror
// colorTokens.primaryTeal.light and colorTokens.backgroundPrimary.light.
const ACTIVE_TINT = "#0D6E6E";
const INACTIVE_TINT = "#737373";
const TAB_BAR_BG = "#F9F7F4";

// Tabs root for the post-onboarding patient experience (Story 1.2 AC5).
// Only Início ships in Epic 1; Fingerprint / Settings join in later epics.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_TINT,
        tabBarInactiveTintColor: INACTIVE_TINT,
        tabBarStyle: { backgroundColor: TAB_BAR_BG },
      }}
    >
      <Tabs.Screen name="inicio" options={{ title: "Início" }} />
    </Tabs>
  );
}
