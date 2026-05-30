"use client";

import { useState } from "react";

import { INVITE_PATIENT_BUTTON_PT_BR } from "@healthtracker/validators";

import { ShareTokenProvider } from "~/trpc/react";
import { InvitePatientModal } from "./InvitePatientModal";

/**
 * Story 6.4 AC1 — Tier-1 "Convidar paciente" CTA.
 *
 * Rendered in the slot where Story 6.3's `<ProfessionalAccountBanner>`
 * sat for unactivated doctors. The page chooses banner-OR-button based
 * on `activationStatus.activated` (mutually exclusive); per UX-DR20 the
 * Tier-1 action slot at report close is reserved for "convide o
 * paciente" once the doctor is activated.
 *
 * Styling mirrors the activation banner — Tier-2 muted-neutral surface
 * (NOT a primary brand color) so the doctor's eye stays on the report;
 * the CTA itself uses a standard border button. UX-DR16 — no raw hex.
 */
export interface InvitePatientButtonProps {
  shareTokenId: string;
}

function ButtonBody(props: { onOpen: () => void }): React.ReactElement {
  // **R1-M3 fix.** Previously both the wrapping `<section>` and the
  // inner `<button>` carried `aria-label={INVITE_PATIENT_BUTTON_PT_BR}`,
  // so screen-reader users heard "Convidar paciente" twice. Identify
  // the section via the `<strong>` heading (`aria-labelledby`) so the
  // accessible name flows from the visible label exactly once.
  return (
    <section
      aria-labelledby="invite-patient-heading"
      className="border-border bg-muted mt-4 flex items-center gap-3 rounded-md border p-4"
    >
      <div className="flex flex-1 flex-col gap-1">
        <strong id="invite-patient-heading" className="text-[15px]">
          {INVITE_PATIENT_BUTTON_PT_BR}
        </strong>
      </div>
      <button
        type="button"
        onClick={props.onOpen}
        className="border-border bg-background cursor-pointer rounded-md border px-3.5 py-2 text-sm"
      >
        {INVITE_PATIENT_BUTTON_PT_BR}
      </button>
    </section>
  );
}

export function InvitePatientButton(
  props: InvitePatientButtonProps,
): React.ReactElement {
  const [open, setOpen] = useState(false);
  // The modal's mutation is doctorProcedure-bound; reuse the
  // `<ShareTokenProvider>` pattern Story 6.3 established so the tRPC
  // link emits the `x-share-token` header.
  return (
    <ShareTokenProvider shareTokenId={props.shareTokenId}>
      {open ? (
        <section aria-label="Convidar paciente (modal)" className="mt-4">
          <InvitePatientModal onClose={() => setOpen(false)} />
        </section>
      ) : (
        <ButtonBody onOpen={() => setOpen(true)} />
      )}
    </ShareTokenProvider>
  );
}
