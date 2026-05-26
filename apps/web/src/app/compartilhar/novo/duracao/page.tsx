"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import {
  COMPARTILHAR_NOVO_DURACAO_PROGRESS_PT_BR,
  compartilharBiomarcadoresRoute,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

function DuracaoBody(): React.ReactElement {
  const router = useRouter();
  const trpc = useTRPC();
  const params = useSearchParams();
  const inviteId = params.get("inviteId") ?? "";
  const firedRef = useRef(false);

  const mutation = useMutation(
    trpc.sharing.createShareToken.mutationOptions({
      onSuccess: (data) => {
        router.replace(compartilharBiomarcadoresRoute(data.shareTokenId));
      },
    }),
  );

  useEffect(() => {
    if (firedRef.current) return;
    if (!inviteId) return;
    firedRef.current = true;
    mutation.mutate({ inviteId });
  }, [inviteId, mutation]);

  return <p>{COMPARTILHAR_NOVO_DURACAO_PROGRESS_PT_BR}</p>;
}

export default function DuracaoPage(): React.ReactElement {
  return (
    <main style={{ padding: 24 }}>
      <Suspense>
        <DuracaoBody />
      </Suspense>
    </main>
  );
}
