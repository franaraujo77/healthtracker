"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import {
  COMPARTILHAR_BACK_PT_BR,
  COMPARTILHAR_LOADING_PT_BR,
  COMPARTILHAR_RESUMO_TITLE_PT_BR,
  COMPARTILHAR_ROUTE,
  SHARE_SUBMIT_BUTTON_PT_BR,
  SHARE_SUMMARY_PT_BR_FN,
  SHARE_TOKEN_INVALID_PT_BR,
  SHARE_URL_COPIED_PT_BR,
  SHARE_URL_ERROR_PT_BR,
} from "@healthtracker/validators";

import { useTRPC, useTRPCClient } from "~/trpc/react";

/**
 * Story 5.2 T6.6 — web parity for the resumo screen. Same flow as
 * the Expo route. `navigator.share` is preferred; if unavailable
 * we fall back to `navigator.clipboard.writeText` and a Toast-equivalent
 * status message.
 */
export default function ResumoPage(props: {
  params: Promise<{ shareTokenId: string }>;
}): React.ReactElement {
  const { shareTokenId } = use(props.params);
  const router = useRouter();
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const draft = useQuery(
    trpc.sharing.getDraftConfig.queryOptions({ shareTokenId }),
  );

  if (draft.isError) {
    return (
      <main style={{ padding: 24 }}>
        <p>{SHARE_TOKEN_INVALID_PT_BR}</p>
        <Button
          variant="secondary"
          onPress={() => router.replace(COMPARTILHAR_ROUTE)}
        >
          {COMPARTILHAR_BACK_PT_BR}
        </Button>
      </main>
    );
  }
  if (!draft.data) {
    return <main style={{ padding: 24 }}>{COMPARTILHAR_LOADING_PT_BR}</main>;
  }

  // Story 5.2 review-fix Decision A — read persisted duration enum.
  const duration = draft.data.shareToken.duration;
  const visibleLabels = draft.data.biomarkerScope
    .filter((s) => s.visible)
    .map((s) => s.label);
  const summary = SHARE_SUMMARY_PT_BR_FN(
    draft.data.doctor.displayName,
    visibleLabels,
    duration,
  );

  const handleSend = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const { url } = await trpcClient.sharing.getShareUrl.query({
        shareTokenId,
      });
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (nav && typeof nav.share === "function") {
        await nav.share({ url });
      } else {
        const clipboard = nav?.clipboard;
        if (clipboard && typeof clipboard.writeText === "function") {
          await clipboard.writeText(url);
          setStatus(SHARE_URL_COPIED_PT_BR);
        } else {
          setStatus(SHARE_URL_ERROR_PT_BR);
        }
      }
    } catch (err) {
      // Story 5.2 review-fix Patch #9 — `navigator.share` rejects
      // with `AbortError` when the user dismisses the OS share sheet.
      // That's not an error condition — silently no-op.
      if (err instanceof Error && err.name === "AbortError") return;
      setStatus(SHARE_URL_ERROR_PT_BR);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>{COMPARTILHAR_RESUMO_TITLE_PT_BR}</h1>
      <p>{summary}</p>
      <Button
        variant="secondary"
        disabled={submitting}
        onPress={() => {
          void handleSend();
        }}
      >
        {SHARE_SUBMIT_BUTTON_PT_BR}
      </Button>
      {status ? (
        <p aria-live="polite" style={{ marginTop: 12 }}>
          {status}
        </p>
      ) : null}
    </main>
  );
}
