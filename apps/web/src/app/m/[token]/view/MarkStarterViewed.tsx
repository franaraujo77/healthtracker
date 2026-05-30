"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";

import { ShareTokenProvider, useTRPC } from "~/trpc/react";

/**
 * Story 6.2 R1-H1 fix-up — one-shot audit emission.
 *
 * Mounts when the report is `ready` (either from the initial RSC hit
 * or after `<ConversationStarterPolling>` flipped to ready). Fires
 * `sharing.markStarterViewed` exactly once per mount; the resolver
 * writes the `share_token.read post-auth` audit row.
 *
 * The polling `getConversationStarter` resolver is now read-only —
 * audit lives here so the patient's Access Log gets ONE row per
 * doctor view instead of one per polling tick.
 *
 * Idempotency: a strict-mode double-invoke is collapsed via a ref
 * guard. A hard reload legitimately emits a fresh row (patient wants
 * re-visit surveillance).
 */
export interface MarkStarterViewedProps {
  shareTokenId: string;
  tokenHmac: string;
}

function MarkBody(props: MarkStarterViewedProps): null {
  const trpc = useTRPC();
  const firedRef = useRef(false);
  const mutation = useMutation(
    trpc.sharing.markStarterViewed.mutationOptions(),
  );
  const mutate = mutation.mutate;
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    mutate({
      shareTokenId: props.shareTokenId,
      tokenHmac: props.tokenHmac,
    });
    // Mutation failures do not surface to the doctor; the resolver's
    // narrow catch around `writeAuditLog` already swallows write
    // errors to a console.warn (the report itself is not gated on
    // the audit).
  }, [mutate, props.shareTokenId, props.tokenHmac]);
  return null;
}

export function MarkStarterViewed(
  props: MarkStarterViewedProps,
): React.ReactElement {
  return (
    <ShareTokenProvider shareTokenId={props.shareTokenId}>
      <MarkBody {...props} />
    </ShareTokenProvider>
  );
}
