"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import {
  failureReasonLabel,
  HISTORICO_EMPTY_CTA_PT_BR,
  HISTORICO_EMPTY_HEADLINE_PT_BR,
  HISTORICO_ERROR_PT_BR,
  HISTORICO_LOADING_PT_BR,
  HISTORICO_RECOVERY_PHOTO_PT_BR,
  HISTORICO_RECOVERY_RESEND_PT_BR,
  HISTORICO_RECOVERY_SKIP_PT_BR,
  HISTORICO_TITLE_PT_BR,
  INICIO_ROUTE,
  postOnboardingImportRoute,
  UPLOAD_DETAIL_ROUTE,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

const BADGE_CLASSES: Record<
  "queued" | "processing" | "pending_review" | "complete" | "failed",
  string
> = {
  queued: "bg-stone-100 text-stone-700",
  processing: "bg-stone-100 text-stone-700",
  pending_review: "bg-amber-100 text-amber-900",
  complete: "bg-teal-100 text-teal-900",
  failed: "bg-red-100 text-red-900",
};

export function HistoricoClient() {
  const trpc = useTRPC();
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const query = useQuery(
    trpc.uploads.listUploadsForPatient.queryOptions(
      { limit: 50 },
      { refetchOnWindowFocus: true, staleTime: 0 },
    ),
  );

  const rawRows = query.data?.rows ?? [];
  const rows = rawRows.filter((r) => !dismissed.has(r.id));
  const allDismissed =
    !query.isLoading && rawRows.length > 0 && rows.length === 0;

  if (query.isLoading) {
    return <p className="text-stone-700">{HISTORICO_LOADING_PT_BR}</p>;
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-stone-700">
        {HISTORICO_ERROR_PT_BR}
      </p>
    );
  }
  if (rawRows.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{HISTORICO_TITLE_PT_BR}</h1>
        <p className="text-stone-700">{HISTORICO_EMPTY_HEADLINE_PT_BR}</p>
        <Button onPress={() => router.push(INICIO_ROUTE)}>
          {HISTORICO_EMPTY_CTA_PT_BR}
        </Button>
      </section>
    );
  }
  if (allDismissed) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{HISTORICO_TITLE_PT_BR}</h1>
        <p className="text-stone-700">Todos os resultados foram pulados.</p>
        <Button onPress={() => setDismissed(new Set())}>Mostrar pulados</Button>
      </section>
    );
  }
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{HISTORICO_TITLE_PT_BR}</h1>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const tappable =
            row.status === "pending_review" || row.status === "complete";
          const inner = (
            <div className="flex flex-col gap-2 rounded-lg border px-4 py-3">
              <span className="font-medium">{row.originalFilename}</span>
              <span className="text-xs text-stone-600">
                {new Date(row.createdAt).toLocaleDateString("pt-BR")}
              </span>
              <span
                className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs ${BADGE_CLASSES[row.status]}`}
              >
                {UPLOAD_STATUS_LABELS_PT_BR[row.status]}
              </span>
              {row.status === "failed" ? (
                <div className="mt-2 flex flex-col gap-2">
                  <p className="text-sm text-stone-700">
                    {failureReasonLabel(row.failureReason)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onPress={() =>
                        router.push(postOnboardingImportRoute("file"))
                      }
                    >
                      {HISTORICO_RECOVERY_RESEND_PT_BR}
                    </Button>
                    <Button
                      onPress={() =>
                        router.push(postOnboardingImportRoute("photo"))
                      }
                    >
                      {HISTORICO_RECOVERY_PHOTO_PT_BR}
                    </Button>
                    <Button
                      onPress={() =>
                        setDismissed((prev) => {
                          const next = new Set(prev);
                          next.add(row.id);
                          return next;
                        })
                      }
                    >
                      {HISTORICO_RECOVERY_SKIP_PT_BR}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
          return (
            <li key={row.id}>
              {tappable ? (
                <Link href={UPLOAD_DETAIL_ROUTE(row.id)}>{inner}</Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
