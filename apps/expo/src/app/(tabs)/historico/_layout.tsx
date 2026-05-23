import { Stack } from "expo-router";

/**
 * Story 3.1 — Histórico tab segment. Hosts:
 *   - `index.tsx` (the Histórico screen with Resultados/Envios subtabs)
 *   - `[collectedAt].tsx` (Story 3.1 draw detail; Story 4.3 will wire
 *     a real detail sheet for individual biomarker history)
 *
 * Headers off — each screen renders its own SafeAreaView header.
 */
export default function HistoricoLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
