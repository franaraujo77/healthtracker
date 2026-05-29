"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

import type { ProfessionalCategory } from "@healthtracker/validators";
import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";
import { Label } from "@healthtracker/ui/label";
import {
  INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR,
  PROFESSIONAL_ACTIVATION_CATEGORY_LABEL_PT_BR,
  PROFESSIONAL_ACTIVATION_CATEGORY_PLACEHOLDER_PT_BR,
  PROFESSIONAL_ACTIVATION_CATEGORY_REQUIRED_PT_BR,
  PROFESSIONAL_ACTIVATION_CONFLICT_PT_BR,
  PROFESSIONAL_ACTIVATION_CTA_LOADING_PT_BR,
  PROFESSIONAL_ACTIVATION_CTA_PT_BR,
  PROFESSIONAL_ACTIVATION_DISPLAY_NAME_LABEL_PT_BR,
  PROFESSIONAL_ACTIVATION_DISPLAY_NAME_REQUIRED_PT_BR,
  PROFESSIONAL_ACTIVATION_EMAIL_LABEL_PT_BR,
  PROFESSIONAL_ACTIVATION_GENERIC_ERROR_PT_BR,
  PROFESSIONAL_ACTIVATION_MODAL_HEADING_PT_BR,
  PROFESSIONAL_ACTIVATION_SUCCESS_PT_BR,
  PROFESSIONAL_CATEGORY_LABEL_PT_BR,
  PROFESSIONAL_CATEGORY_VALUES,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

/**
 * Story 6.3 AC2 — single-step activation form.
 *
 * Frictionless (UX-DR9): email pre-filled and read-only (the
 * authenticated identity IS the professional identity), display-name
 * pre-filled from the email local-part, category required.
 *
 * On success the modal swaps to an inline confirmation card and
 * invalidates the parent's `getActivationStatus` query so the banner
 * disappears without a re-mount. NO CRM / license collection (UX-DR9 +
 * spec AC2).
 */

export interface ProfessionalAccountModalProps {
  shareTokenId: string;
  tokenHmac: string;
  email: string;
  defaultDisplayName: string;
  onClose: () => void;
}

export function ProfessionalAccountModal(
  props: ProfessionalAccountModalProps,
): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement | null>(null);

  const [displayName, setDisplayName] = useState(props.defaultDisplayName);
  const [category, setCategory] = useState<ProfessionalCategory | "">("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation(
    trpc.sharing.activateProfessionalAccount.mutationOptions(),
  );
  const mutate = mutation.mutate;

  // Auto-dismiss the modal after a brief success window so the doctor
  // returns to the report. Cleanup cancels the timer if the parent
  // unmounts first.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => {
      props.onClose();
    }, 3000);
    return () => clearTimeout(t);
  }, [success, props]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mutation.isPending) return;
    const trimmedName = displayName.trim();
    if (trimmedName.length === 0) {
      setFieldError(PROFESSIONAL_ACTIVATION_DISPLAY_NAME_REQUIRED_PT_BR);
      return;
    }
    if (category === "") {
      setFieldError(PROFESSIONAL_ACTIVATION_CATEGORY_REQUIRED_PT_BR);
      return;
    }
    setFieldError(null);
    setSubmitError(null);
    mutate(
      {
        shareTokenId: props.shareTokenId,
        tokenHmac: props.tokenHmac,
        displayName: trimmedName,
        category,
      },
      {
        onSuccess: () => {
          // R1 reviewer note: invalidate the cached
          // `getActivationStatus` so the banner's owning component
          // re-renders without the banner. The RSC path does NOT
          // auto-revalidate; the client owns the reactivity here.
          void queryClient.invalidateQueries({
            queryKey: trpc.sharing.getActivationStatus.queryKey(),
          });
          setSuccess(true);
        },
        onError: (err) => {
          // Narrow on the CONFLICT message — the resolver throws
          // `code: "CONFLICT", message: INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR`
          // when a different doctor's uid already claimed the invite.
          // Narrow on the CONFLICT code via the tRPC error data shape;
          // `data?.code` is typed as `string | undefined`, so a direct
          // comparison is type-safe without an `any` indirection.
          const errCode =
            err instanceof TRPCClientError
              ? (err.data as { code?: string } | null)?.code
              : undefined;
          if (
            errCode === "CONFLICT" &&
            err instanceof TRPCClientError &&
            err.message === INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR
          ) {
            setSubmitError(PROFESSIONAL_ACTIVATION_CONFLICT_PT_BR);
            return;
          }
          setSubmitError(PROFESSIONAL_ACTIVATION_GENERIC_ERROR_PT_BR);
        },
      },
    );
  }

  if (success) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          background: "#f9fafb",
        }}
      >
        <p style={{ margin: 0 }}>{PROFESSIONAL_ACTIVATION_SUCCESS_PT_BR}</p>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prof-activation-heading"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <h2 id="prof-activation-heading" style={{ margin: 0, fontSize: 18 }}>
        {PROFESSIONAL_ACTIVATION_MODAL_HEADING_PT_BR}
      </h2>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label htmlFor="prof-email">
            {PROFESSIONAL_ACTIVATION_EMAIL_LABEL_PT_BR}
          </Label>
          {/*
           * AC2 — email is READ-ONLY. The authenticated identity is the
           * professional identity; an editable field here would be an
           * identity-binding bug.
           */}
          <Input
            id="prof-email"
            value={props.email}
            editable={false}
            aria-readonly
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label htmlFor="prof-display-name">
            {PROFESSIONAL_ACTIVATION_DISPLAY_NAME_LABEL_PT_BR}
          </Label>
          <Input
            id="prof-display-name"
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={80}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label htmlFor="prof-category">
            {PROFESSIONAL_ACTIVATION_CATEGORY_LABEL_PT_BR}
          </Label>
          {/*
           * Native `<select>` keeps the doctor surface dependency-light
           * (no Tamagui Sheet wiring on web). The closed enum mirror is
           * `PROFESSIONAL_CATEGORY_VALUES` from validators.
           */}
          <select
            id="prof-category"
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as ProfessionalCategory | "")
            }
            style={{
              padding: 8,
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "#fff",
              fontSize: 16,
            }}
          >
            <option value="" disabled>
              {PROFESSIONAL_ACTIVATION_CATEGORY_PLACEHOLDER_PT_BR}
            </option>
            {PROFESSIONAL_CATEGORY_VALUES.map((value) => (
              <option key={value} value={value}>
                {PROFESSIONAL_CATEGORY_LABEL_PT_BR[value]}
              </option>
            ))}
          </select>
        </div>

        {fieldError !== null && (
          <p role="alert" style={{ color: "#b45309", fontSize: 14, margin: 0 }}>
            {fieldError}
          </p>
        )}
        {submitError !== null && (
          <p role="alert" style={{ color: "#b45309", fontSize: 14, margin: 0 }}>
            {submitError}
          </p>
        )}

        <Button
          disabled={mutation.isPending}
          onPress={() => {
            formRef.current?.requestSubmit();
          }}
        >
          {mutation.isPending
            ? PROFESSIONAL_ACTIVATION_CTA_LOADING_PT_BR
            : PROFESSIONAL_ACTIVATION_CTA_PT_BR}
        </Button>
      </form>
    </div>
  );
}
