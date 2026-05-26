"use client";

import Link from "next/link";

import { Button } from "@healthtracker/ui/button";
import {
  COMPARTILHAR_BACK_PT_BR,
  COMPARTILHAR_CONCLUIDO_PT_BR,
  COMPARTILHAR_ROUTE,
} from "@healthtracker/validators";

export default function ConcluidoPage(): React.ReactElement {
  return (
    <main style={{ padding: 24 }}>
      <h1>{COMPARTILHAR_CONCLUIDO_PT_BR}</h1>
      <Link href={COMPARTILHAR_ROUTE}>
        <Button variant="secondary">{COMPARTILHAR_BACK_PT_BR}</Button>
      </Link>
    </main>
  );
}
