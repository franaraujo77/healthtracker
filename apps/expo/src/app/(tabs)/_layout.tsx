import { Tabs } from "expo-router";

import {
  ACCESS_LOG_TAB_LABEL_PT_BR,
  COMPARTILHAR_TAB_LABEL_PT_BR,
  HISTORICO_TAB_LABEL_PT_BR,
} from "@healthtracker/validators";

// SafeAreaView/Tabs native props can't read Tamagui tokens. These mirror
// colorTokens.primaryTeal.light and colorTokens.backgroundPrimary.light.
const ACTIVE_TINT = "#0D6E6E";
const INACTIVE_TINT = "#737373";
const TAB_BAR_BG = "#F9F7F4";

// Tabs root for the post-onboarding patient experience (Story 1.2 AC5).
// Início ships in Epic 1; Configurações lands here in Story 1.4.
// Story 2.5 — Histórico joins between Início and Configurações.
// R1-P169 — current tab order: Início / Histórico / Configurações.
// Fingerprint joins in Epic 3.
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
      <Tabs.Screen
        name="historico"
        options={{ title: HISTORICO_TAB_LABEL_PT_BR }}
      />
      <Tabs.Screen
        name="compartilhar"
        options={{ title: COMPARTILHAR_TAB_LABEL_PT_BR }}
      />
      {/* Story 5.3 — Acessos as 4th tab per UX-DR11. */}
      <Tabs.Screen
        name="acessos"
        options={{ title: ACCESS_LOG_TAB_LABEL_PT_BR }}
      />
      <Tabs.Screen name="configuracoes" options={{ title: "Configurações" }} />
    </Tabs>
  );
}
