import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Separator, Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  CONFIGURACOES_DISABLED_HINT_PT_BR,
  CONFIGURACOES_PRIVACIDADE_ROW_PT_BR,
  CONFIGURACOES_TITLE_PT_BR,
  NOTIFICATIONS_SETTINGS_LINK_LABEL_PT_BR,
  NOTIFICATIONS_SETTINGS_ROUTE,
  PRIVACIDADE_ROUTE,
} from "@healthtracker/validators";

// SafeAreaView is native and can't read Tamagui tokens.
const BACKGROUND_PRIMARY = "#F9F7F4";

interface SettingsRowProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  hint?: string;
}

/**
 * One row in the Settings index. Active rows are full-width primary
 * buttons; "Em breve" rows are visually muted via the `outline` variant
 * + a trailing hint string.
 */
function SettingsRow({ label, onPress, disabled, hint }: SettingsRowProps) {
  return (
    <YStack gap="$1">
      <Button
        onPress={onPress}
        disabled={disabled}
        variant={disabled ? "outline" : "primary"}
        accessibilityHint={hint}
      >
        {label}
      </Button>
      {disabled && hint && (
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$textTertiary"
          paddingHorizontal="$3"
        >
          {hint}
        </Text>
      )}
    </YStack>
  );
}

/**
 * Story 1.4 — Settings tab index. The only currently-functional row is
 * Privacidade; Conta and Notificações are placeholders for later epics
 * (Account / Epic 2 Notifications) with the `Em breve` affordance per
 * UX-DR3 (disabled-with-rationale).
 */
export default function ConfiguracoesIndex() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: CONFIGURACOES_TITLE_PT_BR }} />
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
          {CONFIGURACOES_TITLE_PT_BR}
        </Text>

        <SettingsRow
          label={CONFIGURACOES_PRIVACIDADE_ROW_PT_BR}
          onPress={() => router.push({ pathname: PRIVACIDADE_ROUTE })}
        />
        <Separator />
        <SettingsRow
          label="Conta"
          disabled
          hint={CONFIGURACOES_DISABLED_HINT_PT_BR}
        />
        {/* Story 2.8 — Notificações is now active. */}
        <SettingsRow
          label={NOTIFICATIONS_SETTINGS_LINK_LABEL_PT_BR}
          onPress={() => router.push(NOTIFICATIONS_SETTINGS_ROUTE)}
        />
      </YStack>
    </SafeAreaView>
  );
}
