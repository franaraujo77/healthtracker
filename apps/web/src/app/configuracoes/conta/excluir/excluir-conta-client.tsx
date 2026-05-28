"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { DeleteAccountConfirmationCard } from "@healthtracker/ui";
import {
  DELETE_ACCOUNT_CANCELLED_TOAST_PT_BR,
  DELETE_ACCOUNT_FAILED_PT_BR,
  DELETE_ACCOUNT_HEADER_PT_BR,
} from "@healthtracker/validators";

import { createSupabaseClient } from "~/auth/client";
import { useTRPC } from "~/trpc/react";

/**
 * Story 5.6 T6.3 — web parity client. Same flow as the Expo screen:
 * input → 30s cooldown → mutation → sign out → `/auth/login`.
 *
 * Single-use per ceremony; no URL persistence (the parent screen
 * remounts on every navigation, the server-side request row is
 * idempotent via the partial unique index).
 */
export function ExcluirContaClient(): React.ReactElement {
  const trpc = useTRPC();
  const router = useRouter();
  const [resetKey, setResetKey] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const requestMutation = useMutation(
    trpc.account.requestDeletion.mutationOptions({
      onSuccess: async () => {
        const supabase = createSupabaseClient();
        try {
          await supabase.auth.signOut();
        } catch (err) {
          if (err instanceof TypeError) throw err;
          console.warn("[excluir-conta] signOut threw", err);
        }
        router.push("/auth/login");
      },
      onError: () => {
        setStatusMessage(DELETE_ACCOUNT_FAILED_PT_BR);
        setResetKey((k) => k + 1);
      },
    }),
  );

  const onTimeout = useCallback(() => {
    setStatusMessage(null);
    requestMutation.mutate({});
  }, [requestMutation]);

  const onCancel = useCallback(() => {
    setStatusMessage(DELETE_ACCOUNT_CANCELLED_TOAST_PT_BR);
  }, []);

  return (
    <section
      aria-label={DELETE_ACCOUNT_HEADER_PT_BR}
      className="flex flex-col gap-4"
    >
      <DeleteAccountConfirmationCard
        key={resetKey}
        onTimeout={onTimeout}
        onCancel={onCancel}
      />
      {statusMessage !== null ? (
        <p role="status" aria-live="polite" className="text-sm text-stone-600">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}
