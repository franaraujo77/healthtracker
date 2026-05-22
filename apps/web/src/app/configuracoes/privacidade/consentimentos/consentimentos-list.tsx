"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import {
  CONSENT_GRANTED_ON_LABEL_PT_BR,
  CONSENT_SCREEN_COPY,
  CONSENT_VERSION_LABEL_PT_BR,
  formatConsentGrantedDate,
  isConsentScreenType,
  MEUS_CONSENTIMENTOS_EMPTY_CTA_PT_BR,
  MEUS_CONSENTIMENTOS_EMPTY_HEADLINE_PT_BR,
  MEUS_CONSENTIMENTOS_ERROR_PT_BR,
  MEUS_CONSENTIMENTOS_RETRY_PT_BR,
  MEUS_CONSENTIMENTOS_TITLE_PT_BR,
  ONBOARDING_CONSENT_ROUTE,
  WEB_MEUS_CONSENTIMENTOS_ROUTE,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

export function ConsentimentosList() {
  const router = useRouter();
  const trpc = useTRPC();

  // `staleTime: Infinity` keeps the per-visit `consent.read` audit
  // honest: the SSR pass already wrote one row; the client hydrates
  // from that cache and never refetches on focus / remount.
  const query = useQuery(
    trpc.consent.list.queryOptions(
      { surface: "settings" },
      { staleTime: Infinity },
    ),
  );

  if (query.isError) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold">
          {MEUS_CONSENTIMENTOS_TITLE_PT_BR}
        </h1>
        <p role="alert" className="text-sm text-stone-700">
          {MEUS_CONSENTIMENTOS_ERROR_PT_BR}
        </p>
        <Button onPress={() => void query.refetch()}>
          {MEUS_CONSENTIMENTOS_RETRY_PT_BR}
        </Button>
      </section>
    );
  }

  const rows = query.data ?? [];

  if (rows.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold">
          {MEUS_CONSENTIMENTOS_TITLE_PT_BR}
        </h1>
        <p className="text-stone-700">
          {MEUS_CONSENTIMENTOS_EMPTY_HEADLINE_PT_BR}
        </p>
        <Button onPress={() => router.push(ONBOARDING_CONSENT_ROUTE)}>
          {MEUS_CONSENTIMENTOS_EMPTY_CTA_PT_BR}
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold">{MEUS_CONSENTIMENTOS_TITLE_PT_BR}</h1>
      <ul className="flex flex-col divide-y rounded-lg border">
        {rows.map((row) => {
          if (!isConsentScreenType(row.consentType)) return null;
          const copy = CONSENT_SCREEN_COPY[row.consentType];
          // Review P24 — thread `version` + `grantedAt` to the detail
          // page via query string so the detail renders the row's
          // actual agreed-to values rather than a global constant.
          const grantedAtIso =
            row.grantedAt instanceof Date
              ? row.grantedAt.toISOString()
              : String(row.grantedAt);
          const params = new URLSearchParams({
            version: row.version,
            grantedAt: grantedAtIso,
          });
          const href = `${WEB_MEUS_CONSENTIMENTOS_ROUTE}/${row.consentType}?${params.toString()}`;
          return (
            <li key={row.id}>
              <Link
                href={href}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-stone-50"
              >
                <span className="font-medium">{copy.title}</span>
                <span className="text-sm text-stone-600">
                  {CONSENT_GRANTED_ON_LABEL_PT_BR}{" "}
                  {formatConsentGrantedDate(row.grantedAt)}
                </span>
                <span className="text-xs text-stone-500">
                  {CONSENT_VERSION_LABEL_PT_BR}: {row.version}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
