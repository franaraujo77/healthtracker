import { useEffect, useState } from "react";

import { setActiveQueryCachePatient } from "~/lib/query-cache-persister";
import { supabase } from "~/lib/supabase";

/**
 * Story 3.4 — auth-bound activation of the patient-namespaced
 * React Query persister.
 *
 * On `SIGNED_IN` (or an initial cold-launch with a valid session),
 * bind the persister to `session.user.id` so the cached Fingerprint
 * queries hydrate from the right AsyncStorage key. On `SIGNED_OUT`,
 * pass `null` so the previous patient's key is removed (AC6 — LGPD).
 *
 * R1-P271 (AC7 hydration race) — returns a `bootstrapped` flag that
 * starts `false` and flips `true` once the initial `getSession()`
 * resolves (regardless of whether a session was found). The caller
 * gates the children subtree on this flag so Início's `useQuery`
 * never fires against a bare `QueryClientProvider` before the
 * persister is bound for a returning patient. Cold-launch with no
 * session also flips the flag so anonymous flows aren't blocked.
 *
 * Concerns separation: kept OUT of `useOfflineUploadFlow`. Both
 * hooks listen to `onAuthStateChange` independently — the listener
 * is cheap and Supabase de-dupes internally; the alternative
 * (cross-coupling the two hooks) would tangle Story 2.6's queue
 * lifecycle with Story 3.4's cache lifecycle for no benefit.
 */
/**
 * R2-P276 — defensive ceiling on the bootstrap gate. `getSession()`
 * normally resolves in <100 ms; if SecureStore is corrupted or the
 * underlying native module hangs without rejecting, the `.finally`
 * never fires and the gate keeps the whole RootLayout subtree
 * unmounted forever (blank screen). 2 s is generous compared to the
 * typical p95 and short enough that a hang is recoverable: worst
 * case the persister stays unbound and Início falls back to the
 * pre-Story-3.4 behaviour (one render of loading state), which is
 * strictly better than a permanently-blank app.
 */
const BOOTSTRAP_TIMEOUT_MS = 2000;

export function useQueryCacheLifecycle(): { bootstrapped: boolean } {
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { data: authSub } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          setActiveQueryCachePatient(session.user.id);
        } else if (event === "SIGNED_OUT") {
          setActiveQueryCachePatient(null);
        }
      },
    );

    // R2-P276 — defensive timeout. See BOOTSTRAP_TIMEOUT_MS rationale.
    const timeoutId = setTimeout(() => {
      if (!cancelled) setBootstrapped(true);
    }, BOOTSTRAP_TIMEOUT_MS);

    // The listener only fires on changes; seed from the current
    // session at mount so a cold-launch with an existing session
    // immediately binds the persister BEFORE Início's queries mount.
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session?.user) {
          setActiveQueryCachePatient(data.session.user.id);
        }
      })
      .catch((err: unknown) => {
        console.warn(
          "[query-cache-lifecycle] getSession failed during bootstrap",
          err,
        );
      })
      .finally(() => {
        // R1-P271 — flip the gate regardless of outcome; a failing
        // getSession() must not permanently block the UI. Worst case:
        // a returning patient sees the loading state for one render
        // (degenerate parity with the pre-Story-3.4 behaviour).
        clearTimeout(timeoutId);
        if (!cancelled) setBootstrapped(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      authSub.subscription.unsubscribe();
    };
  }, []);

  return { bootstrapped };
}
