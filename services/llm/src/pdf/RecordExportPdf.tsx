import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Story 5.5 AC4 — `@react-pdf/renderer` layout for the patient
 * record export PDF. Sections (per spec):
 *   - Cover page
 *   - Observações (Draws) — grouped by `collectedAt`
 *   - Bioimpedância (BIA) — chronological table
 *   - Uploads — metadata table
 *   - Eventos da vida — Epic 7 placeholder
 *
 * Typography: Lora 16pt for section headings; DM Sans 11pt for body.
 * Both fonts are loaded by the consumer via `Font.register(...)` at
 * boot time. The component intentionally does not call `Font.register`
 * — registration is a process-wide side-effect and lives outside the
 * render path so the test harness can opt out.
 *
 * If font registration is skipped or fails, react-pdf falls back to
 * Helvetica (built-in). The render still produces a valid PDF; this
 * is the seam unit tests rely on.
 */

const PT_BR_LONG_DATE = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
});

export interface PdfObservation {
  loincCode: string | null;
  biomarkerName: string;
  valueNumeric: number;
  unitUcum: string;
  collectedAt: string; // yyyy-mm-dd
  labName: string | null;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
}

export interface PdfBia {
  collectedAt: string;
  biomarkerName: string;
  valueNumeric: number;
  unitUcum: string;
  labName: string | null;
}

export interface PdfUpload {
  id: string;
  uploadedAt: string; // ISO
  sourceType: string; // 'onboarding_import' | 'post_onboarding' | ...
  status: string;
}

export interface RecordExportPdfData {
  patientId: string;
  generatedAt: string; // ISO
  observations: PdfObservation[];
  bia: PdfBia[];
  uploads: PdfUpload[];
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 64,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#1f2937",
  },
  coverTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 24,
    marginBottom: 16,
  },
  brand: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: "#0d9488",
    marginBottom: 24,
  },
  coverBody: { fontSize: 11, marginBottom: 8 },
  coverNotice: { marginTop: 32, fontSize: 10, color: "#6b7280" },
  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    marginTop: 24,
    marginBottom: 8,
  },
  subHeading: {
    fontFamily: "Helvetica",
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
    color: "#374151",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 4,
  },
  cellName: { flex: 3 },
  cellValue: { flex: 2 },
  cellUnit: { flex: 1 },
  cellRange: { flex: 2 },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#9ca3af",
    paddingVertical: 4,
    fontFamily: "Helvetica",
  },
  emptyState: { fontStyle: "italic", color: "#6b7280", marginTop: 4 },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
  },
});

function groupByDate<T extends { collectedAt: string }>(
  rows: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.collectedAt) ?? [];
    list.push(row);
    out.set(row.collectedAt, list);
  }
  return out;
}

function formatDate(iso: string): string {
  // `collectedAt` is yyyy-mm-dd; parse as UTC noon to avoid TZ drift.
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (Number.isNaN(dt.getTime())) return iso;
  return PT_BR_LONG_DATE.format(dt);
}

function formatRange(
  low: number | null,
  high: number | null,
  unit: string,
): string {
  if (low === null && high === null) return "—";
  if (low !== null && high !== null) return `${low} – ${high} ${unit}`;
  if (low !== null) return `≥ ${low} ${unit}`;
  return `≤ ${high ?? ""} ${unit}`;
}

export function RecordExportPdf(props: {
  data: RecordExportPdfData;
}): React.ReactElement {
  const { data } = props;
  const generatedAt = new Date(data.generatedAt);
  const patientIdShort = `${data.patientId.slice(0, 8)}…`;
  const draws = groupByDate(data.observations);
  const drawDatesDesc = [...draws.keys()].sort().reverse();

  return (
    <Document>
      {/* Cover page */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>Health Tracker</Text>
        <Text style={styles.coverTitle}>Seu registro pessoal de saúde</Text>
        <Text style={styles.coverBody}>
          Gerado em {PT_BR_LONG_DATE.format(generatedAt)}
        </Text>
        <Text style={styles.coverBody}>ID: {patientIdShort}</Text>
        <Text style={styles.coverNotice}>
          Este documento contém seus dados pessoais. Mantenha-o em local seguro.
        </Text>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* Content page(s) */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionHeading}>Observações</Text>
        {drawDatesDesc.length === 0 ? (
          <Text style={styles.emptyState}>Sem exames registrados.</Text>
        ) : (
          drawDatesDesc.map((date) => {
            const rows = draws.get(date) ?? [];
            return (
              <View key={date} wrap={false}>
                <Text style={styles.subHeading}>{formatDate(date)}</Text>
                <View style={styles.headerRow}>
                  <Text style={styles.cellName}>Biomarcador</Text>
                  <Text style={styles.cellValue}>Valor</Text>
                  <Text style={styles.cellUnit}>Unidade</Text>
                  <Text style={styles.cellRange}>Referência</Text>
                </View>
                {rows.map((r, i) => (
                  <View
                    key={`${date}-${r.loincCode ?? r.biomarkerName}-${i}`}
                    style={styles.row}
                  >
                    <Text style={styles.cellName}>{r.biomarkerName}</Text>
                    <Text style={styles.cellValue}>{r.valueNumeric}</Text>
                    <Text style={styles.cellUnit}>{r.unitUcum}</Text>
                    <Text style={styles.cellRange}>
                      {formatRange(
                        r.referenceRangeLow,
                        r.referenceRangeHigh,
                        r.unitUcum,
                      )}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })
        )}

        <Text style={styles.sectionHeading}>Bioimpedância</Text>
        {data.bia.length === 0 ? (
          <Text style={styles.emptyState}>
            Sem medições de bioimpedância registradas.
          </Text>
        ) : (
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.cellName}>Medida</Text>
              <Text style={styles.cellValue}>Valor</Text>
              <Text style={styles.cellUnit}>Unidade</Text>
              <Text style={styles.cellRange}>Data</Text>
            </View>
            {data.bia.map((b, i) => (
              <View key={`bia-${i}`} style={styles.row}>
                <Text style={styles.cellName}>{b.biomarkerName}</Text>
                <Text style={styles.cellValue}>{b.valueNumeric}</Text>
                <Text style={styles.cellUnit}>{b.unitUcum}</Text>
                <Text style={styles.cellRange}>
                  {formatDate(b.collectedAt)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionHeading}>Uploads</Text>
        {data.uploads.length === 0 ? (
          <Text style={styles.emptyState}>Sem uploads registrados.</Text>
        ) : (
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.cellName}>Data</Text>
              <Text style={styles.cellValue}>Origem</Text>
              <Text style={styles.cellUnit}>Status</Text>
            </View>
            {data.uploads.map((u) => (
              <View key={u.id} style={styles.row}>
                <Text style={styles.cellName}>
                  {PT_BR_LONG_DATE.format(new Date(u.uploadedAt))}
                </Text>
                <Text style={styles.cellValue}>{u.sourceType}</Text>
                <Text style={styles.cellUnit}>{u.status}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionHeading}>Eventos da vida</Text>
        <Text style={styles.emptyState}>Sem eventos registrados.</Text>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
