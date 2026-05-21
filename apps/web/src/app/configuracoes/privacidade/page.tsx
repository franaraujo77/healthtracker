import Link from "next/link";

import {
  CONFIGURACOES_DISABLED_HINT_PT_BR,
  MEUS_CONSENTIMENTOS_TITLE_PT_BR,
  PRIVACIDADE_TITLE_PT_BR,
  WEB_MEUS_CONSENTIMENTOS_ROUTE,
} from "@healthtracker/validators";

export default function PrivacidadePage() {
  return (
    <main className="container mx-auto max-w-2xl space-y-6 px-6 py-12">
      <h1 className="text-3xl font-bold">{PRIVACIDADE_TITLE_PT_BR}</h1>
      <nav className="flex flex-col divide-y rounded-lg border">
        <Link
          href={WEB_MEUS_CONSENTIMENTOS_ROUTE}
          className="px-4 py-4 font-medium hover:bg-stone-50"
        >
          {MEUS_CONSENTIMENTOS_TITLE_PT_BR}
        </Link>
        <div
          aria-disabled="true"
          className="flex items-center justify-between px-4 py-4 text-stone-500"
        >
          <span>Acesso de médicos</span>
          <span className="text-xs">{CONFIGURACOES_DISABLED_HINT_PT_BR}</span>
        </div>
      </nav>
    </main>
  );
}
