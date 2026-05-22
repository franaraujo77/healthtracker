"use client";

import { useRouter } from "next/navigation";

import { EmptyStateRecord } from "@healthtracker/ui";
import {
  IMPORT_ROUTE,
  INICIO_CTA_PT_BR,
  INICIO_HEADLINE_PT_BR,
} from "@healthtracker/validators";

export function InicioEmptyState() {
  const router = useRouter();
  return (
    <EmptyStateRecord
      headline={INICIO_HEADLINE_PT_BR}
      ctaLabel={INICIO_CTA_PT_BR}
      // Story 1.5 — the empty-state CTA now opens the same import
      // screen the onboarding flow uses (AC3 + AC4 recovery path).
      onCtaPress={() => router.push(IMPORT_ROUTE)}
    />
  );
}
