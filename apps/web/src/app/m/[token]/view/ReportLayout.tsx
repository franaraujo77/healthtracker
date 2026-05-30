import { CONVERSATION_STARTER_VIEW_BANNER_FN } from "@healthtracker/validators";

/**
 * Story 6.2 T5.6 — server component wrapper for the doctor report.
 * Wordmark on top + patient-firstname banner. No app-shell layout
 * group (no patient sidebar, no Compartilhar tab) — the doctor surface
 * is intentionally minimal per AC5.
 *
 * Grid (3-up on desktop, stack on mobile per UX line 564–571) is
 * applied to the children container below.
 */

export interface ReportLayoutProps {
  patientFirstName: string;
  children: React.ReactNode;
}

export function ReportLayout(props: ReportLayoutProps): React.ReactElement {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 1080,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          borderBottom: "1px solid #eee",
          paddingBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 12,
            letterSpacing: "0.08em",
            color: "#777",
            textTransform: "uppercase",
          }}
        >
          Health Tracker
        </span>
        <h1 style={{ fontSize: 22, margin: 0 }}>
          {CONVERSATION_STARTER_VIEW_BANNER_FN(props.patientFirstName)}
        </h1>
      </header>
      {props.children}
    </main>
  );
}
