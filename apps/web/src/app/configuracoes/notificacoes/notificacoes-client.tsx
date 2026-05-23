"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import type { NotificationPreferencesInput } from "@healthtracker/validators";
import {
  NOTIF_PREF_ERROR_PT_BR,
  NOTIF_PREF_LETTERS_READY_PT_BR,
  NOTIF_PREF_LOADING_PT_BR,
  NOTIF_PREF_RECORD_ACCESS_PT_BR,
  NOTIF_PREF_RESULTS_READY_PT_BR,
  NOTIF_PREF_RETRY_PT_BR,
  NOTIF_PREF_REVIEW_REQUIRED_PT_BR,
  NOTIFICATIONS_SETTINGS_TITLE_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

type PrefKey = keyof NotificationPreferencesInput;

const TOGGLES: { key: PrefKey; label: string }[] = [
  { key: "resultsReady", label: NOTIF_PREF_RESULTS_READY_PT_BR },
  { key: "lettersReady", label: NOTIF_PREF_LETTERS_READY_PT_BR },
  { key: "recordAccess", label: NOTIF_PREF_RECORD_ACCESS_PT_BR },
  { key: "reviewRequired", label: NOTIF_PREF_REVIEW_REQUIRED_PT_BR },
];

export function NotificacoesClient() {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.notifications.getPreferences.queryOptions(undefined, {
      staleTime: 0,
    }),
  );
  const [optimistic, setOptimistic] =
    useState<NotificationPreferencesInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.notifications.updatePreferences.mutationOptions({
      onSuccess: (data) => {
        setOptimistic(data);
        setError(null);
      },
      onError: () => {
        // R3-P233 — keep the optimistic state visible so the user
        // doesn't see their intent snap back; show the error
        // alongside and let them tap "Tentar novamente" to re-fire
        // the mutation with the same payload. A transient 5xx no
        // longer silently undoes the patient's change.
        setError(NOTIF_PREF_ERROR_PT_BR);
      },
    }),
  );

  const prefs = optimistic ?? query.data ?? null;

  function onToggle(key: PrefKey, next: boolean) {
    if (!prefs) return;
    const updated: NotificationPreferencesInput = { ...prefs, [key]: next };
    setOptimistic(updated);
    mutation.mutate(updated);
  }

  // R2-P228 — surface load failure with a retry; the prior code
  // collapsed `isLoading` + `prefs === null` so a query error
  // looked indistinguishable from a slow initial load.
  if (query.isError) {
    return (
      <section className="space-y-3">
        <p role="alert" className="text-sm text-red-700">
          {NOTIF_PREF_ERROR_PT_BR}
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {NOTIF_PREF_RETRY_PT_BR}
        </button>
      </section>
    );
  }
  if (query.isLoading || prefs === null) {
    return <p className="text-stone-700">{NOTIF_PREF_LOADING_PT_BR}</p>;
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {NOTIFICATIONS_SETTINGS_TITLE_PT_BR}
      </h1>
      <ul className="flex flex-col gap-3">
        {TOGGLES.map(({ key, label }) => (
          <li key={key} className="flex items-center justify-between gap-3">
            <span className="text-base text-stone-900">{label}</span>
            <input
              type="checkbox"
              checked={prefs[key]}
              onChange={(e) => onToggle(key, e.target.checked)}
              aria-label={label}
              className="h-5 w-9 cursor-pointer accent-teal-700"
            />
          </li>
        ))}
      </ul>
      {error !== null ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              if (optimistic === null) return;
              setError(null);
              mutation.mutate(optimistic);
            }}
            className="w-fit rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {NOTIF_PREF_RETRY_PT_BR}
          </button>
        </div>
      ) : null}
    </section>
  );
}
