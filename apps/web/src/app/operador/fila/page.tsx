import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@healthtracker/api";
import { appRouter, createTRPCContext } from "@healthtracker/api";
import { getVerifiedSessionForCaller } from "@healthtracker/auth/server";
import {
  formatOperatorCollectedAt,
  LABORATORY_UNIDENTIFIED_PT_BR,
  OPERATOR_ACCESS_DENIED_BODY_PT_BR,
  OPERATOR_ACCESS_DENIED_HEADING_PT_BR,
  OPERATOR_QUEUE_COLLECTED_LABEL_PT_BR,
  OPERATOR_QUEUE_EMPTY_PT_BR,
  OPERATOR_QUEUE_HEADING_PT_BR,
  OPERATOR_QUEUE_LAB_LABEL_PT_BR,
  OPERATOR_QUEUE_PATIENT_LABEL_PT_BR,
  OPERATOR_QUEUE_SUBHEADING_PT_BR,
  OPERATOR_REVIEW_QUEUE_ROUTE,
  operatorQueueFlaggedFieldsLabelPtBr,
  operatorQueueItemRoute,
} from "@healthtracker/validators";

/**
 * Story 8.1 AC1/AC4/AC11 — `/operador/fila`, the operator anonymised
 * review-queue list. First `/operador/*` route; sibling to
 * `/profissional/*`. RSC + server-caller; the `FORBIDDEN` catch renders
 * the "acesso restrito" card (the operator analogue of the limiares
 * not-activated card). No tokens cached.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageStyle: React.CSSProperties = {
  margin: "0 auto",
  maxWidth: 720,
  padding: "32px 16px",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

function AccessDeniedCard(): React.ReactElement {
  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>
        {OPERATOR_ACCESS_DENIED_HEADING_PT_BR}
      </h1>
      <p style={{ color: "#6b7280" }}>{OPERATOR_ACCESS_DENIED_BODY_PT_BR}</p>
    </main>
  );
}

export default async function OperadorFilaPage(): Promise<React.ReactElement> {
  const session = await getVerifiedSessionForCaller();
  if (!session) {
    redirect(
      `/auth/login?next=${encodeURIComponent(OPERATOR_REVIEW_QUEUE_ROUTE)}`,
    );
  }

  const reqHeaders = await headers();
  const ctx = createTRPCContext({ headers: reqHeaders, session });
  const caller = appRouter.createCaller(ctx);

  let items: RouterOutputs["operator"]["listReviewQueue"] | null = null;
  try {
    items = await caller.operator.listReviewQueue();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      return <AccessDeniedCard />;
    }
    throw err;
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>
        {OPERATOR_QUEUE_HEADING_PT_BR}
      </h1>
      <p style={{ color: "#6b7280", marginBottom: 24 }}>
        {OPERATOR_QUEUE_SUBHEADING_PT_BR}
      </p>

      {items.length === 0 ? (
        <p style={{ color: "#6b7280" }}>{OPERATOR_QUEUE_EMPTY_PT_BR}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li
              key={item.uploadId}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                marginBottom: 12,
                padding: 16,
              }}
            >
              <Link
                href={operatorQueueItemRoute(item.uploadId)}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {operatorQueueFlaggedFieldsLabelPtBr(item.flaggedFieldCount)}
                </div>
                <div style={{ color: "#6b7280", fontSize: 14 }}>
                  {OPERATOR_QUEUE_LAB_LABEL_PT_BR}:{" "}
                  {item.labName ?? LABORATORY_UNIDENTIFIED_PT_BR}
                </div>
                <div style={{ color: "#6b7280", fontSize: 14 }}>
                  {OPERATOR_QUEUE_COLLECTED_LABEL_PT_BR}:{" "}
                  {formatOperatorCollectedAt(item.collectedAtText)}
                </div>
                <div
                  style={{
                    color: "#9ca3af",
                    fontSize: 12,
                    marginTop: 4,
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {OPERATOR_QUEUE_PATIENT_LABEL_PT_BR}: {item.patientId}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
