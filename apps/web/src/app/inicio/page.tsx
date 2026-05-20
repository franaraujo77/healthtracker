import { InicioEmptyState } from "./inicio-empty-state";

// Início — landing screen after onboarding consent (Story 1.2 AC5).
// The actual upload entry point ships in Epic 2; this page is the seam.
export default function InicioPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <InicioEmptyState />
    </main>
  );
}
