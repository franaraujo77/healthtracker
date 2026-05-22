"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";
import { Label } from "@healthtracker/ui/label";
import {
  DUPLICATE_EMAIL_MESSAGE_PT_BR,
  GENERIC_REGISTRATION_ERROR_MESSAGE_PT_BR,
  isDuplicateEmailError,
  normalizeEmail,
  PASSWORD_HELPER_TEXT_PT_BR,
  RegisterSchema,
  VERIFY_EMAIL_MESSAGE_PT_BR,
} from "@healthtracker/validators";

import { createSupabaseClient } from "~/auth/client";
import { useTRPC } from "~/trpc/react";

export function RegisterForm() {
  const router = useRouter();
  const trpc = useTRPC();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverNotice, setServerNotice] = useState<string | null>(null);

  const initializeProfile = useMutation(
    trpc.account.initializeProfile.mutationOptions(),
  );

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: RegisterSchema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      setServerNotice(null);
      // signUp is performed client-side so the resulting session is held by
      // the Supabase client; the subsequent protectedProcedure call runs under
      // that session (RLS SET LOCAL handled by the tRPC middleware).
      // TanStack Form passes the raw field state to `onSubmit`, not the
      // schema's parsed output — so we apply the canonical normalization
      // here, at the Supabase boundary, to match the Expo client exactly.
      const supabase = createSupabaseClient();
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(value.email),
        password: value.password,
      });

      if (error) {
        setServerError(
          isDuplicateEmailError(error)
            ? DUPLICATE_EMAIL_MESSAGE_PT_BR
            : GENERIC_REGISTRATION_ERROR_MESSAGE_PT_BR,
        );
        return;
      }
      if (!data.session) {
        // Email-confirmation enabled in Supabase — signUp returned no
        // session. Routing to /onboarding/consent here would dead-end on
        // UNAUTHORIZED because every consent.grant requires a session.
        // Surface the verification notice in the *notice* slot — it's an
        // informational success-path message, not an error. Routing the
        // user into /onboarding/consent now would dead-end on UNAUTHORIZED.
        // /auth/callback will call initializeProfile and route into
        // consent after the patient clicks the verification link.
        setServerNotice(VERIFY_EMAIL_MESSAGE_PT_BR);
        return;
      }
      try {
        await initializeProfile.mutateAsync();
        router.push("/onboarding/consent");
      } catch {
        setServerError(GENERIC_REGISTRATION_ERROR_MESSAGE_PT_BR);
      }
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="email"
        children={(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor={field.name}>E-mail</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChangeText={(v) => field.handleChange(v)}
              placeholder="seu@email.com"
              autoCapitalize="none"
              autoComplete="email"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-amber-700">
                {field.state.meta.errors
                  .map((e) => (typeof e === "string" ? e : e?.message))
                  .filter(Boolean)
                  .join(" ")}
              </p>
            )}
          </div>
        )}
      />
      <form.Field
        name="password"
        children={(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor={field.name}>Senha</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChangeText={(v) => field.handleChange(v)}
              autoComplete="new-password"
              secureTextEntry
            />
            <p className="text-muted-foreground text-xs">
              {PASSWORD_HELPER_TEXT_PT_BR}
            </p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-amber-700">
                {field.state.meta.errors
                  .map((e) => (typeof e === "string" ? e : e?.message))
                  .filter(Boolean)
                  .join(" ")}
              </p>
            )}
          </div>
        )}
      />
      {serverNotice && (
        <p role="status" className="text-sm text-stone-700">
          {serverNotice}
        </p>
      )}
      {serverError && (
        <p role="alert" className="text-sm text-amber-700">
          {serverError}
        </p>
      )}
      <Button
        disabled={form.state.isSubmitting || initializeProfile.isPending}
        onPress={() => void form.handleSubmit()}
      >
        Criar conta
      </Button>
    </form>
  );
}
