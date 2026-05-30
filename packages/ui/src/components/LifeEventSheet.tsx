"use client";

import { useEffect, useRef, useState } from "react";
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
 * Minimal focus contract — both react-native `TextInput` and the
 * web `<input>` element expose a `.focus()` method. We avoid
 * importing react-native types because `packages/ui` is consumed
 * by both Expo and Next.
 */
interface FocusableRef {
  focus: () => void;
}

/**
 * Story 7.1 — `LifeEventSheet` (mobile bottom sheet).
 *
 * Three input rows per AC1:
 *   - free-text description (140 char max)
 *   - event-date text input accepting pt-BR `dd/mm/aaaa` (preferred)
 *     OR ISO `yyyy-mm-dd`. `parseLifeEventDateInput` converts the
 *     user input to ISO `yyyy-mm-dd` (the wire format) before the
 *     mutation fires. A platform-native picker
 *     (`@react-native-community/datetimepicker`) is deferred — the
 *     dep is not in the workspace yet (Story 7.x follow-up).
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

/**
 * R1-followup MED — pt-BR date input parser. Patients expect
 * `dd/mm/aaaa` (the BIA form uses it). The wire format must stay
 * ISO `yyyy-mm-dd`, so we accept BOTH `dd/mm/aaaa` and
 * `yyyy-mm-dd` here and convert to ISO before submitting.
 *
 * Returns `null` when the string can't be parsed as a real
 * calendar date — the Save button stays disabled and the server-
 * side `isRealIsoDate` refine remains as defence-in-depth.
 *
 * Picker note: shipping a platform-native picker
 * (`@react-native-community/datetimepicker`) is deferred — the dep
 * is not in the workspace and adding it mid-PR is out of scope.
 */
export function parseLifeEventDateInput(raw: string): string | null {
  const value = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const brl = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (brl) {
    d = Number(brl[1]);
    m = Number(brl[2]);
    y = Number(brl[3]);
  } else {
    return null;
  }
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
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
  // R1-followup LOW #3 — focus management on sheet open. Tamagui
  // `Sheet` does not auto-focus the first input; screen-reader
  // users otherwise land on the sheet handle.
  const descriptionRef = useRef<FocusableRef | null>(null);

  const trimmed = description.trim();
  const parsedDate = parseLifeEventDateInput(eventDate);
  const descriptionLengthOk =
    trimmed.length >= 1 && trimmed.length <= LIFE_EVENT_DESCRIPTION_MAX;
  const canSave = !saving && parsedDate !== null && descriptionLengthOk;

  function handleSave() {
    if (saving || !descriptionLengthOk || parsedDate === null) return;
    onSubmit({ eventDate: parsedDate, description: trimmed, category });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setDescription("");
      setCategory(null);
      setEventDate(initialEventDate ?? todayLocalIso());
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open) return;
    // Defer one tick so the Sheet mount/animation has placed the
    // input in the tree before we attempt to focus it.
    const handle = setTimeout(() => {
      descriptionRef.current?.focus();
    }, 0);
    return () => clearTimeout(handle);
  }, [open]);

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
            ref={descriptionRef as never}
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
            placeholder="DD/MM/AAAA"
            accessibilityLabel={LIFE_EVENT_DATE_LABEL_PT_BR}
            accessibilityHint="Use o formato dia/mês/ano, por exemplo 31/12/2025."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
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
