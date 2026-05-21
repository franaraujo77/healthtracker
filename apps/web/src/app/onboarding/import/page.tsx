import { ImportFlow } from "./import-flow";

// Story 1.5 — onboarding "Enviar resultados anteriores" screen (web).
// Web has no biometric step (Story 1.3 was mobile-only) so the flow is
// consent → import → Início. Skip path lands directly on /inicio.
export default function ImportPage() {
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12">
      <ImportFlow />
    </main>
  );
}
