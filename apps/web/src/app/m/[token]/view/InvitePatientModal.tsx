"use client";

import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";
import { Label } from "@healthtracker/ui/label";
import {
  INVITE_PATIENT_ALREADY_REGISTERED_PT_BR,
  INVITE_PATIENT_CLOSE_PT_BR,
  INVITE_PATIENT_COPY_LINK_PT_BR,
  INVITE_PATIENT_COPY_LINK_TOAST_PT_BR,
  INVITE_PATIENT_CTA_LOADING_PT_BR,
  INVITE_PATIENT_CTA_PT_BR,
  INVITE_PATIENT_DISPLAY_NAME_LABEL_PT_BR,
  INVITE_PATIENT_GENERIC_ERROR_PT_BR,
  INVITE_PATIENT_IDENTIFIER_INVALID_PT_BR,
  INVITE_PATIENT_IDENTIFIER_LABEL_PT_BR,
  INVITE_PATIENT_IDENTIFIER_PLACEHOLDER_PT_BR,
  INVITE_PATIENT_MODAL_HEADING_PT_BR,
  INVITE_PATIENT_MODAL_SUBHEADING_PT_BR,
  INVITE_PATIENT_SUCCESS_BODY_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

/**
 * Story 6.4 AC1 — single-step "Convidar paciente" form.
 *
 * Fields: identifier (email or BR phone) + optional display name.
 * Server-side `normalizePatientIdentifier` discriminates the kind and
 * the resolver returns `alreadyRegistered:true` (already-an-HT-user)
 * OR `{ inviteUrl }` (success). The success card surfaces the URL +
 * a "Copiar link" button; the doctor self-distributes via WhatsApp /
 * email / SMS — NO transactional send for MVP (spec AC2).
 *
 * UX-DR16 — Tamagui / Tailwind tokens only, no raw hex.
 */
export interface InvitePatientModalProps {
  onClose: () => void;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; inviteUrl: string }
  | { kind: "already_registered" }
  | { kind: "error"; message: string };

export function InvitePatientModal(
  props: InvitePatientModalProps,
): React.ReactElement {
  const trpc = useTRPC();
  const formRef = useRef<HTMLFormElement | null>(null);
  const reactId = useId();
  const identifierId = `${reactId}-invite-identifier`;
  const displayNameId = `${reactId}-invite-display-name`;
  const headingId = `${reactId}-invite-heading`;

  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const mutation = useMutation(
    trpc.sharing.createPatientInvite.mutationOptions(),
  );
  const mutate = mutation.mutate;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitState.kind === "submitting") return;
    const trimmedIdentifier = identifier.trim();
    if (trimmedIdentifier.length === 0) {
      setSubmitState({
        kind: "error",
        message: INVITE_PATIENT_IDENTIFIER_INVALID_PT_BR,
      });
      return;
    }
    setSubmitState({ kind: "submitting" });
    const trimmedDisplay = displayName.trim();
    mutate(
      {
        identifier: trimmedIdentifier,
        displayName: trimmedDisplay.length > 0 ? trimmedDisplay : null,
      },
      {
        onSuccess: (data) => {
          if (data.alreadyRegistered) {
            setSubmitState({ kind: "already_registered" });
            return;
          }
          if (data.inviteUrl !== null) {
            setSubmitState({ kind: "success", inviteUrl: data.inviteUrl });
            return;
          }
          setSubmitState({
            kind: "error",
            message: INVITE_PATIENT_GENERIC_ERROR_PT_BR,
          });
        },
        onError: (err) => {
          // Narrow on the BAD_REQUEST identifier-invalid branch — the
          // resolver throws `code: "BAD_REQUEST"` with message
          // `PATIENT_IDENTIFIER_INVALID` when normalize fails.
          const errMsg = err.message;
          if (errMsg === "PATIENT_IDENTIFIER_INVALID") {
            setSubmitState({
              kind: "error",
              message: INVITE_PATIENT_IDENTIFIER_INVALID_PT_BR,
            });
            return;
          }
          setSubmitState({
            kind: "error",
            message: INVITE_PATIENT_GENERIC_ERROR_PT_BR,
          });
        },
      },
    );
  }

  function handleCopy() {
    if (submitState.kind !== "success") return;
    const url = submitState.inviteUrl;
    // `navigator.clipboard.writeText` is a Promise; ignore the failure
    // path (no clipboard permission etc.) — the URL is still visible.
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
      () => {
        // Clipboard write denied — silent; doctor reads URL from DOM.
      },
    );
  }

  if (submitState.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-border bg-card flex flex-col gap-3 rounded-md border p-4"
      >
        <h2 className="m-0 text-lg">{INVITE_PATIENT_MODAL_HEADING_PT_BR}</h2>
        <p className="m-0">{INVITE_PATIENT_SUCCESS_BODY_PT_BR}</p>
        <div className="border-border bg-muted flex items-center gap-2 rounded border p-2">
          <code className="text-muted-foreground flex-1 overflow-x-auto text-xs">
            {submitState.inviteUrl}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="border-border bg-background cursor-pointer rounded border px-2 py-1 text-xs"
          >
            {INVITE_PATIENT_COPY_LINK_PT_BR}
          </button>
        </div>
        {copied && (
          <span className="text-muted-foreground text-xs">
            {INVITE_PATIENT_COPY_LINK_TOAST_PT_BR}
          </span>
        )}
        <button
          type="button"
          onClick={props.onClose}
          className="border-border bg-background cursor-pointer self-start rounded border px-3 py-1.5 text-sm"
        >
          {INVITE_PATIENT_CLOSE_PT_BR}
        </button>
      </div>
    );
  }

  if (submitState.kind === "already_registered") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-border bg-card flex flex-col gap-3 rounded-md border p-4"
      >
        <h2 className="m-0 text-lg">{INVITE_PATIENT_MODAL_HEADING_PT_BR}</h2>
        <p className="m-0">{INVITE_PATIENT_ALREADY_REGISTERED_PT_BR}</p>
        <button
          type="button"
          onClick={props.onClose}
          className="border-border bg-background cursor-pointer self-start rounded border px-3 py-1.5 text-sm"
        >
          {INVITE_PATIENT_CLOSE_PT_BR}
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="border-border bg-card flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id={headingId} className="m-0 text-lg">
        {INVITE_PATIENT_MODAL_HEADING_PT_BR}
      </h2>
      <p className="text-muted-foreground m-0 text-sm">
        {INVITE_PATIENT_MODAL_SUBHEADING_PT_BR}
      </p>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={identifierId}>
            {INVITE_PATIENT_IDENTIFIER_LABEL_PT_BR}
          </Label>
          <Input
            id={identifierId}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={INVITE_PATIENT_IDENTIFIER_PLACEHOLDER_PT_BR}
            autoCapitalize="none"
            autoComplete="off"
            maxLength={254}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={displayNameId}>
            {INVITE_PATIENT_DISPLAY_NAME_LABEL_PT_BR}
          </Label>
          <Input
            id={displayNameId}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={80}
          />
        </div>
        {submitState.kind === "error" && (
          <p role="alert" className="text-destructive m-0 text-sm">
            {submitState.message}
          </p>
        )}
        <Button
          disabled={submitState.kind === "submitting"}
          onPress={() => {
            formRef.current?.requestSubmit();
          }}
        >
          {submitState.kind === "submitting"
            ? INVITE_PATIENT_CTA_LOADING_PT_BR
            : INVITE_PATIENT_CTA_PT_BR}
        </Button>
      </form>
    </div>
  );
}
