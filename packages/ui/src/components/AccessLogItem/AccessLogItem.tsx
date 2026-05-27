"use client";

import { Text, XStack, YStack } from "tamagui";

import type {
  AccessLogEventKind,
  AccessLogTokenStatus,
  ShareDuration,
} from "@healthtracker/validators";
import {
  ACCESS_LOG_EVENT_LABEL_PT_BR_FN,
  ACCESS_LOG_EXPAND_A11Y_LABEL_PT_BR_FN,
  ACCESS_LOG_REVOKING_HINT_PT_BR,
  ACCESS_LOG_SELF_DISPLAY_NAME_PT_BR,
  ACCESS_LOG_TOKEN_STATUS_PT_BR_FN,
  DURATION_LABEL_PT_BR_FN,
  formatAbsolutePtBr,
  formatRelativeTimePtBr,
  REVOKE_BUTTON_A11Y_PT_BR_FN,
  REVOKE_BUTTON_LABEL_PT_BR,
} from "@healthtracker/validators";

import { Button } from "../../button";

/**
 * Story 5.3 — `AccessLogItem` (UX spec lines 910–925; AC2, AC3, AC8).
 *
 * Two visual variants (driven by the `expanded` prop):
 *   - **compact** — header + action description + relative timestamp
 *     + token-status badge.
 *   - **expanded** — adds absolute timestamp, biomarker chip list
 *     (when `metadata.biomarkerCategories` exists on `sharing.configured`),
 *     and a read-only link to the biomarker-config screen for active
 *     shares.
 *
 * Token-status surfacing: maps `tokenStatus` → one of four Tamagui
 * semantic tokens (`$accessLogActive` / `$accessLogExpired` /
 * `$accessLogRevoked` / `$accessLogNeutral`). NEVER red — UX-DR13
 * reserves red for system errors. NEVER hex literals (Story 3.4
 * lesson).
 *
 * All pt-BR copy comes from `@healthtracker/validators`. Adding a new
 * event kind = update both the discriminated union there AND the
 * resolver allowlist.
 *
 * AC2 — `conversation_starter.queued` / `generated` are suppressed
 * entirely from the patient-facing list (filtered upstream in
 * `AccessLogList`); they are NOT surfaced on expand. The `failed`
 * variant stays visible.
 */
export interface AccessLogItemProps {
  id: string;
  event: AccessLogEventKind;
  /** Resolved display name; `null` falls back to `"Você"`. */
  displayName: string | null;
  timestamp: Date;
  tokenStatus: AccessLogTokenStatus | null;
  /** Pulled from `metadata.biomarkerCategories` on `sharing.configured` rows. */
  biomarkerCategories?: {
    category: string;
    label: string;
    visible: boolean;
  }[];
  /** Pulled from `metadata.duration` on `share_token.created` rows. */
  duration?: ShareDuration;
  expanded: boolean;
  onPress?: (id: string) => void;
  /**
   * Story 5.4 (AC1, AC3) — share-token id needed to wire the revoke
   * action. Surfaced on rows whose `event === 'share_token.created'`
   * and `tokenStatus IN ('ativo','sem prazo')`. The screen owns the
   * dialog + 5s timer + UndoToast; the item just hoists the press.
   */
  shareTokenId?: string | null;
  /**
   * Story 5.4 (AC1) — fired when the "Revogar acesso" button is
   * tapped. The screen opens `RevokeConfirmDialog` with the
   * `displayName` for the body copy.
   */
  onRevokePress?: (shareTokenId: string, displayName: string) => void;
}

function backgroundTokenForStatus(status: AccessLogTokenStatus | null): string {
  switch (status) {
    case "ativo":
      return "$accessLogActive";
    case "expirado":
      return "$accessLogExpired";
    case "revogado":
      return "$accessLogRevoked";
    case "sem prazo":
      return "$accessLogNeutral";
    // Story 5.4 (AC6) — same muted neutral as `revogado`. The dim
    // treatment + "Revogando…" badge copy + UndoToast countdown
    // disambiguate. NEVER red per UX-DR13 / UX line 1079.
    case "revoked-pending":
      return "$accessLogNeutral";
    default:
      return "$accessLogNeutral";
  }
}

export function AccessLogItem(props: AccessLogItemProps): React.ReactElement {
  const {
    id,
    event,
    displayName,
    timestamp,
    tokenStatus,
    biomarkerCategories,
    duration,
    expanded,
    onPress,
    shareTokenId,
    onRevokePress,
  } = props;

  // Patch #5 (2026-05-26) — empty / whitespace `displayName` (from
  // historical rows) must fall back to "Você", not produce
  // "Você adicionou ." or a blank header. `||` is intentional here:
  // `??` wouldn't catch the empty-string case after `.trim()`.
  const trimmedName = displayName?.trim() ?? "";
  const resolvedDisplayName =
    trimmedName.length > 0 ? trimmedName : ACCESS_LOG_SELF_DISPLAY_NAME_PT_BR;
  const durationLabel = duration
    ? DURATION_LABEL_PT_BR_FN(duration)
    : undefined;
  const biomarkerChangeCount = biomarkerCategories?.length ?? 0;
  const actionText = ACCESS_LOG_EVENT_LABEL_PT_BR_FN(event, {
    displayName: resolvedDisplayName,
    durationLabel,
    biomarkerChangeCount,
  });

  const relativeTs = formatRelativeTimePtBr(timestamp);
  const absoluteTs = formatAbsolutePtBr(timestamp);

  // Story 5.4 (AC1, AC6) — show the "Revogar acesso" button only on
  // the canonical share-token-created row in an active state. The
  // `shareTokenId` + `onRevokePress` truthiness is re-checked at
  // the JSX site so TypeScript narrows the optional props.
  const canRevoke =
    event === "share_token.created" &&
    (tokenStatus === "ativo" || tokenStatus === "sem prazo");
  const isRevokePending = tokenStatus === "revoked-pending";

  return (
    <YStack
      testID={`access-log-item-${id}`}
      accessibilityRole="button"
      accessibilityLabel={ACCESS_LOG_EXPAND_A11Y_LABEL_PT_BR_FN(
        resolvedDisplayName,
      )}
      accessibilityState={{ expanded }}
      onPress={onPress ? () => onPress(id) : undefined}
      padding="$3"
      gap="$2"
      borderRadius="$card"
      backgroundColor="$surfaceElevated"
      pressStyle={{ opacity: 0.92 }}
      opacity={isRevokePending ? 0.6 : 1}
    >
      <XStack justifyContent="space-between" alignItems="center" gap="$3">
        <Text fontSize="$4" color="$textPrimary" flex={1}>
          {resolvedDisplayName}
        </Text>
        {tokenStatus ? (
          <XStack
            paddingHorizontal="$2"
            paddingVertical="$1"
            borderRadius="$chip"
            backgroundColor={backgroundTokenForStatus(tokenStatus)}
          >
            <Text fontSize="$1" color="$textPrimary">
              {ACCESS_LOG_TOKEN_STATUS_PT_BR_FN(tokenStatus)}
            </Text>
          </XStack>
        ) : null}
      </XStack>

      <Text fontSize="$3" color="$textPrimary">
        {actionText}
      </Text>

      <Text fontSize="$2" color="$textSecondary">
        {expanded ? absoluteTs : relativeTs}
      </Text>

      {isRevokePending ? (
        <Text fontSize="$2" color="$textSecondary">
          {ACCESS_LOG_REVOKING_HINT_PT_BR}
        </Text>
      ) : null}

      {canRevoke && shareTokenId && onRevokePress ? (
        <XStack paddingTop="$2">
          <Button
            variant="secondary"
            accessibilityLabel={REVOKE_BUTTON_A11Y_PT_BR_FN(
              resolvedDisplayName,
            )}
            onPress={() => onRevokePress(shareTokenId, resolvedDisplayName)}
          >
            {REVOKE_BUTTON_LABEL_PT_BR}
          </Button>
        </XStack>
      ) : null}

      {expanded && biomarkerCategories && biomarkerCategories.length > 0 ? (
        <XStack flexWrap="wrap" gap="$2" paddingTop="$2">
          {biomarkerCategories.map((b) => (
            <XStack
              key={b.category}
              paddingHorizontal="$2"
              paddingVertical="$1"
              borderRadius="$chip"
              backgroundColor={
                b.visible ? "$accessLogActive" : "$accessLogNeutral"
              }
            >
              <Text fontSize="$1" color="$textPrimary">
                {b.visible ? b.label : `🔒 ${b.label}`}
              </Text>
            </XStack>
          ))}
        </XStack>
      ) : null}
    </YStack>
  );
}
