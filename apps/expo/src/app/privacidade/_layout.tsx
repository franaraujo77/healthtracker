import { Stack } from "expo-router";

// Stack layout for the Privacidade subtree (Story 1.4). The
// `/privacidade` route lives OUTSIDE the `(tabs)` group, so navigating
// from the Configurações tab into this stack hides the tab bar for the
// duration of the detail flow — the standard iOS HIG "drill into detail"
// pattern. To keep the tab bar visible during the Privacidade flow,
// move this directory under `apps/expo/src/app/(tabs)/privacidade/`
// (round-2 P37 comment-correctness fix).
export default function PrivacidadeLayout() {
  return <Stack />;
}
