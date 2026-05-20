"use client";

import { EmptyStateRecord } from "@healthtracker/ui";
import {
  INICIO_CTA_PT_BR,
  INICIO_HEADLINE_PT_BR,
} from "@healthtracker/validators";

export function InicioEmptyState() {
  return (
    <EmptyStateRecord
      headline={INICIO_HEADLINE_PT_BR}
      ctaLabel={INICIO_CTA_PT_BR}
      // The upload entry point ships in Epic 2 — this CTA is a placeholder
      // seam so the route is reachable and the empty state renders today.
      onCtaPress={() => {
        /* no-op until Epic 2 wires uploads */
      }}
    />
  );
}
