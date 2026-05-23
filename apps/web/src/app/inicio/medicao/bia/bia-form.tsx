"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import type {
  BiaDeviceName,
  BiaSubmissionInput,
} from "@healthtracker/validators";
import { Button } from "@healthtracker/ui/button";
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
  BIA_SUBMIT_SUCCESS_PT_BR,
  INICIO_ROUTE,
  parseBrazilianDecimal,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

interface FormState {
  visceralFat: string;
  skeletalMuscle: string;
  bodyFat: string;
  collectedAtBr: string; // dd/mm/yyyy
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

export function BiaForm() {
  const router = useRouter();
  const trpc = useTRPC();
  const [state, setState] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<BiaSubmissionInput | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  const mutation = useMutation(
    trpc.observations.submitBia.mutationOptions({
      onSuccess: (data, variables) => {
        if (data.status === "duplicate" && !variables.overwrite) {
          // Stash the payload so the modal's "Substituir" can resubmit.
          setDuplicate(variables);
          return;
        }
        setSuccessOpen(true);
        setTimeout(() => {
          router.push(INICIO_ROUTE);
        }, 800);
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

  function onConfirmOverwrite() {
    if (!duplicate) return;
    const payload: BiaSubmissionInput = { ...duplicate, overwrite: true };
    setDuplicate(null);
    mutation.mutate(payload);
  }

  const isPending = mutation.isPending;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{BIA_FORM_TITLE_PT_BR}</h1>
      <div className="flex flex-col gap-4">
        <Field
          label={BIA_FIELD_VISCERAL_FAT_PT_BR}
          value={state.visceralFat}
          onChange={(v) => set("visceralFat", v)}
          error={errors.visceralFat}
          inputMode="decimal"
          disabled={isPending}
        />
        <Field
          label={BIA_FIELD_SKELETAL_MUSCLE_PT_BR}
          value={state.skeletalMuscle}
          onChange={(v) => set("skeletalMuscle", v)}
          error={errors.skeletalMuscle}
          inputMode="decimal"
          disabled={isPending}
        />
        <Field
          label={BIA_FIELD_BODY_FAT_PT_BR}
          value={state.bodyFat}
          onChange={(v) => set("bodyFat", v)}
          error={errors.bodyFat}
          inputMode="decimal"
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-stone-700">{BIA_FIELD_DEVICE_NAME_PT_BR}</span>
          <select
            value={state.deviceName}
            onChange={(e) => set("deviceName", e.target.value as BiaDeviceName)}
            disabled={isPending}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-base"
          >
            {BIA_DEVICE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
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
          <p role="alert" className="text-sm text-red-700">
            {submitError}
          </p>
        ) : null}
        <Button onPress={onSubmit} disabled={isPending}>
          {BIA_SUBMIT_CTA_PT_BR}
        </Button>
      </div>

      {duplicate !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
        >
          <div className="flex max-w-md flex-col gap-4 rounded-lg bg-white p-6">
            <p className="text-base font-medium text-stone-900">
              {BIA_DUPLICATE_MODAL_TITLE_PT_BR}
            </p>
            <div className="flex gap-2">
              <Button onPress={() => setDuplicate(null)} disabled={isPending}>
                {BIA_DUPLICATE_MODAL_CANCEL_PT_BR}
              </Button>
              <Button onPress={onConfirmOverwrite} disabled={isPending}>
                {BIA_DUPLICATE_MODAL_CONFIRM_PT_BR}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {successOpen ? (
        <p role="status" className="text-sm text-teal-800">
          {BIA_SUBMIT_SUCCESS_PT_BR}
        </p>
      ) : null}
    </section>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  inputMode?: "decimal" | "text";
  placeholder?: string;
  disabled?: boolean;
}

function Field({
  label,
  value,
  onChange,
  error,
  inputMode,
  placeholder,
  disabled,
}: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-stone-700">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="rounded-md border border-stone-300 bg-white px-3 py-2 text-base"
      />
      {error !== undefined ? (
        <span className="text-xs text-amber-700">{error}</span>
      ) : null}
    </label>
  );
}
