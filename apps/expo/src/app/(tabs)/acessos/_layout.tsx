import { Stack } from "expo-router";

import { ACCESS_LOG_TITLE_PT_BR } from "@healthtracker/validators";

/**
 * Story 5.3 — Acessos tab stack. Same shape as the Compartilhar
 * layout; the tab bar stays visible (UX-DR11).
 */
export default function AcessosLayout(): React.ReactNode {
  return (
    <Stack screenOptions={{ headerTitle: ACCESS_LOG_TITLE_PT_BR }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
