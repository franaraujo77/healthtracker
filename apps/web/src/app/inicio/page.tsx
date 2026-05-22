import { InicioEmptyState } from "./inicio-empty-state";

// Início — landing screen after onboarding consent (Story 1.2 AC5).
// The actual upload entry point ships in Epic 2; this page is the seam.
//
// R2-P171 — read the `?source=` query param so Story 2.5's
// failed-card recovery CTAs (`Enviar novamente`, `Enviar uma foto`)
// route through here with intent. Unrecognized values default to the
// plain landing state.
export default async function InicioPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string }>;
}) {
  const resolved = (await searchParams) ?? {};
  const initialSource =
    resolved.source === "post_onboarding_photo"
      ? "post_onboarding_photo"
      : resolved.source === "post_onboarding"
        ? "post_onboarding"
        : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center">
      <InicioEmptyState initialSource={initialSource} />
    </main>
  );
}
