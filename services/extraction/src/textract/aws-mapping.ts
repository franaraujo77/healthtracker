import type {
  AnalyzeDocumentCommandOutput,
  Block,
} from "@aws-sdk/client-textract";

import type { RawExtractedField } from "./adapter.js";

/**
 * Story 9.1 — pure mapping from a Textract `AnalyzeDocument` response
 * (`FeatureTypes: ['FORMS', 'TABLES']`) into the adapter's
 * `RawExtractedField[]` contract.
 *
 * This module is INTENTIONALLY pure: no SDK client, no network, no env.
 * The only non-trivial logic in the AWS adapter (block-graph traversal +
 * heuristic biomarker extraction) lives here so the fixture tests cover
 * it field-by-field without a live AWS call (NFR-S8). `aws-adapter.ts`
 * is a thin SDK wrapper that delegates here.
 *
 * RAW strings only — `valueText` keeps the Brazilian decimal comma
 * (`14,2`); decimal parsing, LOINC lookup, UCUM canonicalisation, and
 * date parsing all happen downstream in `dispatchExtractedFields`.
 *
 * Heuristics (see AC6) and their limitations:
 *   - DOCUMENT CONTEXT: a lab report carries ONE collection date and one
 *     lab name for the whole draw. We pull them from the FORMS pairs whose
 *     key matches a date/lab pattern and stamp `collectedAtText` /
 *     `labName` onto EVERY emitted field. This is load-bearing: without a
 *     `collectedAtText`, `dispatchExtractedFields` treats the field as
 *     structurally incomplete (`collectedAt === null`) and routes it to
 *     the review queue instead of publishing it. The date/lab keys are
 *     themselves excluded from biomarker extraction.
 *   - FORMS: a `KEY_VALUE_SET` block whose `EntityTypes` contains `KEY`
 *     yields `biomarkerName` = key text; its linked `VALUE` block's text
 *     is split into a leading numeric token (`valueText`) + trailing
 *     remainder (`unitText`). Pairs with no numeric value are skipped.
 *   - TABLES: each `TABLE` is read as a grid of `CELL` blocks. Row 1 is
 *     the header; the biomarker / value / unit columns are detected from
 *     header text (pt-BR + en); reference-range columns are excluded so a
 *     "Valor de referência" column is never mistaken for the result. A
 *     numeric-body fallback picks the value column when no header matches.
 *     Rows with no numeric value are skipped.
 *   - DE-DUP: keyed on `biomarkerName + valueText` (case-insensitive
 *     name), keeping the higher confidence — so a datum reported by BOTH
 *     a FORMS pair and a table collapses to one, while a genuinely
 *     distinct same-name measurement (different value) is preserved.
 *   - KNOWN LIMITATIONS (out of 9.1 scope): merged/spanning cells
 *     (`ColumnSpan`/`RowSpan`, `MERGED_CELL` blocks) are not honoured — a
 *     merged header can misalign the grid. Reference-range values are not
 *     surfaced. Multi-date reports stamp only the first collection date.
 *     These need iteration once live calls are enabled (Story 9.2).
 */

/** Clamp a number into the `[0, 1]` confidence range the gate expects. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Textract `Confidence` is `0–100`; the gate wants `0–1`. */
function normaliseConfidence(confidence: number | undefined): number {
  return clamp01((confidence ?? 0) / 100);
}

/**
 * Split a raw value string into a leading numeric token + trailing unit.
 * The numeric token keeps the Brazilian decimal comma untouched (parsing
 * is the dispatch layer's job). Returns `null` when there is no leading
 * numeric token (caller skips the field).
 *
 *   "14,2 g/dL"  -> { valueText: "14,2", unitText: "g/dL" }
 *   "4.500"      -> { valueText: "4.500", unitText: undefined }
 *   "Positivo"   -> null
 */
export function splitValueUnit(
  raw: string,
): { valueText: string; unitText: string | undefined } | null {
  const match = /^\s*([+-]?\d[\d.,]*)\s*(.*)$/.exec(raw);
  if (!match) return null;
  const valueText = match[1];
  if (valueText === undefined) return null;
  const rest = (match[2] ?? "").trim();
  return { valueText, unitText: rest.length > 0 ? rest : undefined };
}

/** Index every block by `Id` for relationship traversal. */
function indexBlocks(blocks: Block[]): Map<string, Block> {
  const byId = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) byId.set(block.Id, block);
  }
  return byId;
}

/** Ids referenced by a relationship of the given type. */
function relatedIds(block: Block, type: string): string[] {
  const ids: string[] = [];
  for (const rel of block.Relationships ?? []) {
    if (rel.Type === type) ids.push(...(rel.Ids ?? []));
  }
  return ids;
}

/**
 * Reconstruct a block's text from its `CHILD` `WORD` blocks (and
 * `SELECTION_ELEMENT` status), joined with spaces.
 */
function blockText(block: Block, byId: Map<string, Block>): string {
  const parts: string[] = [];
  for (const childId of relatedIds(block, "CHILD")) {
    const child = byId.get(childId);
    if (!child) continue;
    if (child.BlockType === "WORD" && child.Text) {
      parts.push(child.Text);
    } else if (child.BlockType === "SELECTION_ELEMENT") {
      if (child.SelectionStatus === "SELECTED") parts.push("[X]");
    }
  }
  return parts.join(" ").trim();
}

/** The linked `VALUE` block of a FORMS `KEY` block, if any. */
function valueBlockOf(
  keyBlock: Block,
  byId: Map<string, Block>,
): Block | undefined {
  return relatedIds(keyBlock, "VALUE")
    .map((id) => byId.get(id))
    .find((b): b is Block => b !== undefined);
}

const DATE_KEY = /coleta|collection|data\b/i;
const LAB_KEY = /laborat[óo]rio/i;
const BIOMARKER_HEADER = /exame|biomarc|par[âa]met|an[áa]lise|teste|analito/i;
const VALUE_HEADER = /resultad|result|valor|value/i;
const UNIT_HEADER = /unidade|unit/i;
const REFERENCE_HEADER = /refer[êe]nc|intervalo|range/i;

interface DocumentContext {
  collectedAtText: string | undefined;
  labName: string | undefined;
}

/**
 * Pull the document-level collection date + lab name from FORMS pairs.
 * A lab report has ONE of each for the whole draw; both are stamped onto
 * every field. The matching key blocks are returned so biomarker
 * extraction can skip them.
 */
function extractDocumentContext(
  blocks: Block[],
  byId: Map<string, Block>,
): { context: DocumentContext; contextKeyIds: Set<string> } {
  let collectedAtText: string | undefined;
  let labName: string | undefined;
  const contextKeyIds = new Set<string>();

  for (const block of blocks) {
    if (block.BlockType !== "KEY_VALUE_SET") continue;
    if (!(block.EntityTypes ?? []).includes("KEY")) continue;
    const keyText = blockText(block, byId);
    if (keyText.length === 0) continue;

    const isDate = collectedAtText === undefined && DATE_KEY.test(keyText);
    const isLab = labName === undefined && LAB_KEY.test(keyText);
    if (!isDate && !isLab) continue;

    const valueBlock = valueBlockOf(block, byId);
    const valueText = valueBlock ? blockText(valueBlock, byId) : "";
    if (valueText.length === 0) continue;

    if (isDate) collectedAtText = valueText;
    else labName = valueText;
    if (block.Id) contextKeyIds.add(block.Id);
  }

  return { context: { collectedAtText, labName }, contextKeyIds };
}

/** FORMS — biomarker key/value pairs (excluding document-context keys). */
function mapForms(
  blocks: Block[],
  byId: Map<string, Block>,
  contextKeyIds: Set<string>,
): RawExtractedField[] {
  const fields: RawExtractedField[] = [];
  for (const block of blocks) {
    if (block.BlockType !== "KEY_VALUE_SET") continue;
    if (!(block.EntityTypes ?? []).includes("KEY")) continue;
    if (block.Id && contextKeyIds.has(block.Id)) continue; // date/lab key

    const biomarkerName = blockText(block, byId);
    if (biomarkerName.length === 0) continue;
    // A key that looks like document context but had no usable value still
    // must not become a bogus biomarker (e.g. "Data da Coleta" -> "15").
    if (DATE_KEY.test(biomarkerName) || LAB_KEY.test(biomarkerName)) continue;

    const valueBlock = valueBlockOf(block, byId);
    if (!valueBlock) continue;

    const split = splitValueUnit(blockText(valueBlock, byId));
    if (!split) continue;

    fields.push({
      biomarkerName,
      valueText: split.valueText,
      unitText: split.unitText,
      // The value block carries the confidence of the extracted datum;
      // fall back to the key block when Textract omits it on the value.
      confidence: normaliseConfidence(
        valueBlock.Confidence ?? block.Confidence,
      ),
    });
  }
  return fields;
}

/** TABLES — one `RawExtractedField` per data row with a numeric value. */
function mapTables(
  blocks: Block[],
  byId: Map<string, Block>,
): RawExtractedField[] {
  const fields: RawExtractedField[] = [];

  for (const table of blocks) {
    if (table.BlockType !== "TABLE") continue;

    // Collect this table's cells into a (row, col) grid.
    interface Cell {
      text: string;
      confidence: number;
    }
    const grid = new Map<number, Map<number, Cell>>();
    let maxRow = 0;
    let maxCol = 0;
    for (const cellId of relatedIds(table, "CHILD")) {
      const cell = byId.get(cellId);
      if (cell?.BlockType !== "CELL") continue;
      const row = cell.RowIndex ?? 0;
      const col = cell.ColumnIndex ?? 0;
      if (row === 0 || col === 0) continue;
      if (!grid.has(row)) grid.set(row, new Map());
      grid.get(row)?.set(col, {
        text: blockText(cell, byId),
        confidence: normaliseConfidence(cell.Confidence),
      });
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    }
    if (maxRow < 2 || maxCol < 2) continue; // need a header + ≥1 data row

    const header = grid.get(1);
    const headerText = (col: number): string => header?.get(col)?.text ?? "";

    // Column detection from the header. Reference-range columns are
    // excluded FIRST so a "Valor de referência" column (which contains
    // "valor") is never mistaken for the result column.
    let bioCol = 0;
    let valueCol = 0;
    let unitCol = 0;
    for (let col = 1; col <= maxCol; col += 1) {
      const text = headerText(col);
      if (REFERENCE_HEADER.test(text)) continue;
      if (bioCol === 0 && BIOMARKER_HEADER.test(text)) bioCol = col;
      if (valueCol === 0 && VALUE_HEADER.test(text)) valueCol = col;
      if (unitCol === 0 && UNIT_HEADER.test(text)) unitCol = col;
    }
    if (bioCol === 0) bioCol = 1;
    if (valueCol === 0) {
      // Fallback: first column (≠ bioCol, not a reference column) whose
      // body rows are mostly numeric.
      for (let col = 1; col <= maxCol && valueCol === 0; col += 1) {
        if (col === bioCol) continue;
        if (REFERENCE_HEADER.test(headerText(col))) continue;
        let numeric = 0;
        let total = 0;
        for (let row = 2; row <= maxRow; row += 1) {
          const text = grid.get(row)?.get(col)?.text ?? "";
          if (text.length === 0) continue;
          total += 1;
          if (splitValueUnit(text)) numeric += 1;
        }
        if (total > 0 && numeric * 2 >= total) valueCol = col;
      }
    }
    if (valueCol === 0) continue; // no value column → not a result table

    for (let row = 2; row <= maxRow; row += 1) {
      const rowCells = grid.get(row);
      if (!rowCells) continue;
      const biomarkerName = rowCells.get(bioCol)?.text ?? "";
      if (biomarkerName.length === 0) continue;
      const valueCell = rowCells.get(valueCol);
      if (!valueCell) continue;
      const split = splitValueUnit(valueCell.text);
      if (!split) continue; // row has no numeric value → skip

      // Prefer an explicit unit column (distinct from the value column);
      // else the remainder of the value cell.
      const explicitUnit =
        unitCol > 0 && unitCol !== valueCol
          ? (rowCells.get(unitCol)?.text ?? "")
          : "";
      const unitText = explicitUnit.length > 0 ? explicitUnit : split.unitText;

      fields.push({
        biomarkerName,
        valueText: split.valueText,
        unitText,
        confidence: valueCell.confidence,
      });
    }
  }

  return fields;
}

/**
 * Map a Textract `AnalyzeDocument` response into `RawExtractedField[]`.
 * Stamps the document-level collection date + lab name onto every field
 * (so the dispatcher can publish, not just quarantine), then de-dupes by
 * `name + valueText` keeping the higher-confidence occurrence.
 */
export function mapAnalyzeDocumentResponse(
  response: AnalyzeDocumentCommandOutput,
): RawExtractedField[] {
  const blocks = response.Blocks ?? [];
  if (blocks.length === 0) return [];

  const byId = indexBlocks(blocks);
  const { context, contextKeyIds } = extractDocumentContext(blocks, byId);
  const combined = [
    ...mapForms(blocks, byId, contextKeyIds),
    ...mapTables(blocks, byId),
  ];

  // De-duplicate by name + value (a datum reported by both a FORMS pair
  // and a table collapses; a distinct same-name measurement survives).
  const byKey = new Map<string, RawExtractedField>();
  for (const field of combined) {
    const stamped: RawExtractedField = {
      ...field,
      collectedAtText: context.collectedAtText,
      labName: context.labName,
    };
    const key = `${field.biomarkerName.toLowerCase()} ${field.valueText}`;
    const existing = byKey.get(key);
    if (!existing || stamped.confidence > existing.confidence) {
      byKey.set(key, stamped);
    }
  }
  return [...byKey.values()];
}
