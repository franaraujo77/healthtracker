"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ShareBiomarkerToggle } from "@healthtracker/ui";
import { Button } from "@healthtracker/ui/button";
import {
  BIOMARKER_HIDDEN_PT_BR_FN,
  BIOMARKER_VISIBLE_PT_BR_FN,
  COMPARTILHAR_BACK_PT_BR,
  COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR,
  COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR,
  COMPARTILHAR_LOADING_PT_BR,
  COMPARTILHAR_ROUTE,
  compartilharConcluidoRoute,
  SHARE_TOKEN_INVALID_PT_BR,
} from "@healthtracker/validators";

import { useDebouncedConfigureBiomarkers } from "~/hooks/use-debounced-configure-biomarkers";
import { useTRPC } from "~/trpc/react";

export default function BiomarcadoresPage(props: {
  params: Promise<{ shareTokenId: string }>;
}): React.ReactElement {
  const { shareTokenId } = use(props.params);
  const router = useRouter();
  const trpc = useTRPC();
  const query = useQuery(
    trpc.sharing.getDraftConfig.queryOptions({ shareTokenId }),
  );

  if (query.isError) {
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
  if (!query.data) {
    return <main style={{ padding: 24 }}>{COMPARTILHAR_LOADING_PT_BR}</main>;
  }

  return (
    <Body
      shareTokenId={shareTokenId}
      doctorName={query.data.doctor.displayName}
      initialScope={query.data.biomarkerScope}
      onDone={() => router.replace(compartilharConcluidoRoute(shareTokenId))}
    />
  );
}

function Body(props: {
  shareTokenId: string;
  doctorName: string;
  initialScope: { category: string; label: string; visible: boolean }[];
  onDone: () => void;
}): React.ReactElement {
  const { scope, toggle, flushAsync } = useDebouncedConfigureBiomarkers({
    shareTokenId: props.shareTokenId,
    initialScope: props.initialScope,
  });

  // Patch #3 — await the in-flight flush before navigating away.
  const [submitting, setSubmitting] = useState(false);
  const handleDone = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await flushAsync();
    } finally {
      props.onDone();
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>{COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR}</h1>

      {/* aria-live region carries the agency-confirmation announce on web */}
      <div aria-live="polite" style={{ position: "absolute", left: -9999 }}>
        {props.initialScope
          .map((entry) => {
            const v = scope.get(entry.category) ?? entry.visible;
            return v
              ? BIOMARKER_VISIBLE_PT_BR_FN(entry.label, props.doctorName)
              : BIOMARKER_HIDDEN_PT_BR_FN(entry.label, props.doctorName);
          })
          .join(". ")}
      </div>

      {props.initialScope.map((entry) => (
        <ShareBiomarkerToggle
          key={entry.category}
          biomarkerCategory={entry.category}
          biomarkerLabel={entry.label}
          visible={scope.get(entry.category) ?? entry.visible}
          doctorName={props.doctorName}
          onToggle={(next) => toggle(entry.category, next)}
        />
      ))}

      <Button
        variant="secondary"
        disabled={submitting}
        onPress={() => {
          void handleDone();
        }}
      >
        {submitting
          ? COMPARTILHAR_LOADING_PT_BR
          : COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR}
      </Button>
    </main>
  );
}
