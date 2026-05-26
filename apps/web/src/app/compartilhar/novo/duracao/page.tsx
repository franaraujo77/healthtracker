"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import type { ShareDuration } from "@healthtracker/validators";
import { DurationOption, NoExpiryConfirmDialog } from "@healthtracker/ui";
import { Button } from "@healthtracker/ui/button";
import {
  COMPARTILHAR_NOVO_DURACAO_TITLE_PT_BR,
  compartilharBiomarcadoresRoute,
  CONTINUE_BUTTON_PT_BR,
  DURATION_OPTIONS,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

function DuracaoBody(): React.ReactElement {
  const router = useRouter();
  const trpc = useTRPC();
  const params = useSearchParams();
  const inviteId = params.get("inviteId") ?? "";
  const [selectedDuration, setSelectedDuration] = useState<ShareDuration>("7d");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mutation = useMutation(
    trpc.sharing.createShareToken.mutationOptions({
      onSuccess: (data) => {
        router.replace(compartilharBiomarcadoresRoute(data.shareTokenId));
      },
    }),
  );

  const submit = (duration: ShareDuration): void => {
    if (mutation.isPending) return;
    mutation.mutate({ inviteId, duration });
  };

  const handleContinue = (): void => {
    if (selectedDuration === "no_expiry") {
      setConfirmOpen(true);
      return;
    }
    submit(selectedDuration);
  };

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>{COMPARTILHAR_NOVO_DURACAO_TITLE_PT_BR}</h1>
      {DURATION_OPTIONS.map((opt) => (
        <DurationOption
          key={opt.value}
          value={opt.value}
          label={opt.labelPtBr}
          selected={selectedDuration === opt.value}
          onSelect={() => setSelectedDuration(opt.value)}
        />
      ))}
      <Button
        variant="secondary"
        disabled={mutation.isPending}
        onPress={handleContinue}
      >
        {CONTINUE_BUTTON_PT_BR}
      </Button>
      <NoExpiryConfirmDialog
        open={confirmOpen}
        onConfirm={() => {
          setConfirmOpen(false);
          submit("no_expiry");
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </main>
  );
}

export default function DuracaoPage(): React.ReactElement {
  return (
    <Suspense>
      <DuracaoBody />
    </Suspense>
  );
}
