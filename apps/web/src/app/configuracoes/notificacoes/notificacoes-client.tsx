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
        setError(NOTIF_PREF_ERROR_PT_BR);
        // Revert: drop the optimistic so the next render falls back
        // to the server-confirmed query data.
        setOptimistic(null);
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
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
