import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@healthtracker/api";
import { appRouter, createTRPCContext } from "@healthtracker/api";
import { getVerifiedSessionForCaller } from "@healthtracker/auth/server";
import {
  formatConfidencePct,
  OPERATOR_ACCESS_DENIED_BODY_PT_BR,
  OPERATOR_ACCESS_DENIED_HEADING_PT_BR,
  OPERATOR_BACK_TO_QUEUE_PT_BR,
  OPERATOR_DETAIL_CONFIDENCE_LABEL_PT_BR,
  OPERATOR_DETAIL_EMPTY_PT_BR,
  OPERATOR_DETAIL_HEADING_PT_BR,
  OPERATOR_DETAIL_RAW_LABEL_PT_BR,
  OPERATOR_DETAIL_VALUE_LABEL_PT_BR,
  OPERATOR_REVIEW_QUEUE_ROUTE,
} from "@healthtracker/validators";

/**
 * Story 8.1 AC2/AC11 — `/operador/fila/[uploadId]`, the operator
 * detail view: every `loinc_unresolved` flagged field for one upload,
 * fully anonymised (no name/email/contact). RSC + server-caller; same
 * `FORBIDDEN` card as the list page. No tokens cached.
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

export default async function OperadorFilaDetailPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}): Promise<React.ReactElement> {
  const { uploadId } = await params;

  const session = await getVerifiedSessionForCaller();
  if (!session) {
    redirect(
      `/auth/login?next=${encodeURIComponent(OPERATOR_REVIEW_QUEUE_ROUTE)}`,
    );
  }

  const reqHeaders = await headers();
  const ctx = createTRPCContext({ headers: reqHeaders, session });
  const caller = appRouter.createCaller(ctx);

  let fields: RouterOutputs["operator"]["getQueueItem"] | null = null;
  try {
    fields = await caller.operator.getQueueItem({ uploadId });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      return <AccessDeniedCard />;
    }
    throw err;
  }

  return (
    <main style={pageStyle}>
      <Link
        href={OPERATOR_REVIEW_QUEUE_ROUTE}
        style={{ color: "#2563eb", fontSize: 14, textDecoration: "none" }}
      >
        {OPERATOR_BACK_TO_QUEUE_PT_BR}
      </Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 24px" }}>
        {OPERATOR_DETAIL_HEADING_PT_BR}
      </h1>

      {fields.length === 0 ? (
        <p style={{ color: "#6b7280" }}>{OPERATOR_DETAIL_EMPTY_PT_BR}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {fields.map((field) => (
            <li
              key={field.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                marginBottom: 12,
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                {field.biomarkerName}
              </div>
              <div style={{ color: "#374151", fontSize: 14 }}>
                {OPERATOR_DETAIL_VALUE_LABEL_PT_BR}: {field.valueText}
                {field.unitText ? ` ${field.unitText}` : ""}
              </div>
              <div style={{ color: "#6b7280", fontSize: 14 }}>
                {OPERATOR_DETAIL_RAW_LABEL_PT_BR}: {field.valueText}
              </div>
              <div style={{ color: "#6b7280", fontSize: 14 }}>
                {OPERATOR_DETAIL_CONFIDENCE_LABEL_PT_BR}:{" "}
                {formatConfidencePct(field.confidenceScore)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
