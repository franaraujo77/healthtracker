import { SettingsNav } from "./settings-nav";

// Story 1.4 — Web Settings index. Server shell + client nav list. The
// only currently-functional row is Privacidade; Conta and Notificações
// are placeholders for later epics (Account / Epic 2 Notifications).
export default function ConfiguracoesPage() {
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12">
      <SettingsNav />
    </main>
  );
}
