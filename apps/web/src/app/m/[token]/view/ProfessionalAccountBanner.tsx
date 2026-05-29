"use client";

import { useState } from "react";

import {
  PROFESSIONAL_ACTIVATION_BANNER_CTA_PT_BR,
  PROFESSIONAL_ACTIVATION_BANNER_DISMISS_A11Y_PT_BR,
  PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR,
  PROFESSIONAL_ACTIVATION_BANNER_SUBHEADING_PT_BR,
} from "@healthtracker/validators";

import { ShareTokenProvider } from "~/trpc/react";
import { ProfessionalAccountModal } from "./ProfessionalAccountModal";

/**
 * Story 6.3 AC1 — professional-account activation banner.
 *
 * Rendered below the biomarker-card grid in the report view when
 * (cacheStatus === "ready") AND the doctor is NOT yet activated. UX-DR9
 * framing: "offer, not gate" — muted-neutral surface (Tier-2), NOT a
 * primary brand color. The Tier-1 action slot at report close is
 * reserved for Story 6.4's "Invite [patient] to share more" CTA.
 *
 * Dismiss is per-session in-memory only (intentional — spec T5.2 open
 * question deferred to product review).
 */

export interface ProfessionalAccountBannerProps {
  shareTokenId: string;
  tokenHmac: string;
  email: string;
  defaultDisplayName: string;
}

function BannerBody(
  props: ProfessionalAccountBannerProps,
): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (open) {
    return (
      <section
        aria-label={PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR}
        style={{ marginTop: 16 }}
      >
        <ProfessionalAccountModal
          shareTokenId={props.shareTokenId}
          tokenHmac={props.tokenHmac}
          email={props.email}
          defaultDisplayName={props.defaultDisplayName}
          onClose={() => setOpen(false)}
        />
      </section>
    );
  }

  return (
    <section
      aria-label={PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR}
      style={{
        marginTop: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 16,
        // Muted-neutral surface — Tier-2 per UX-DR9 ("offer not gate")
        // and UX-DR16 (no primary brand color in this slot).
        background: "#f3f4f6",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}
      >
        <strong style={{ fontSize: 15 }}>
          {PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR}
        </strong>
        <span style={{ fontSize: 14, color: "#4b5563" }}>
          {PROFESSIONAL_ACTIVATION_BANNER_SUBHEADING_PT_BR}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 14px",
          border: "1px solid #9ca3af",
          background: "#fff",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 14,
        }}
      >
        {PROFESSIONAL_ACTIVATION_BANNER_CTA_PT_BR}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={PROFESSIONAL_ACTIVATION_BANNER_DISMISS_A11Y_PT_BR}
        style={{
          padding: "4px 8px",
          border: "none",
          background: "transparent",
          color: "#6b7280",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </section>
  );
}

export function ProfessionalAccountBanner(
  props: ProfessionalAccountBannerProps,
): React.ReactElement {
  // The modal's mutation needs the `x-share-token` header; the banner
  // hosts the provider so the entire activation flow shares the
  // context. Mirrors `<MarkStarterViewed>` / `<ConversationStarterPolling>`.
  return (
    <ShareTokenProvider shareTokenId={props.shareTokenId}>
      <BannerBody {...props} />
    </ShareTokenProvider>
  );
}
