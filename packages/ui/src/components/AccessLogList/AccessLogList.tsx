"use client";

import { useState } from "react";
import { Text, YStack } from "tamagui";

import type {
  ClientAccessLogItemRow,
  ShareDuration,
} from "@healthtracker/validators";
import {
  ACCESS_LOG_EMPTY_PT_BR,
  ACCESS_LOG_ERROR_PT_BR,
  ACCESS_LOG_LIST_A11Y_LABEL_PT_BR,
  ACCESS_LOG_LOAD_MORE_PT_BR,
  ACCESS_LOG_LOADING_PT_BR,
  ACCESS_LOG_PREMIUM_REQUIRED_PT_BR,
  ACCESS_LOG_REFRESH_PT_BR,
  ACCESS_LOG_SUPPRESSED_KINDS,
} from "@healthtracker/validators";

import { Button } from "../../button";
import { AccessLogItem } from "../AccessLogItem";

/**
 * Story 5.3 — `AccessLogList` (AC1, AC3, AC5, AC9, AC10).
 *
 * Cross-platform (Tamagui RNW). Hosts the empty/loading/error/upgrade
 * states + Carregar-mais pagination + an Atualizar Tier-3 button so
 * the web tab-focus refresh has a manual escape hatch. Per-item
 * expansion state lives here (one open at a time would be simpler;
 * the spec lets each item own its own state — we keep a small map
 * so the renderer is still cheap).
 *
 * Why not `FlatList`: `packages/ui` cannot import `react-native`
 * directly (see ShareBiomarkerToggle docblock). The plain mapped
 * `YStack` + "Carregar mais" button matches the precedent set by
 * `apps/expo/.../compartilhar/index.tsx` and is sufficient at the
 * MVP page size (20).
 *
 * AC2 — `conversation_starter.queued` / `generated` are suppressed
 * entirely from the patient-facing list; surface only via an explicit
 * `?showSystem=1` query param if needed for debugging (deferred —
 * Story 5.x). They still arrive in `data` from the resolver so the
 * renderer can filter centrally via `ACCESS_LOG_SUPPRESSED_KINDS`.
 */
interface RawBiomarker {
  category: string;
  label?: string;
  visible?: boolean;
}

export interface AccessLogListProps {
  // Story 5.4 review-fix Patch #7 — UI consumes the client variant
  // (includes `"revoked-pending"`); the resolver emits the server
  // variant (Zod-narrowed at the tRPC boundary).
  data: ClientAccessLogItemRow[];
  isLoading: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  upgradeRequired: boolean;
  /**
   * Story 5.4 — hoisted to the screen so the dialog + 5s timer +
   * UndoToast can live above the list. The screen also injects
   * `tokenStatus="revoked-pending"` on rows whose shareTokenId is
   * in the parent's `revokingTokenIds` set (see the screens'
   * `accumulated` mapper).
   */
  onRevokePress?: (shareTokenId: string, displayName: string) => void;
}

export function AccessLogList(props: AccessLogListProps): React.ReactElement {
  const {
    data,
    isLoading,
    isError,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    upgradeRequired,
    onRevokePress,
  } = props;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // AC5 — free-tier path. Resolver returned `{ items: [], upgradeRequired: true }`;
  // surface the upgrade prompt (Tier-2 / never Tier-1 per UX-DR13).
  if (upgradeRequired) {
    return (
      <YStack padding="$4" gap="$3">
        <Text color="$textSecondary">{ACCESS_LOG_PREMIUM_REQUIRED_PT_BR}</Text>
      </YStack>
    );
  }

  if (isLoading) {
    return (
      <YStack padding="$4">
        <Text>{ACCESS_LOG_LOADING_PT_BR}</Text>
      </YStack>
    );
  }

  if (isError) {
    return (
      <YStack padding="$4" gap="$3">
        <Text>{ACCESS_LOG_ERROR_PT_BR}</Text>
        <Button variant="secondary" onPress={refetch}>
          {ACCESS_LOG_REFRESH_PT_BR}
        </Button>
      </YStack>
    );
  }

  const visible = data.filter(
    (row) => !ACCESS_LOG_SUPPRESSED_KINDS.has(row.event),
  );

  if (visible.length === 0) {
    return (
      <YStack padding="$4">
        <Text color="$textSecondary">{ACCESS_LOG_EMPTY_PT_BR}</Text>
      </YStack>
    );
  }

  return (
    <YStack
      padding="$3"
      gap="$2"
      accessibilityRole="list"
      accessibilityLabel={ACCESS_LOG_LIST_A11Y_LABEL_PT_BR}
    >
      {visible.map((row) => {
        const meta = row.metadata;
        // `share_token.created` carries `duration` in metadata (Story 5.2
        // audit shape); `sharing.configured` carries `biomarkerCategories`.
        const duration =
          typeof meta.duration === "string"
            ? (meta.duration as ShareDuration)
            : undefined;
        // Patch #6 (2026-05-26) — historical rows may carry malformed
        // entries (null, primitives, objects without `category`); filter
        // before the map so the renderer never crashes.
        const biomarkerCategories = Array.isArray(meta.biomarkerCategories)
          ? (meta.biomarkerCategories as unknown[])
              .filter(
                (b): b is RawBiomarker =>
                  b !== null &&
                  typeof b === "object" &&
                  typeof (b as { category?: unknown }).category === "string",
              )
              .map((b) => ({
                category: b.category,
                label: b.label ?? b.category,
                visible: b.visible === true,
              }))
          : undefined;
        return (
          <AccessLogItem
            key={row.id}
            id={row.id}
            event={row.event}
            displayName={row.displayName}
            timestamp={row.createdAt}
            tokenStatus={row.tokenStatus}
            biomarkerCategories={biomarkerCategories}
            duration={duration}
            expanded={expandedIds.has(row.id)}
            onPress={toggleExpanded}
            shareTokenId={row.shareTokenId}
            onRevokePress={onRevokePress}
          />
        );
      })}

      {hasNextPage ? (
        <Button
          variant="secondary"
          onPress={fetchNextPage}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage
            ? ACCESS_LOG_LOADING_PT_BR
            : ACCESS_LOG_LOAD_MORE_PT_BR}
        </Button>
      ) : null}
    </YStack>
  );
}
