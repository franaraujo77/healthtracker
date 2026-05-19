// Placeholder destination for post-registration onboarding (Story 1.1, AC3).
// The full LGPD per-data-type consent UI ships in Story 1.2; this page exists
// so registration has a non-health-data landing target until then.
export default function ConsentPage() {
  return (
    <main className="container flex min-h-screen items-center justify-center py-16">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold">Consentimento</h1>
        <p className="text-muted-foreground text-sm">
          Antes de coletarmos qualquer dado de saúde, vamos pedir o seu
          consentimento para cada tipo. Em breve.
        </p>
      </div>
    </main>
  );
}
