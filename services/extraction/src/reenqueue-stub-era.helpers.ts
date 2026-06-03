import type { ExtractDocumentPayload } from "@healthtracker/types";

/**
 * Story 9.4 — pure planner for the one-shot stub-era re-enqueue script.
 * No DB, no pg-boss, no `process.*` — so the candidacy + arg logic is
 * unit-tested directly. The script (`reenqueue-stub-era.ts`) wires these
 * around `sql` (the flip) + `boss.send` (the enqueue).
 *
 * Reconciliation (see story Dev Notes): the epic's `NOT_IMPLEMENTED` /
 * `no_fixture` are error *messages*, not `uploads.metadata.reason` values
 * — after pg-boss retry exhaustion the old stub/mock failures were stored
 * as `retries_exhausted`. So the reliable discriminator is the `--before`
 * timestamp (failed before `EXTRACTION_ADAPTER=aws` went live = stub era);
 * the reason set is a defensive secondary narrowing.
 */

/** Stored `uploads.metadata.reason` values a stub-era failure plausibly carries. */
export const DEFAULT_STUB_ERA_REASONS = [
  "retries_exhausted",
  "extraction_unavailable",
  "no_readable_text",
  "no_publishable_fields",
] as const;

/** Explicit ISO-8601 instant: `YYYY-MM-DDThh:mm[:ss[.sss]]` + `Z`/offset. */
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** The closed `mimeType` allowlist the extraction payload accepts. */
const ALLOWED_MIME_TYPES = new Set<ExtractDocumentPayload["mimeType"]>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);

export interface ReenqueueArgs {
  apply: boolean;
  before: Date | null;
  reasons: string[];
}

/** Parse the script CLI args. Throws on an unparseable `--before` date. */
export function parseReenqueueArgs(argv: string[]): ReenqueueArgs {
  let apply = false;
  let before: Date | null = null;
  let reasons: string[] = [...DEFAULT_STUB_ERA_REASONS];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--before") {
      const raw = argv[i + 1];
      i += 1;
      // Require an explicit ISO-8601 instant (not the loose Date.parse
      // grammar) — a destructive cutoff must be unambiguous + UTC-anchored.
      if (raw === undefined || !ISO_8601_RE.test(raw)) {
        throw new Error(
          `--before requires an ISO-8601 timestamp (e.g. 2026-06-15T00:00:00Z); got '${raw ?? ""}'`,
        );
      }
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed)) {
        throw new Error(`--before is not a valid date: '${raw}'`);
      }
      before = new Date(parsed);
    } else if (arg === "--reasons") {
      const raw = argv[i + 1];
      i += 1;
      const list = (raw ?? "")
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      if (list.length === 0) {
        throw new Error("--reasons requires a comma-separated list of reasons");
      }
      reasons = list;
    } else {
      throw new Error(`Unknown argument: '${arg ?? ""}'`);
    }
  }

  return { apply, before, reasons };
}

/**
 * Refuse to mutate without a cutoff (AC3): `--apply` MUST be paired with
 * `--before` so a genuine post-launch failure can never be re-enqueued.
 */
export function assertApplyPreconditions(args: {
  apply: boolean;
  before: Date | null;
}): void {
  if (args.apply && args.before === null) {
    throw new Error(
      "Refusing to --apply without --before <iso>: a cutoff is required so " +
        "post-launch failures are never re-enqueued. Run a dry-run first, then " +
        "pass --before <aws-launch-timestamp>.",
    );
  }
}

export interface FailedUploadRow {
  status: string;
  reason: string | null;
  updatedAt: Date;
}

/**
 * Defensive in-JS mirror of the SQL candidate filter (both must agree):
 * a `failed` upload, failed before the cutoff (if any), with a stub-era reason.
 */
export function isStubEraFailure(
  row: FailedUploadRow,
  opts: { before: Date | null; reasons: string[] },
): boolean {
  if (row.status !== "failed") return false;
  if (opts.before !== null && row.updatedAt >= opts.before) return false;
  return row.reason !== null && opts.reasons.includes(row.reason);
}

export interface UploadPayloadColumns {
  uploadId: string;
  storagePath: string | null;
  idempotencyKey: string | null;
  mimeType: string | null;
}

/**
 * Reconstruct the `extraction.document` payload from the upload row.
 * Throws if a required column is null (a `failed` upload should still
 * carry these — a null means the row is corrupt and must not be re-enqueued).
 */
export function toExtractPayload(
  row: UploadPayloadColumns,
): ExtractDocumentPayload {
  if (!row.storagePath || !row.idempotencyKey || !row.mimeType) {
    throw new Error(
      `upload ${row.uploadId} is missing required columns for re-enqueue ` +
        `(storagePath/idempotencyKey/mimeType); skipping`,
    );
  }
  if (
    !ALLOWED_MIME_TYPES.has(row.mimeType as ExtractDocumentPayload["mimeType"])
  ) {
    throw new Error(
      `upload ${row.uploadId} has an unsupported mimeType '${row.mimeType}'; skipping`,
    );
  }
  return {
    uploadId: row.uploadId,
    storagePath: row.storagePath,
    idempotencyKey: row.idempotencyKey,
    mimeType: row.mimeType as ExtractDocumentPayload["mimeType"],
  };
}
