"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ShareBiomarkerToggle } from "@healthtracker/ui";
import { Button } from "@healthtracker/ui/button";
import {
  BIOMARKER_HIDDEN_PT_BR_FN,
  BIOMARKER_VISIBLE_PT_BR_FN,
  COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR,
  COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR,
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
          ← Voltar
        </Button>
      </main>
    );
  }
  if (!query.data) {
    return <main style={{ padding: 24 }}>Carregando…</main>;
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
  initialScope: { category: string; visible: boolean }[];
  onDone: () => void;
}): React.ReactElement {
  const { scope, toggle, flushPending } = useDebouncedConfigureBiomarkers({
    shareTokenId: props.shareTokenId,
    initialScope: props.initialScope,
  });

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>{COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR}</h1>

      {/* aria-live region carries the agency-confirmation announce on web */}
      <div aria-live="polite" style={{ position: "absolute", left: -9999 }}>
        {props.initialScope
          .map((entry) => {
            const v = scope.get(entry.category) ?? entry.visible;
            return v
              ? BIOMARKER_VISIBLE_PT_BR_FN(entry.category, props.doctorName)
              : BIOMARKER_HIDDEN_PT_BR_FN(entry.category, props.doctorName);
          })
          .join(". ")}
      </div>

      {props.initialScope.map((entry) => (
        <ShareBiomarkerToggle
          key={entry.category}
          biomarkerCategory={entry.category}
          biomarkerLabel={entry.category}
          visible={scope.get(entry.category) ?? entry.visible}
          doctorName={props.doctorName}
          onToggle={(next) => toggle(entry.category, next)}
        />
      ))}

      <Button
        variant="secondary"
        onPress={() => {
          flushPending();
          props.onDone();
        }}
      >
        {COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR}
      </Button>
    </main>
  );
}
