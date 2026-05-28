import type { Metadata } from "next";

/**
 * Story 6.1 T4.6 — destination stub for the active-state CTA on the
 * pre-auth landing page. Story 6.2 will replace this with the
 * doctor magic-link authentication form. Without this stub the
 * `Ver histórico` link would 404.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PreAuthLandingAuthStubPage(): React.ReactElement {
  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <p>Em breve — Story 6.2 entregará a autenticação do médico.</p>
    </main>
  );
}
