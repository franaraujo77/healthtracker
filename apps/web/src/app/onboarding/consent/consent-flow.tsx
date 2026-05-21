"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import type { ConsentScreenType } from "@healthtracker/validators";
import { Button } from "@healthtracker/ui/button";
import {
  CONSENT_SCREEN_COPY,
  CONSENT_SCREEN_TYPES,
  CONSENT_TEXT_VERSION,
  CONSENT_VERSION_LABEL_PT_BR,
  GENERIC_CONSENT_ERROR_MESSAGE_PT_BR,
  IMPORT_ROUTE,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

export function ConsentFlow() {
  const router = useRouter();
  const trpc = useTRPC();
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation(trpc.consent.grant.mutationOptions());
  const decline = useMutation(trpc.consent.decline.mutationOptions());

  const currentType: ConsentScreenType =
    CONSENT_SCREEN_TYPES[stepIndex] ?? CONSENT_SCREEN_TYPES[0];
  const copy = CONSENT_SCREEN_COPY[currentType];
  const isLast = stepIndex === CONSENT_SCREEN_TYPES.length - 1;
  const pending = grant.isPending || decline.isPending;

  function advance() {
    if (isLast) {
      // Story 1.5 — onboarding now ends at the import screen on web
      // (consent → import → Início). The import screen's own skip path
      // routes to /inicio.
      router.replace(IMPORT_ROUTE);
      return;
    }
    setStepIndex((i) => i + 1);
  }

  async function handleGrant() {
    setError(null);
    try {
      await grant.mutateAsync({
        consentType: currentType,
        version: CONSENT_TEXT_VERSION,
      });
      advance();
    } catch {
      setError(GENERIC_CONSENT_ERROR_MESSAGE_PT_BR);
    }
  }

  async function handleDecline() {
    setError(null);
    try {
      await decline.mutateAsync({
        consentType: currentType,
        version: CONSENT_TEXT_VERSION,
      });
      advance();
    } catch {
      setError(GENERIC_CONSENT_ERROR_MESSAGE_PT_BR);
    }
  }

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          {stepIndex + 1} / {CONSENT_SCREEN_TYPES.length}
        </p>
        <h1 className="text-2xl font-bold">{copy.title}</h1>
      </header>
      <p className="text-base leading-relaxed">{copy.body}</p>
      <p className="text-muted-foreground text-xs">
        {CONSENT_VERSION_LABEL_PT_BR}: {CONSENT_TEXT_VERSION}
      </p>
      <p className="text-muted-foreground text-sm italic">
        {copy.declineConsequence}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-amber-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onPress={handleDecline} disabled={pending}>
          {copy.secondaryCta}
        </Button>
        <Button onPress={handleGrant} disabled={pending}>
          {copy.primaryCta}
        </Button>
      </div>
    </article>
  );
}
