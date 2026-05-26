import { useState } from "react";
import { AccessibilityInfo, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { ShareBiomarkerToggle } from "@healthtracker/ui";
import { Button } from "@healthtracker/ui/button";
import { useToastController } from "@healthtracker/ui/toast";
import {
  BIOMARKER_HIDDEN_PT_BR_FN,
  BIOMARKER_TOGGLE_FAILED_PT_BR,
  BIOMARKER_VISIBLE_PT_BR_FN,
  COMPARTILHAR_BACK_PT_BR,
  COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR,
  COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR,
  COMPARTILHAR_LOADING_PT_BR,
  COMPARTILHAR_ROUTE,
  compartilharConcluidoRoute,
  NO_DATA_YET_PT_BR,
  SHARE_TOKEN_INVALID_PT_BR,
} from "@healthtracker/validators";

import { useDebouncedConfigureBiomarkers } from "~/hooks/use-debounced-configure-biomarkers";
import { trpc } from "~/utils/api";

/**
 * Story 5.1 — per-biomarker toggle screen (AC2). Hydrates from
 * `getDraftConfig`; each toggle row dispatches into the debounced
 * batch mutation hook. The Concluir CTA is Tier 2 (secondary) per
 * UX-DR13.
 */
export default function BiomarcadoresScreen(): React.ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ shareTokenId: string }>();
  const shareTokenId = String(params.shareTokenId);
  const toast = useToastController();

  const query = useQuery(
    trpc.sharing.getDraftConfig.queryOptions({ shareTokenId }),
  );

  if (query.isError) {
    return (
      <YStack padding="$4" gap="$3">
        <Text>{SHARE_TOKEN_INVALID_PT_BR}</Text>
        <Button
          variant="secondary"
          onPress={() => router.replace(COMPARTILHAR_ROUTE)}
        >
          {COMPARTILHAR_BACK_PT_BR}
        </Button>
      </YStack>
    );
  }

  if (!query.data) {
    return (
      <YStack padding="$4">
        <Text>{COMPARTILHAR_LOADING_PT_BR}</Text>
      </YStack>
    );
  }

  return (
    <BiomarcadoresBody
      shareTokenId={shareTokenId}
      doctorName={query.data.doctor.displayName}
      initialScope={query.data.biomarkerScope}
      onDone={() => router.replace(compartilharConcluidoRoute(shareTokenId))}
      onFailure={() => toast.show(BIOMARKER_TOGGLE_FAILED_PT_BR)}
    />
  );
}

function BiomarcadoresBody(props: {
  shareTokenId: string;
  doctorName: string;
  initialScope: { category: string; label: string; visible: boolean }[];
  onDone: () => void;
  onFailure: () => void;
}): React.ReactNode {
  const { scope, toggle, flushAsync } = useDebouncedConfigureBiomarkers({
    shareTokenId: props.shareTokenId,
    initialScope: props.initialScope,
    onError: props.onFailure,
  });

  // Patch #3 — Fast-Concluir race. Disable the button + await the
  // in-flight flush before routing so the Toast / revert path can
  // run before unmount kills the hook.
  const [submitting, setSubmitting] = useState(false);

  const handleDone = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await flushAsync();
    } finally {
      // No setSubmitting(false) — we're about to unmount on success.
      props.onDone();
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <YStack gap="$3">
        <Text fontSize="$5">{COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR}</Text>

        {props.initialScope.length === 0 ? (
          <Text color="$textSecondary">{NO_DATA_YET_PT_BR}</Text>
        ) : null}

        {props.initialScope.map((entry) => (
          <ShareBiomarkerToggle
            key={entry.category}
            biomarkerCategory={entry.category}
            biomarkerLabel={entry.label}
            visible={scope.get(entry.category) ?? entry.visible}
            doctorName={props.doctorName}
            onToggle={(next) => {
              toggle(entry.category, next);
              // AC2 — agency-confirmation announce on the native side
              // (the shared UI component is web-safe and does not pull
              // `react-native`).
              const msg = next
                ? BIOMARKER_VISIBLE_PT_BR_FN(entry.label, props.doctorName)
                : BIOMARKER_HIDDEN_PT_BR_FN(entry.label, props.doctorName);
              AccessibilityInfo.announceForAccessibility(msg);
            }}
          />
        ))}

        <Button
          variant="secondary"
          disabled={submitting}
          onPress={() => {
            void handleDone();
          }}
        >
          {submitting
            ? COMPARTILHAR_LOADING_PT_BR
            : COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR}
        </Button>
      </YStack>
    </ScrollView>
  );
}
