"use client";

import { useState } from "react";
import { Sheet, Text, XStack, YStack } from "tamagui";

import type { LifeEventCategory } from "@healthtracker/validators";
import {
  LIFE_EVENT_CANCEL_PT_BR,
  LIFE_EVENT_CATEGORIES,
  LIFE_EVENT_CATEGORY_LABEL_PT_BR,
  LIFE_EVENT_CATEGORY_LABELS_PT_BR,
  LIFE_EVENT_DATE_LABEL_PT_BR,
  LIFE_EVENT_DESCRIPTION_LABEL_PT_BR,
  LIFE_EVENT_DESCRIPTION_MAX,
  LIFE_EVENT_DESCRIPTION_PLACEHOLDER_PT_BR,
  LIFE_EVENT_PRIVACY_HINT_PT_BR,
  LIFE_EVENT_SAVE_PT_BR,
  LIFE_EVENT_SHEET_TITLE_PT_BR,
} from "@healthtracker/validators";

import { Button } from "../button";
import { Input } from "../input";

/**
 * Story 7.1 — `LifeEventSheet` (mobile bottom sheet).
 *
 * Three input rows per AC1:
 *   - free-text description (140 char max)
 *   - event-date `yyyy-mm-dd` text input (mobile native date picker
 *     is deferred — keeps this component runtime-portable across
 *     Expo + web preview; replace with a platform-specific date
 *     picker in the consumer if/when needed)
 *   - optional category chip row
 *
 * The privacy hint sits above the action row so the patient sees
 * `patient_only` semantics BEFORE tapping save. Web Fingerprint
 * surface (AC11) is deferred — Story 7.1 ships mobile-only.
 */

export interface LifeEventSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called when the user taps "Salvar" with a valid form. The parent
   * owns the mutation + error surfacing — this component is a pure
   * presentation shell.
   */
  onSubmit: (values: {
    eventDate: string;
    description: string;
    category: LifeEventCategory | null;
  }) => void;
  /** When true, disables the save button (mutation in flight). */
  saving?: boolean;
  /** Optional initial `yyyy-mm-dd` date prefill (defaults to today). */
  initialEventDate?: string;
}

function todayLocalIso(): string {
  // Local-time `yyyy-mm-dd`. The server-side São Paulo refine
  // (`todayInSaoPauloIso`) is the source of truth for the
  // retroactive-only AC6 boundary — this local-clock default is
  // just a usability prefill.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function LifeEventSheet({
  open,
  onOpenChange,
  onSubmit,
  saving,
  initialEventDate,
}: LifeEventSheetProps) {
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState(
    initialEventDate ?? todayLocalIso(),
  );
  const [category, setCategory] = useState<LifeEventCategory | null>(null);

  const trimmed = description.trim();
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(eventDate);
  const canSave =
    !saving &&
    dateOk &&
    trimmed.length >= 1 &&
    trimmed.length <= LIFE_EVENT_DESCRIPTION_MAX;

  function handleSave() {
    if (!canSave) return;
    onSubmit({ eventDate, description: trimmed, category });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setDescription("");
      setCategory(null);
      setEventDate(initialEventDate ?? todayLocalIso());
    }
    onOpenChange(next);
  }

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={handleOpenChange}
      snapPointsMode="fit"
      dismissOnSnapToBottom
      animation="medium"
    >
      <Sheet.Overlay
        animation="medium"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <Sheet.Handle />
      <Sheet.Frame
        padding="$4"
        gap="$3"
        backgroundColor="$surfaceElevated"
        accessibilityRole="none"
      >
        <Text
          fontFamily="$body"
          fontSize="$6"
          fontWeight="700"
          color="$textPrimary"
        >
          {LIFE_EVENT_SHEET_TITLE_PT_BR}
        </Text>

        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" color="$textSecondary">
            {LIFE_EVENT_DESCRIPTION_LABEL_PT_BR}
          </Text>
          <Input
            value={description}
            onChangeText={setDescription}
            maxLength={LIFE_EVENT_DESCRIPTION_MAX}
            placeholder={LIFE_EVENT_DESCRIPTION_PLACEHOLDER_PT_BR}
            accessibilityLabel={LIFE_EVENT_DESCRIPTION_LABEL_PT_BR}
          />
          <Text fontFamily="$body" fontSize="$1" color="$textTertiary">
            {trimmed.length}/{LIFE_EVENT_DESCRIPTION_MAX}
          </Text>
        </YStack>

        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" color="$textSecondary">
            {LIFE_EVENT_DATE_LABEL_PT_BR}
          </Text>
          <Input
            value={eventDate}
            onChangeText={setEventDate}
            placeholder="AAAA-MM-DD"
            accessibilityLabel={LIFE_EVENT_DATE_LABEL_PT_BR}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </YStack>

        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" color="$textSecondary">
            {LIFE_EVENT_CATEGORY_LABEL_PT_BR}
          </Text>
          <XStack gap="$2" flexWrap="wrap">
            {LIFE_EVENT_CATEGORIES.map((c) => {
              const selected = category === c;
              return (
                <Button
                  key={c}
                  variant={selected ? "primary" : "outline"}
                  onPress={() => setCategory(selected ? null : c)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  {LIFE_EVENT_CATEGORY_LABELS_PT_BR[c]}
                </Button>
              );
            })}
          </XStack>
        </YStack>

        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$textSecondary"
          accessibilityRole="text"
        >
          {LIFE_EVENT_PRIVACY_HINT_PT_BR}
        </Text>

        <YStack gap="$2">
          <Button
            onPress={handleSave}
            disabled={!canSave}
            accessibilityRole="button"
          >
            {LIFE_EVENT_SAVE_PT_BR}
          </Button>
          <Button variant="ghost" onPress={() => handleOpenChange(false)}>
            {LIFE_EVENT_CANCEL_PT_BR}
          </Button>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  );
}
