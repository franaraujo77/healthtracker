import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  BIOMETRIC_LOCK_BODY_PT_BR,
  BIOMETRIC_LOCK_TITLE_PT_BR,
  BIOMETRIC_UNLOCK_CTA_PT_BR,
  GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR,
  INICIO_ROUTE,
  REGISTER_ROUTE,
} from "@healthtracker/validators";

import {
  incrementBiometricFailedAttempts,
  resetBiometricFailedAttempts,
  useBiometric,
} from "~/hooks/use-biometric";
import { supabase } from "~/lib/supabase";

// SafeAreaView is native and can't read Tamagui tokens — mirror
// colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

const MAX_FAILED_ATTEMPTS = 3;

// Round-3 P23 — exhaustiveness helper. Forces a compile-time error at
// the call site if `BiometricPromptResult` ever grows a new variant
// without this file being updated. Today's variants:
//   - 'cancelled' | 'failed' | 'unavailable'
function assertNever(value: never): never {
  throw new Error(`Unhandled biometric prompt reason: ${String(value)}`);
}

/**
 * Cold-launch lock screen (AC2 + AC3). Reached when the app boots with a
 * valid Supabase session AND the SecureStore biometric preference is set
 * — see the wiring in `apps/expo/src/app/_layout.tsx`.
 *
 * Three failed attempts (cancellations don't count, per Clarification #3;
 * iOS `lockout` codes DO count, per review finding P2) clear the
 * preference, sign out, and route to REGISTER_ROUTE (Clarification #4 —
 * no dedicated sign-in screen exists yet).
 *
 * The failed-attempt counter lives in module scope inside `use-biometric.ts`
 * so backgrounding / brief unmounts don't reset it (P1).
 */
export default function BiometricLock() {
  const router = useRouter();
  const { prompt, disable } = useBiometric();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Round-2 P17 — gate the unlock button until the mount-time session
  // check resolves. Without this, a fast tap before `getSession()`
  // settles can succeed and `router.replace` to Início on a stale /
  // absent session, turning biometric into a session bypass.
  const [sessionChecked, setSessionChecked] = useState(false);

  // P5 — Verify a session actually exists on mount. Reaching the lock
  // screen without one would let biometric act as a session bypass:
  // succeed → router.replace to Início on an unauthenticated state.
  // Round-2 P19 — do NOT reset the failed-attempt counter on the
  // absent-session branch. The counter is about brute-force protection
  // for the current biometric-enabled session; a separate session-less
  // user landing here doesn't affect that budget. The counter only
  // resets on successful unlock or `fallbackToRegistration`.
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace({ pathname: REGISTER_ROUTE });
          return;
        }
        setSessionChecked(true);
      } catch {
        // Fail closed: route to register rather than expose an
        // authenticated screen behind a possibly-stale lock.
        router.replace({ pathname: REGISTER_ROUTE });
      }
    })();
  }, [router]);

  // P8 — Block the Android hardware back button. Without this the user
  // can pop the lock screen and reveal the tab navigator underneath
  // with a valid session, bypassing the gate entirely.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  async function fallbackToRegistration() {
    // P4 — `signOut()` and `disable()` must not strand the patient on
    // the lock screen if either throws. We always route to /register
    // after attempting cleanup; on the next launch the patient lands
    // in the register flow with no session and no biometric preference.
    try {
      await disable();
    } catch {
      // Best-effort cleanup; preference may persist.
    }
    try {
      await supabase.auth.signOut();
    } catch {
      // Best-effort cleanup; session may persist client-side.
    }
    resetBiometricFailedAttempts();
    router.replace({ pathname: REGISTER_ROUTE });
  }

  async function handleUnlock() {
    setError(null);
    setPending(true);
    try {
      const result = await prompt();
      if (result.ok) {
        resetBiometricFailedAttempts();
        router.replace({ pathname: INICIO_ROUTE });
        return;
      }
      // Round-3 P23 — exhaustive switch on `result.reason` so a future
      // union extension (e.g. 'rate_limited') is caught at compile time
      // rather than silently falling through to the strike-increment
      // path that used to be the default.
      switch (result.reason) {
        case "cancelled":
          // P11 — Cancellation is a user choice, not an error. Stay
          // silent (like the offer screen at onboarding/biometric.tsx)
          // and let the button re-enable.
          return;
        case "unavailable":
          // Round-2 P18 — biometric was removed at the OS level after
          // enrollment (fingerprint deleted / Face ID reset / passcode
          // no longer set). Not a failed attempt and not a cancellation;
          // route to the registration fallback without spending strikes
          // so the patient isn't punished for an OS-side state change.
          await fallbackToRegistration();
          return;
        case "failed": {
          const next = incrementBiometricFailedAttempts();
          if (next >= MAX_FAILED_ATTEMPTS) {
            await fallbackToRegistration();
            return;
          }
          setError(GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR);
          return;
        }
        default:
          assertNever(result.reason);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <YStack
        flex={1}
        padding="$4"
        gap="$4"
        backgroundColor="$backgroundPrimary"
        justifyContent="center"
      >
        <Text
          fontFamily="$body"
          fontSize="$8"
          fontWeight="700"
          color="$textPrimary"
        >
          {BIOMETRIC_LOCK_TITLE_PT_BR}
        </Text>
        <Text fontFamily="$body" fontSize="$4" color="$textSecondary">
          {BIOMETRIC_LOCK_BODY_PT_BR}
        </Text>

        {error && (
          <Text
            fontFamily="$body"
            fontSize="$3"
            color="$biomarkerDeviation"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        )}

        <Button onPress={handleUnlock} disabled={pending || !sessionChecked}>
          {BIOMETRIC_UNLOCK_CTA_PT_BR}
        </Button>
      </YStack>
    </SafeAreaView>
  );
}
