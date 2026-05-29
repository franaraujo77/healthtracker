"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import {
  COMPARTILHAR_EMPTY_HEADLINE_PT_BR,
  COMPARTILHAR_ERROR_PT_BR,
  COMPARTILHAR_LOADING_PT_BR,
  COMPARTILHAR_NEW_CTA_PT_BR,
  COMPARTILHAR_NOVO_IDENTIFICACAO_ROUTE,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

/**
 * Story 5.1 — Compartilhar landing (web parity with the Expo tab
 * landing). Tier-2 CTA per UX-DR13.
 */
export default function CompartilharPage(): React.ReactElement {
  const trpc = useTRPC();
  const query = useQuery(trpc.sharing.listShares.queryOptions());

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <Link href={COMPARTILHAR_NOVO_IDENTIFICACAO_ROUTE}>
        <Button variant="secondary">{COMPARTILHAR_NEW_CTA_PT_BR}</Button>
      </Link>

      {query.isLoading ? <p>{COMPARTILHAR_LOADING_PT_BR}</p> : null}
      {query.isError ? <p>{COMPARTILHAR_ERROR_PT_BR}</p> : null}
      {query.data && query.data.shares.length === 0 ? (
        <p>{COMPARTILHAR_EMPTY_HEADLINE_PT_BR}</p>
      ) : null}
      <ul>
        {query.data?.shares.map((share) => (
          <li key={share.id}>
            {share.displayName} — {share.biomarkerCount} biomarcadores
          </li>
        ))}
      </ul>
    </main>
  );
}
