import { useState } from "react";
import { Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Input, Text, YStack } from "tamagui";

import type {
  BiaDeviceName,
  BiaSubmissionInput,
} from "@healthtracker/validators";
import {
  BIA_DEVICE_NAMES,
  BIA_DUPLICATE_MODAL_CANCEL_PT_BR,
  BIA_DUPLICATE_MODAL_CONFIRM_PT_BR,
  BIA_DUPLICATE_MODAL_TITLE_PT_BR,
  BIA_FIELD_BODY_FAT_PT_BR,
  BIA_FIELD_COLLECTED_AT_PT_BR,
  BIA_FIELD_DATE_INVALID_PT_BR,
  BIA_FIELD_DEVICE_CUSTOM_NAME_PT_BR,
  BIA_FIELD_DEVICE_MODEL_PT_BR,
  BIA_FIELD_DEVICE_NAME_PT_BR,
  BIA_FIELD_NUMBER_INVALID_PT_BR,
  BIA_FIELD_REQUIRED_PT_BR,
  BIA_FIELD_SKELETAL_MUSCLE_PT_BR,
  BIA_FIELD_VISCERAL_FAT_PT_BR,
  BIA_FORM_TITLE_PT_BR,
  BIA_SUBMIT_CTA_PT_BR,
  BIA_SUBMIT_ERROR_PT_BR,
  parseBrazilianDecimal,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

interface FormState {
  visceralFat: string;
  skeletalMuscle: string;
  bodyFat: string;
  collectedAtBr: string;
  deviceName: BiaDeviceName;
  deviceCustomName: string;
  deviceModel: string;
}

interface FieldErrors {
  visceralFat?: string;
  skeletalMuscle?: string;
  bodyFat?: string;
  collectedAtBr?: string;
  deviceCustomName?: string;
}

const initial: FormState = {
  visceralFat: "",
  skeletalMuscle: "",
  bodyFat: "",
  collectedAtBr: "",
  deviceName: "InBody",
  deviceCustomName: "",
  deviceModel: "",
};

function brDateToIso(br: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(br.trim());
  if (!m) return null;
  const dayStr = m[1];
  const monthStr = m[2];
  const yearStr = m[3];
  if (
    dayStr === undefined ||
    monthStr === undefined ||
    yearStr === undefined
  ) {
    return null;
  }
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${yearStr}-${monthStr.padStart(2, "0")}-${dayStr.padStart(2, "0")}`;
}

function validate(state: FormState): {
  errors: FieldErrors;
  payload: BiaSubmissionInput | null;
} {
  const errors: FieldErrors = {};
  const visceralFat = parseBrazilianDecimal(state.visceralFat);
  if (visceralFat === null || visceralFat <= 0) {
    errors.visceralFat =
      state.visceralFat.trim().length === 0
        ? BIA_FIELD_REQUIRED_PT_BR
        : BIA_FIELD_NUMBER_INVALID_PT_BR;
  }
  const skeletalMuscle = parseBrazilianDecimal(state.skeletalMuscle);
  if (skeletalMuscle === null || skeletalMuscle <= 0) {
    errors.skeletalMuscle =
      state.skeletalMuscle.trim().length === 0
        ? BIA_FIELD_REQUIRED_PT_BR
        : BIA_FIELD_NUMBER_INVALID_PT_BR;
  }
  const bodyFat = parseBrazilianDecimal(state.bodyFat);
  if (bodyFat === null || bodyFat < 0 || bodyFat > 100) {
    errors.bodyFat =
      state.bodyFat.trim().length === 0
        ? BIA_FIELD_REQUIRED_PT_BR
        : BIA_FIELD_NUMBER_INVALID_PT_BR;
  }
  const iso = brDateToIso(state.collectedAtBr);
  if (iso === null) {
    errors.collectedAtBr =
      state.collectedAtBr.trim().length === 0
        ? BIA_FIELD_REQUIRED_PT_BR
        : BIA_FIELD_DATE_INVALID_PT_BR;
  }
  if (
    state.deviceName === "Outro" &&
    state.deviceCustomName.trim().length === 0
  ) {
    errors.deviceCustomName = BIA_FIELD_REQUIRED_PT_BR;
  }
  if (
    Object.keys(errors).length > 0 ||
    visceralFat === null ||
    skeletalMuscle === null ||
    bodyFat === null ||
    iso === null
  ) {
    return { errors, payload: null };
  }
  const payload: BiaSubmissionInput = {
    visceralFatAreaCm2: visceralFat,
    skeletalMuscleMassKg: skeletalMuscle,
    bodyFatPercentage: bodyFat,
    collectedAt: iso,
    deviceName: state.deviceName,
    ...(state.deviceName === "Outro"
      ? { deviceCustomName: state.deviceCustomName.trim() }
      : {}),
    ...(state.deviceModel.trim().length > 0
      ? { deviceModel: state.deviceModel.trim() }
      : {}),
  };
  return { errors: {}, payload };
}

export default function BiaScreen() {
  const [state, setState] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.observations.submitBia.mutationOptions({
      onSuccess: (data, variables) => {
        if (data.status === "duplicate" && !variables.overwrite) {
          Alert.alert(BIA_DUPLICATE_MODAL_TITLE_PT_BR, undefined, [
            { text: BIA_DUPLICATE_MODAL_CANCEL_PT_BR, style: "cancel" },
            {
              text: BIA_DUPLICATE_MODAL_CONFIRM_PT_BR,
              onPress: () => mutation.mutate({ ...variables, overwrite: true }),
            },
          ]);
          return;
        }
        router.back();
      },
      onError: () => {
        setSubmitError(BIA_SUBMIT_ERROR_PT_BR);
      },
    }),
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit() {
    setSubmitError(null);
    const { errors: nextErrors, payload } = validate(state);
    setErrors(nextErrors);
    if (!payload) return;
    mutation.mutate(payload);
  }

  const isPending = mutation.isPending;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: BIA_FORM_TITLE_PT_BR }} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <YStack gap="$3">
          <Text fontSize="$7" fontWeight="700">
            {BIA_FORM_TITLE_PT_BR}
          </Text>
          <Field
            label={BIA_FIELD_VISCERAL_FAT_PT_BR}
            value={state.visceralFat}
            onChange={(v) => set("visceralFat", v)}
            error={errors.visceralFat}
            keyboardType="decimal-pad"
            disabled={isPending}
          />
          <Field
            label={BIA_FIELD_SKELETAL_MUSCLE_PT_BR}
            value={state.skeletalMuscle}
            onChange={(v) => set("skeletalMuscle", v)}
            error={errors.skeletalMuscle}
            keyboardType="decimal-pad"
            disabled={isPending}
          />
          <Field
            label={BIA_FIELD_BODY_FAT_PT_BR}
            value={state.bodyFat}
            onChange={(v) => set("bodyFat", v)}
            error={errors.bodyFat}
            keyboardType="decimal-pad"
            disabled={isPending}
          />
          <Field
            label={BIA_FIELD_COLLECTED_AT_PT_BR}
            value={state.collectedAtBr}
            onChange={(v) => set("collectedAtBr", v)}
            error={errors.collectedAtBr}
            placeholder="dd/mm/aaaa"
            disabled={isPending}
          />
          <YStack gap="$1">
            <Text fontSize="$2" color="$textSecondary">
              {BIA_FIELD_DEVICE_NAME_PT_BR}
            </Text>
            <YStack gap="$1">
              {BIA_DEVICE_NAMES.map((name) => (
                <Button
                  key={name}
                  onPress={() => set("deviceName", name)}
                  disabled={isPending}
                  backgroundColor={
                    state.deviceName === name
                      ? "$primaryTeal"
                      : "$surfaceElevated"
                  }
                >
                  {name}
                </Button>
              ))}
            </YStack>
          </YStack>
          {state.deviceName === "Outro" ? (
            <Field
              label={BIA_FIELD_DEVICE_CUSTOM_NAME_PT_BR}
              value={state.deviceCustomName}
              onChange={(v) => set("deviceCustomName", v)}
              error={errors.deviceCustomName}
              disabled={isPending}
            />
          ) : null}
          <Field
            label={BIA_FIELD_DEVICE_MODEL_PT_BR}
            value={state.deviceModel}
            onChange={(v) => set("deviceModel", v)}
            disabled={isPending}
          />
          {submitError !== null ? (
            <Text accessibilityRole="alert" color="$errorRed">
              {submitError}
            </Text>
          ) : null}
          <Button onPress={onSubmit} disabled={isPending}>
            {BIA_SUBMIT_CTA_PT_BR}
          </Button>
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  keyboardType?: "decimal-pad" | "default";
  placeholder?: string;
  disabled?: boolean;
}

function Field({
  label,
  value,
  onChange,
  error,
  keyboardType,
  placeholder,
  disabled,
}: FieldProps) {
  return (
    <YStack gap="$1">
      <Text fontSize="$2" color="$textSecondary">
        {label}
      </Text>
      <Input
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? "default"}
        placeholder={placeholder}
        editable={!disabled}
      />
      {error !== undefined ? (
        <Text fontSize="$1" color="$warningAmber">
          {error}
        </Text>
      ) : null}
    </YStack>
  );
}
