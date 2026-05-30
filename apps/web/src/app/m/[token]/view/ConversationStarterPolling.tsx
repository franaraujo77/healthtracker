"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  CONVERSATION_STARTER_FAILED_PT_BR,
  CONVERSATION_STARTER_POLL_INTERVAL_MS,
  CONVERSATION_STARTER_POLL_TIMEOUT_MS,
  CONVERSATION_STARTER_PREPARING_PT_BR,
  CONVERSATION_STARTER_RETRY_CTA_PT_BR,
} from "@healthtracker/validators";

import { ShareTokenProvider, useTRPC } from "~/trpc/react";

/**
 * Story 6.2 AC8 / T5.5 — client-side polling for the `queued` cache
 * state.
 *
 * Polls `getConversationStarter` every 2s (AC8) until either:
 *   - `cacheStatus === "ready"` → the page re-renders (via parent
 *      RSC suspension on the wrapping Server Action — for this story
 *      we surface a "ready, refresh" hint and let the user reload),
 *   - 30s ceiling expires (AC8) → surface the `failed` copy + retry
 *     CTA,
 *   - `cacheStatus === "failed"` → render the pt-BR failure message.
 *
 * Header threading: the parent route mounts `<ShareTokenProvider>` at
 * the layout level so the polling tRPC call carries `x-share-token`
 * — `doctorProcedure` binds the RLS principal from this header.
 */

export interface ConversationStarterPollingProps {
  shareTokenId: string;
  tokenHmac: string;
}

function PollingBody(
  props: ConversationStarterPollingProps,
): React.ReactElement {
  const trpc = useTRPC();
  const startedAt = useRef<number | null>(null);
  const [givenUp, setGivenUp] = useState(false);
  // Initialize startedAt lazily in an effect — `Date.now()` at render
  // is impure per react-hooks/purity.
  useEffect(() => {
    startedAt.current ??= Date.now();
  }, []);

  const queryOptions = trpc.sharing.getConversationStarter.queryOptions(
    { shareTokenId: props.shareTokenId, tokenHmac: props.tokenHmac },
    {
      refetchInterval: (q) => {
        const data = q.state.data;
        if (givenUp) return false;
        if (data?.cacheStatus === "ready") return false;
        if (data?.cacheStatus === "failed") return false;
        return CONVERSATION_STARTER_POLL_INTERVAL_MS;
      },
      refetchOnWindowFocus: false,
    },
  );
  const query = useQuery(queryOptions);

  useEffect(() => {
    if (givenUp) return;
    if (startedAt.current === null) return;
    const elapsed = Date.now() - startedAt.current;
    const remaining = CONVERSATION_STARTER_POLL_TIMEOUT_MS - elapsed;
    // Always schedule a setTimeout (even with `remaining <= 0`, fires
    // on next tick) — avoids synchronous setState-in-effect.
    // R1-L4: cleanup runs on every `dataUpdatedAt` change. When polling
    // flips to `ready`, refetchInterval stops polling AND this effect
    // re-runs (dataUpdatedAt changed) — the cleanup clears the timer,
    // so `setGivenUp(true)` never fires after the report rendered.
    const t = setTimeout(() => setGivenUp(true), remaining > 0 ? remaining : 0);
    return () => clearTimeout(t);
  }, [givenUp, query.dataUpdatedAt]);

  const status = query.data?.cacheStatus;

  if (status === "ready") {
    // The view RSC renders the ready payload directly; this component
    // is mounted only when the initial fetch was queued. When the
    // polling flips to ready we show a "ready" notice so the doctor
    // can reload to see the report. (A full client-render of the
    // payload would duplicate the RSC.)
    return (
      <div role="status" style={{ padding: 12 }}>
        <p>O sumário está pronto. Atualize a página para visualizar.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "8px 14px",
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Atualizar
        </button>
      </div>
    );
  }

  if (status === "failed" || givenUp) {
    return (
      <div role="alert" style={{ padding: 12 }}>
        <p>{CONVERSATION_STARTER_FAILED_PT_BR}</p>
        <button
          type="button"
          onClick={() => {
            startedAt.current = Date.now();
            setGivenUp(false);
            void query.refetch();
          }}
          style={{
            padding: "8px 14px",
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          {CONVERSATION_STARTER_RETRY_CTA_PT_BR}
        </button>
      </div>
    );
  }

  return (
    <div role="status" style={{ padding: 12 }}>
      <p>{CONVERSATION_STARTER_PREPARING_PT_BR}</p>
    </div>
  );
}

export function ConversationStarterPolling(
  props: ConversationStarterPollingProps,
): React.ReactElement {
  return (
    <ShareTokenProvider shareTokenId={props.shareTokenId}>
      <PollingBody {...props} />
    </ShareTokenProvider>
  );
}
