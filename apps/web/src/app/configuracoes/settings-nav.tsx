"use client";

import Link from "next/link";

import {
  CONFIGURACOES_DISABLED_HINT_PT_BR,
  CONFIGURACOES_PRIVACIDADE_ROW_PT_BR,
  CONFIGURACOES_TITLE_PT_BR,
  WEB_CONFIGURACOES_PRIVACIDADE_ROUTE,
} from "@healthtracker/validators";

export function SettingsNav() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold">{CONFIGURACOES_TITLE_PT_BR}</h1>
      <nav className="flex flex-col divide-y rounded-lg border">
        <Link
          href={WEB_CONFIGURACOES_PRIVACIDADE_ROUTE}
          className="px-4 py-4 font-medium hover:bg-stone-50"
        >
          {CONFIGURACOES_PRIVACIDADE_ROW_PT_BR}
        </Link>
        <div
          aria-disabled="true"
          className="flex items-center justify-between px-4 py-4 text-stone-500"
        >
          <span>Conta</span>
          <span className="text-xs">{CONFIGURACOES_DISABLED_HINT_PT_BR}</span>
        </div>
        <div
          aria-disabled="true"
          className="flex items-center justify-between px-4 py-4 text-stone-500"
        >
          <span>Notificações</span>
          <span className="text-xs">{CONFIGURACOES_DISABLED_HINT_PT_BR}</span>
        </div>
      </nav>
    </section>
  );
}
