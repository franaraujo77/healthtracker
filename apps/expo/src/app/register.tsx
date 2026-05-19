import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";
import {
  DUPLICATE_EMAIL_MESSAGE_PT_BR,
  GENERIC_REGISTRATION_ERROR_MESSAGE_PT_BR,
  isDuplicateEmailError,
  normalizeEmail,
  PASSWORD_HELPER_TEXT_PT_BR,
  RegisterSchema,
} from "@healthtracker/validators";

import { supabase } from "~/lib/supabase";
import { trpc } from "~/utils/api";

// SafeAreaView is native and can't read Tamagui tokens — must mirror
// colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const initializeProfile = useMutation(
    trpc.account.initializeProfile.mutationOptions(),
  );

  async function onSubmit() {
    setServerError(null);
    setFieldErrors({});

    const parsed = RegisterSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      setFieldErrors({
        email: flat.fieldErrors.email?.[0],
        password: flat.fieldErrors.password?.[0],
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(parsed.data.email),
        password: parsed.data.password,
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
        // Email-confirmation enabled — no session yet. The deep-link handler
        // in app/_layout.tsx will call initializeProfile after verification.
        router.replace("/onboarding/consent");
        return;
      }
      await initializeProfile.mutateAsync();
      router.replace("/onboarding/consent");
    } catch {
      setServerError(GENERIC_REGISTRATION_ERROR_MESSAGE_PT_BR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Criar conta" }} />
      <YStack
        flex={1}
        padding="$4"
        gap="$3"
        backgroundColor="$backgroundPrimary"
      >
        <Text
          fontFamily="$body"
          fontSize="$8"
          fontWeight="700"
          color="$textPrimary"
        >
          Criar conta
        </Text>
        <Text fontFamily="$body" fontSize="$4" color="$textSecondary">
          Comece o seu registro de saúde longitudinal.
        </Text>

        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" color="$textPrimary">
            E-mail
          </Text>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="seu@email.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          {fieldErrors.email && (
            <Text fontFamily="$body" fontSize="$3" color="$biomarkerDeviation">
              {fieldErrors.email}
            </Text>
          )}
        </YStack>

        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" color="$textPrimary">
            Senha
          </Text>
          <Input
            value={password}
            onChangeText={setPassword}
            autoComplete="new-password"
            secureTextEntry
          />
          <Text fontFamily="$body" fontSize="$2" color="$textTertiary">
            {PASSWORD_HELPER_TEXT_PT_BR}
          </Text>
          {fieldErrors.password && (
            <Text fontFamily="$body" fontSize="$3" color="$biomarkerDeviation">
              {fieldErrors.password}
            </Text>
          )}
        </YStack>

        {serverError && (
          <Text fontFamily="$body" fontSize="$3" color="$biomarkerDeviation">
            {serverError}
          </Text>
        )}

        <Button onPress={onSubmit} disabled={submitting}>
          Criar conta
        </Button>
      </YStack>
    </SafeAreaView>
  );
}
