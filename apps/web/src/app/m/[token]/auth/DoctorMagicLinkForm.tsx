"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";
import { Label } from "@healthtracker/ui/label";
import {
  AUTH_REQUEST_CTA_PT_BR,
  AUTH_REQUEST_EMAIL_LABEL_PT_BR,
  AUTH_REQUEST_GENERIC_ERROR_PT_BR,
  AUTH_REQUEST_RESEND_HINT_PT_BR,
  AUTH_REQUEST_RESEND_LOCKOUT_MS,
  AUTH_REQUEST_SENT_FN,
} from "@healthtracker/validators";

import { createSupabaseClient } from "~/auth/client";

/**
 * Story 6.2 AC1 / AC2 / T5.2 — client-side magic-link form.
 *
 * `signInWithOtp({ shouldCreateUser: true })` — first-time doctors
 * land here without an account; Supabase mints `auth.users` on first
 * verify. The `emailRedirectTo` round-trips back to our token-aware
 * callback at `/m/[token]/auth/callback?shareTokenId=...&tokenHmac=...`.
 *
 * **CRITICAL:** never branch the error message on Supabase's response.
 * Returning "this email is already a doctor / not a doctor" would be
 * an enumeration oracle on registered users (AC1).
 *
 * 60s client-side resend lockout is best-effort UI hygiene only; the
 * real rate-limit is a Vercel WAF / Supabase Auth setting (deferred).
 */

export interface DoctorMagicLinkFormProps {
  shareTokenId: string;
  tokenHmac: string;
}

export function DoctorMagicLinkForm(
  props: DoctorMagicLinkFormProps,
): React.ReactElement {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockoutMs, setLockoutMs] = useState(0);
  // R1-M2: ref to *this* form so onPress doesn't collide with a sibling
  // form on the page (the global `document.querySelector('form')` query
  // would pick the first form anywhere on the document).
  const formRef = useRef<HTMLFormElement | null>(null);

  // Resend-lockout countdown (purely UX — server-side rate limit is
  // not in scope for this story; the WAF / Supabase Auth ship rate
  // limits at the platform layer).
  useEffect(() => {
    if (lockoutMs <= 0) return;
    const t = setTimeout(() => {
      setLockoutMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => clearTimeout(t);
  }, [lockoutMs]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || lockoutMs > 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createSupabaseClient();
      const normalized = email.trim().toLowerCase();
      // AC2 — compose the absolute `emailRedirectTo` that round-trips
      // to our token-aware callback. Use the current origin so dev
      // (`localhost:3000`) and prod each work without an env read.
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const emailRedirectTo = `${origin}/m/${props.shareTokenId}.${props.tokenHmac}/auth/callback?shareTokenId=${encodeURIComponent(
        props.shareTokenId,
      )}&tokenHmac=${encodeURIComponent(props.tokenHmac)}`;
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: { shouldCreateUser: true, emailRedirectTo },
      });
      if (otpError) {
        // AC1 — single generic error string. NEVER branch on the
        // server's message.
        setError(AUTH_REQUEST_GENERIC_ERROR_PT_BR);
        return;
      }
      setSentTo(normalized);
      setLockoutMs(AUTH_REQUEST_RESEND_LOCKOUT_MS);
    } catch {
      // Catches network-shape errors thrown by the fetch underneath
      // signInWithOtp. Same generic copy — no enumeration oracle. The
      // catch is intentionally broad here because every shape (TypeError
      // "fetch failed", DOMException, etc.) collapses into the same
      // user-visible string per AC1.
      setError(AUTH_REQUEST_GENERIC_ERROR_PT_BR);
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo !== null) {
    return (
      <div
        role="status"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <p style={{ margin: 0 }}>{AUTH_REQUEST_SENT_FN(sentTo)}</p>
        <p style={{ margin: 0, color: "#777", fontSize: 14 }}>
          {AUTH_REQUEST_RESEND_HINT_PT_BR}
        </p>
        <Button
          onPress={() => {
            if (lockoutMs > 0) return;
            setSentTo(null);
          }}
          disabled={lockoutMs > 0}
          variant="secondary"
        >
          {lockoutMs > 0
            ? `${AUTH_REQUEST_CTA_PT_BR} (${Math.ceil(lockoutMs / 1000)}s)`
            : AUTH_REQUEST_CTA_PT_BR}
        </Button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Label htmlFor="doctor-email">{AUTH_REQUEST_EMAIL_LABEL_PT_BR}</Label>
        <Input
          id="doctor-email"
          value={email}
          onChangeText={setEmail}
          placeholder="seu@email.com"
          autoCapitalize="none"
          autoComplete="email"
        />
      </div>
      {error !== null && (
        <p role="alert" style={{ color: "#b45309", fontSize: 14, margin: 0 }}>
          {error}
        </p>
      )}
      <Button
        disabled={submitting || email.trim().length === 0}
        onPress={() => {
          // The `onPress` synthesises a submit on the underlying form
          // since Tamagui's Button doesn't natively submit. R1-M2:
          // target THIS form via ref — `document.querySelector('form')`
          // would pick the first form on the page if a future surface
          // composes multiple forms on `/m/[token]/auth`.
          formRef.current?.requestSubmit();
        }}
      >
        {AUTH_REQUEST_CTA_PT_BR}
      </Button>
    </form>
  );
}
