/**
 * Story 2.5 / F135 — Expo push-notification client hook.
 *
 * Responsibilities:
 *   1. Set the foreground notification presentation handler (banners +
 *      sounds while the app is active).
 *   2. Request notification permission and, on grant, exchange for an
 *      ExponentPushToken via `getExpoPushTokenAsync`.
 *   3. Register the token with the API via
 *      `trpc.notifications.registerPushToken` (idempotent server-side
 *      on the `(patient_id, device_id)` unique index).
 *   4. Listen for notification taps and route to `data.deepLink`.
 *   5. On `SIGNED_OUT`, call `trpc.notifications.revokePushToken` so
 *      the next sign-in registers fresh.
 *
 * **Operational prerequisites** (out of this hook's scope):
 *   - An EAS project with `extra.eas.projectId` set in `app.config.ts`.
 *     Without it `getExpoPushTokenAsync` no-ops in dev / throws on
 *     standalone builds; the hook silently logs and skips the
 *     registration call.
 *   - APNs / FCM credentials provisioned by EAS.
 *
 * Mounting: invoked once from `_layout.tsx` (root). The effect is
 * idempotent — a re-mount on hot reload will hit `registerPushToken`
 * again, which the server collapses on the UNIQUE index.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";

import { supabase } from "~/lib/supabase";
import { trpcClient } from "~/utils/api";

const DEVICE_ID_KEY = "healthtracker.push.deviceId";

/**
 * Foreground presentation: show banners and play the system sound.
 * Defaults otherwise hide notifications when the app is in the
 * foreground — bad UX for an upload-complete signal.
 */
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  // crypto.randomUUID is provided by RN's URL.createObjectURL polyfill
  // since RN 0.74; available on iOS + Android in SDK 54.
  const fresh = globalThis.crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
  return fresh;
}

function resolvePlatform(): "ios" | "android" | null {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  // Web push not in scope per Story 2.5 (F142 / UX-DR4).
  return null;
}

function getEasProjectId(): string | undefined {
  // Set via `app.config.ts` once an EAS project is provisioned.
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId;
}

async function registerWithApi(): Promise<void> {
  if (!Device.isDevice) {
    // Simulators / emulators don't receive real pushes; skip
    // registration noise.
    return;
  }
  const platform = resolvePlatform();
  if (!platform) return;

  const GRANTED = Notifications.PermissionStatus.GRANTED;
  const settings = await Notifications.getPermissionsAsync();
  let status = settings.status;
  if (status !== GRANTED) {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== GRANTED) {
    // Patient declined. The Story 2.8 preferences screen surfaces a
    // CTA to re-open OS settings; nothing else to do here.
    return;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    console.warn(
      "[push] no EAS projectId — skipping getExpoPushTokenAsync (set extra.eas.projectId in app.config.ts)",
    );
    return;
  }

  let expoToken: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    expoToken = result.data;
  } catch (err) {
    console.warn(
      "[push] getExpoPushTokenAsync failed:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const deviceId = await getOrCreateDeviceId();
  const appVersion = Constants.expoConfig?.version ?? undefined;
  try {
    await trpcClient.notifications.registerPushToken.mutate({
      deviceId,
      expoToken,
      platform,
      appVersion,
    });
  } catch (err) {
    // Transient network / auth failures — the hook re-runs on the
    // next SIGNED_IN, so don't escalate.
    console.warn(
      "[push] registerPushToken mutation failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function revokeWithApi(): Promise<void> {
  try {
    const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!deviceId) return;
    await trpcClient.notifications.revokePushToken.mutate({ deviceId });
  } catch (err) {
    console.warn(
      "[push] revokePushToken mutation failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

interface NotificationDataPayload {
  deepLink?: string;
}

export function usePushNotifications(): void {
  // Registration runs whenever the patient is signed in (cold launch
  // with active session + every SIGNED_IN transition). The
  // `(patient_id, device_id)` UNIQUE index collapses repeats.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void registerWithApi();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") void registerWithApi();
      if (event === "SIGNED_OUT") void revokeWithApi();
    });
    return () => subscription.unsubscribe();
  }, []);

  // Notification-tap deep-linking. The server-side payload carries
  // `data.deepLink` (see `services/extraction/src/consumers/
  // notifications.ts`), pointing at routes like `/inicio/uploads/:id`.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as
          | NotificationDataPayload
          | undefined;
        const deepLink = data?.deepLink;
        if (typeof deepLink === "string" && deepLink.startsWith("/")) {
          router.push(deepLink);
        }
      },
    );
    return () => sub.remove();
  }, []);
}
