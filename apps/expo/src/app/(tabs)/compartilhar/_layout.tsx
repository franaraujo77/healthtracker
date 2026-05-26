import { Stack } from "expo-router";

import { COMPARTILHAR_TITLE_PT_BR } from "@healthtracker/validators";

/**
 * Story 5.1 — Compartilhar tab stack. Per UX-DR11 the tab bar
 * remains visible during the sharing ceremony — do NOT set
 * `tabBarStyle: { display: 'none' }` on any screen here.
 */
export default function CompartilharLayout(): React.ReactNode {
  return (
    <Stack screenOptions={{ headerTitle: COMPARTILHAR_TITLE_PT_BR }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="novo/identificacao" />
      <Stack.Screen name="novo/duracao" />
      <Stack.Screen name="[shareTokenId]/biomarcadores" />
      <Stack.Screen name="[shareTokenId]/concluido" />
    </Stack>
  );
}
