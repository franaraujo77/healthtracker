import { Stack } from "expo-router";

// The (auth) group hosts modal-like, header-less screens that are entered
// outside the normal tab navigation — currently just the biometric lock
// screen (Story 1.3). Future sign-in / password-recovery screens will
// share this layout.
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
