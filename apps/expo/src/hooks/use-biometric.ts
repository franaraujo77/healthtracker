import { useCallback, useEffect, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import {
  BIOMETRIC_CANCEL_PT_BR,
  BIOMETRIC_ENROLL_PROMPT_PT_BR,
  BIOMETRIC_UNLOCK_PROMPT_PT_BR,
} from "@healthtracker/validators";

/**
 * Story 1.3 — biometric authentication hook.
 *
 * Single seam between `expo-local-authentication` / `expo-secure-store`
 * and the screens that use them (`onboarding/biometric.tsx`,
 * `(auth)/biometric.tsx`). The hook keeps the native-module surface out
 * of the screens so the offer + lock screens stay focused on UX.
 *
 * Architecture note: the biometric preference is NEVER stored in the
 * Supabase DB (AC1 + architecture.md line 430). SecureStore is the
 * source of truth, and biometric only gates entry into the local app —
 * Supabase Auth still manages the server-side session.
 */

// Namespaced so it cannot collide with Supabase Auth's `sb-*` SecureStore
// keys that the `secureStoreAdapter` in `apps/expo/src/lib/supabase.ts`
// also writes to the same keychain.
export const BIOMETRIC_ENABLED_KEY = "healthtracker.biometric.enabled";
// Exported so the cold-launch gate in `apps/expo/src/app/_layout.tsx`
// reads the same constant as the hook — a future bump (e.g. "2" for a
// schema migration) only needs to change one place (P9).
export const BIOMETRIC_ENABLED_VALUE = "1";

/**
 * Persistent-across-remount three-fail counter (P1). Module-scope `let`
 * so it survives the lock screen's unmount/remount cycle (e.g. backgrounding
 * the app, navigating away briefly) but resets on app kill — matching the
 * "in-memory, not SecureStore-persistent" intent of Clarification #3.
 * SecureStore-persistence is the next step if the threat model later
 * requires brute-force resistance across kill-and-reopen.
 */
let failedAttempts = 0;

export function getBiometricFailedAttempts(): number {
  return failedAttempts;
}

export function incrementBiometricFailedAttempts(): number {
  failedAttempts += 1;
  return failedAttempts;
}

export function resetBiometricFailedAttempts(): void {
  failedAttempts = 0;
}

export type BiometricCapability = "idle" | "unavailable" | "available";

export type BiometricEnableResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "unavailable" | "failed" };

export type BiometricPromptResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "failed" | "unavailable" };

interface UseBiometricApi {
  capability: BiometricCapability;
  /** `null` while the SecureStore read is in flight; resolved boolean after. */
  isEnabled: boolean | null;
  enable: () => Promise<BiometricEnableResult>;
  prompt: () => Promise<BiometricPromptResult>;
  disable: () => Promise<void>;
}

// `expo-local-authentication` returns an `error` string discriminant on
// failure. We branch on the code, never the localized message (Story 1.1
// pattern P1 — substring matching breaks across locales).
//
// `system_cancel` is the iOS code emitted when the OS itself dismisses
// the prompt (e.g. an incoming call). It is NOT the same as `lockout`
// (review finding P2): iOS emits `lockout` / `lockout_permanent` after
// the OS-level biometric retry budget is exhausted — those MUST count
// as failed attempts so a stolen-phone attacker cannot brute-force
// without ever tripping our three-strike counter.
const CANCEL_ERROR_CODES = new Set([
  "user_cancel",
  "user_fallback",
  "system_cancel",
  "app_cancel",
]);

const HARD_FAIL_ERROR_CODES = new Set(["lockout", "lockout_permanent"]);

// Round-2 P18: codes that mean "biometric is not (currently) usable" —
// distinct from a failed match. If a patient previously enrolled and
// the OS-level biometric is later removed (fingerprint deleted, Face ID
// reset), `authenticateAsync` returns one of these instead of `success`.
// They MUST NOT count against the three-strike counter — the patient
// did not fail; the device is no longer set up for biometric. The
// consumer (lock screen) routes these to the registration fallback
// without spending strikes.
const UNAVAILABLE_ERROR_CODES = new Set([
  "not_available",
  "not_enrolled",
  "passcode_not_set",
]);

export function useBiometric(): UseBiometricApi {
  const [capability, setCapability] = useState<BiometricCapability>("idle");
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);

  // Probe device capability + read the stored preference on mount.
  // No cancellation guard: React 18+ no longer warns on setState
  // after unmount, and both probes resolve in tens of milliseconds —
  // the race is theoretical and the screens that consume this hook
  // are one-shots (offer + lock), so a stale setState doesn't leak.
  useEffect(() => {
    void (async () => {
      try {
        const [hasHardware, isEnrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        setCapability(hasHardware && isEnrolled ? "available" : "unavailable");
      } catch {
        setCapability("unavailable");
      }

      try {
        const stored = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        setIsEnabled(stored === BIOMETRIC_ENABLED_VALUE);
      } catch {
        setIsEnabled(false);
      }
    })();
  }, []);

  const enable = useCallback(async (): Promise<BiometricEnableResult> => {
    try {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!(hasHardware && isEnrolled)) {
        return { ok: false, reason: "unavailable" };
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: BIOMETRIC_ENROLL_PROMPT_PT_BR,
        cancelLabel: BIOMETRIC_CANCEL_PT_BR,
        // iOS users with a failed Face ID get the native passcode
        // fallback, which still returns `success: true` — desirable
        // for AC1 (the patient successfully proves device ownership).
        disableDeviceFallback: false,
      });

      if (result.success) {
        await SecureStore.setItemAsync(
          BIOMETRIC_ENABLED_KEY,
          BIOMETRIC_ENABLED_VALUE,
        );
        setIsEnabled(true);
        return { ok: true };
      }

      const code = "error" in result ? result.error : undefined;
      if (code && HARD_FAIL_ERROR_CODES.has(code)) {
        return { ok: false, reason: "failed" };
      }
      // Round-3 P22 — symmetry with `prompt()`: a mid-enrollment OS-level
      // state change (biometric not enrolled, passcode not set) is not
      // a "failed" attempt; surface as `unavailable` so the offer screen
      // can route the same way as the `capability === 'unavailable'`
      // branch instead of showing a generic error.
      if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
        return { ok: false, reason: "unavailable" };
      }
      if (code && CANCEL_ERROR_CODES.has(code)) {
        return { ok: false, reason: "cancelled" };
      }
      return { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }, []);

  const prompt = useCallback(async (): Promise<BiometricPromptResult> => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: BIOMETRIC_UNLOCK_PROMPT_PT_BR,
        cancelLabel: BIOMETRIC_CANCEL_PT_BR,
        disableDeviceFallback: false,
      });
      if (result.success) return { ok: true };
      const code = "error" in result ? result.error : undefined;
      // iOS lockout codes are hard failures, NOT cancellations — they
      // must count against the three-strike counter (P2).
      if (code && HARD_FAIL_ERROR_CODES.has(code)) {
        return { ok: false, reason: "failed" };
      }
      // Round-2 P18: biometric removed at the OS level after enroll →
      // not a failed attempt, not a cancellation. Surface as a distinct
      // `unavailable` so the lock screen routes to the register fallback
      // without spending strikes.
      if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
        return { ok: false, reason: "unavailable" };
      }
      if (code && CANCEL_ERROR_CODES.has(code)) {
        return { ok: false, reason: "cancelled" };
      }
      return { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    } finally {
      setIsEnabled(false);
    }
  }, []);

  return { capability, isEnabled, enable, prompt, disable };
}
