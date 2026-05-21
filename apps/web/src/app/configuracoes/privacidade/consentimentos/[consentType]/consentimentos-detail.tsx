"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ConsentScreenType } from "@healthtracker/validators";
import { Button } from "@healthtracker/ui/button";
import {
  CONSENT_GRANTED_ON_LABEL_PT_BR,
  CONSENT_REVOKE_CONFIRM_PRIMARY_PT_BR,
  CONSENT_REVOKE_CONFIRM_SECONDARY_PT_BR,
  CONSENT_REVOKE_CONFIRM_TITLE_PT_BR,
  CONSENT_REVOKE_CTA_PT_BR,
  CONSENT_REVOKE_DATA_RETENTION_PT_BR,
  CONSENT_SCREEN_COPY,
  CONSENT_VERSION_LABEL_PT_BR,
  formatConsentGrantedDate,
  GENERIC_CONSENT_ERROR_MESSAGE_PT_BR,
  WEB_MEUS_CONSENTIMENTOS_ROUTE,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

interface ConsentimentosDetailProps {
  consentType: ConsentScreenType;
  /** Threaded from the list row (review P24). */
  version?: string;
  /** ISO-string Date threaded from the list row (review P24). */
  grantedAt?: string;
}

export function ConsentimentosDetail({
  consentType,
  version,
  grantedAt,
}: ConsentimentosDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const copy = CONSENT_SCREEN_COPY[consentType];
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = useMutation(
    trpc.consent.revoke.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.consent.list.queryKey(),
        });
        setConfirmOpen(false);
        router.push(WEB_MEUS_CONSENTIMENTOS_ROUTE);
      },
      onError: () => {
        setError(GENERIC_CONSENT_ERROR_MESSAGE_PT_BR);
      },
    }),
  );

  // Review P30 — A11y dialog pattern: dismiss on Escape. Backdrop
  // click handled inline on the overlay element below.
  // Round-2 P33 — symmetric with the backdrop click handler, ignore
  // Escape while the revoke mutation is in flight so the user can't
  // accidentally close the confirmation UI while the network call is
  // still pending (the destructive button is already `disabled`).
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !revoke.isPending) setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, revoke.isPending]);

  function handleConfirm() {
    setError(null);
    revoke.mutate({ consentType });
  }

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{copy.title}</h1>
        {/* Review P24 — render the row's actual version + grantedAt. */}
        {version ? (
          <p className="text-xs text-stone-500">
            {CONSENT_VERSION_LABEL_PT_BR}: {version}
          </p>
        ) : null}
        {grantedAt ? (
          <p className="text-xs text-stone-500">
            {CONSENT_GRANTED_ON_LABEL_PT_BR}{" "}
            {formatConsentGrantedDate(grantedAt)}
          </p>
        ) : null}
      </header>
      <p className="text-base leading-relaxed">{copy.body}</p>
      <div className="space-y-2 text-sm text-stone-700">
        <p>{copy.declineConsequence}</p>
        <p>{CONSENT_REVOKE_DATA_RETENTION_PT_BR}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-amber-700">
          {error}
        </p>
      ) : null}

      <Button
        variant="destructive"
        onPress={() => setConfirmOpen(true)}
        disabled={revoke.isPending}
      >
        {CONSENT_REVOKE_CTA_PT_BR}
      </Button>

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-confirm-title"
          // Review P30 — dismiss on backdrop click. The condition
          // `target === currentTarget` distinguishes a backdrop tap
          // from a tap inside the dialog content (which bubbles up).
          onClick={(e) => {
            if (e.target === e.currentTarget && !revoke.isPending) {
              setConfirmOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-xl">
            <h2 id="revoke-confirm-title" className="text-lg font-semibold">
              {CONSENT_REVOKE_CONFIRM_TITLE_PT_BR}
            </h2>
            <p className="text-sm text-stone-700">{copy.declineConsequence}</p>
            <p className="text-sm text-stone-700">
              {CONSENT_REVOKE_DATA_RETENTION_PT_BR}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onPress={() => setConfirmOpen(false)}
                disabled={revoke.isPending}
              >
                {CONSENT_REVOKE_CONFIRM_SECONDARY_PT_BR}
              </Button>
              <Button
                variant="destructive"
                onPress={handleConfirm}
                disabled={revoke.isPending}
              >
                {CONSENT_REVOKE_CONFIRM_PRIMARY_PT_BR}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
