"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { GetActivationStatusOutput } from "@healthtracker/validators";
import {
  PROFESSIONAL_ACTIVATION_BANNER_CTA_PT_BR,
  PROFESSIONAL_ACTIVATION_BANNER_DISMISS_A11Y_PT_BR,
  PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR,
  PROFESSIONAL_ACTIVATION_BANNER_SUBHEADING_PT_BR,
} from "@healthtracker/validators";

import { ShareTokenProvider, useTRPC } from "~/trpc/react";
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
 *
 * R1-H1 fix-up (Option A): the banner subscribes a client `useQuery`
 * to `getActivationStatus` with the RSC-fetched value as
 * `initialData`. The modal's `invalidateQueries` on success then
 * triggers a refetch that flips `data.activated` to `true` here, so
 * the banner unmounts WITHOUT a full RSC re-render. Previously the
 * RSC owned the value and `invalidateQueries` invalidated a cache
 * key with no subscriber → the banner reappeared after the success
 * toast (the H1 bug).
 *
 * R1-M3 fix-up: styling uses Tailwind tokens that resolve to the
 * theme CSS variables (`bg-muted`, `border-border`,
 * `text-muted-foreground`) — see `tooling/tailwind/theme.css`.
 * UX-DR16 token discipline; no raw hex colors.
 */

export interface ProfessionalAccountBannerProps {
  shareTokenId: string;
  tokenHmac: string;
  email: string;
  defaultDisplayName: string;
  /**
   * RSC-fetched value used as `initialData` for the client query so
   * the first paint matches the server-rendered DOM. Refetch on
   * `invalidateQueries` (from the modal's success path) takes over
   * afterwards.
   */
  initialActivationStatus: GetActivationStatusOutput;
}

function BannerBody(
  props: ProfessionalAccountBannerProps,
): React.ReactElement | null {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const activationQuery = useQuery(
    trpc.sharing.getActivationStatus.queryOptions(
      {},
      {
        initialData: props.initialActivationStatus,
        // The RSC already ran the resolver immediately before this
        // mount; no need to refetch on hydration. The next refetch
        // is driven by the modal's `invalidateQueries` on success.
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    ),
  );

  if (activationQuery.data.activated) return null;
  if (dismissed) return null;

  if (open) {
    return (
      <section
        // R1-N2: distinct aria-label for the modal-host vs the
        // banner — the dialog inside owns `aria-modal`; this wrapper
        // names the surface as a modal host so screen readers don't
        // read the banner copy after the modal opens.
        aria-label="Ativação de conta profissional (modal)"
        className="mt-4"
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
      // Muted-neutral surface — Tier-2 per UX-DR9 ("offer not gate")
      // and UX-DR16 (no primary brand color in this slot). All
      // colors via theme tokens, no inline hex.
      className="border-border bg-muted mt-4 flex items-center gap-3 rounded-md border p-4"
    >
      <div className="flex flex-1 flex-col gap-1">
        <strong className="text-[15px]">
          {PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR}
        </strong>
        <span className="text-muted-foreground text-sm">
          {PROFESSIONAL_ACTIVATION_BANNER_SUBHEADING_PT_BR}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border bg-background cursor-pointer rounded-md border px-3.5 py-2 text-sm"
      >
        {PROFESSIONAL_ACTIVATION_BANNER_CTA_PT_BR}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={PROFESSIONAL_ACTIVATION_BANNER_DISMISS_A11Y_PT_BR}
        className="text-muted-foreground cursor-pointer border-none bg-transparent px-2 py-1 text-lg leading-none"
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
  //
  // R1-L1 follow-up: three subtrees in this page each mount their
  // own `<ShareTokenProvider>`. Today they all pass the same
  // shareTokenId so the module-scope holder is last-write-wins-with-
  // identical-values (safe). Future story should lift the provider
  // to the route layout (spec T5.6 deferred-work entry); a sibling
  // mount with a different id would silently win/lose.
  return (
    <ShareTokenProvider shareTokenId={props.shareTokenId}>
      <BannerBody {...props} />
    </ShareTokenProvider>
  );
}
