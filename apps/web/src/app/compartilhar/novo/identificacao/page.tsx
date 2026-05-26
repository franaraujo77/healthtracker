"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import {
  COMPARTILHAR_NOVO_CONTINUE_CTA_PT_BR,
  COMPARTILHAR_NOVO_DURACAO_ROUTE,
  COMPARTILHAR_NOVO_IDENTIFICACAO_TITLE_PT_BR,
  DOCTOR_DISPLAY_NAME_LABEL_PT_BR,
  DOCTOR_IDENTIFIER_LABEL_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

export default function IdentificacaoPage(): React.ReactElement {
  const router = useRouter();
  const trpc = useTRPC();
  const [displayName, setDisplayName] = useState("");
  const [identifier, setIdentifier] = useState("");

  const mutation = useMutation(
    trpc.sharing.createPendingInvite.mutationOptions({
      onSuccess: (data) => {
        router.push(
          `${COMPARTILHAR_NOVO_DURACAO_ROUTE}?inviteId=${data.inviteId}`,
        );
      },
    }),
  );

  const canSubmit =
    displayName.trim().length > 0 && identifier.trim().length >= 3;

  return (
    <main style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
      <h1>{COMPARTILHAR_NOVO_IDENTIFICACAO_TITLE_PT_BR}</h1>
      <label>
        {DOCTOR_DISPLAY_NAME_LABEL_PT_BR}
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label>
        {DOCTOR_IDENTIFIER_LABEL_PT_BR}
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
      </label>
      <Button
        variant="secondary"
        disabled={!canSubmit || mutation.isPending}
        onPress={() =>
          mutation.mutate({
            displayName: displayName.trim(),
            identifier: identifier.trim(),
          })
        }
      >
        {COMPARTILHAR_NOVO_CONTINUE_CTA_PT_BR}
      </Button>
    </main>
  );
}
