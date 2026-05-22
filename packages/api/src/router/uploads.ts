import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import {
  isUploadMimeType,
  sanitizeFilename,
  UPLOAD_MAX_BYTES,
  UploadImportConfirmSchema,
  UploadImportRequestSchema,
} from "@healthtracker/validators";

import { writeAuditLog } from "../audit";
import {
  buildLabUploadStoragePath,
  createLabUploadSignedUrl,
  statLabUploadObject,
} from "../storage";
import { protectedProcedure } from "../trpc";
import { enqueueExtractDocument, writeUpload } from "../uploads";

export const uploadsRouter = {
  /**
   * Story 1.5 — request a signed upload URL for the onboarding import
   * (or, later, post-onboarding upload) flow. Returns the URL + the
   * server-generated `idempotencyKey` + the storage path the client
   * must use; the client `PUT`s the file bytes to the URL and then
   * calls `confirmImport` to finalize.
   *
   * Does NOT write the `uploads` row yet — that lands in `confirmImport`
   * after the client confirms the storage write succeeded. A client
   * that crashes mid-upload leaves at most an orphan storage object
   * (cleaned by a sweep job; deferred to Epic 5 / 8 ops).
   */
  requestImport: protectedProcedure
    .input(UploadImportRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      const idempotencyKey = crypto.randomUUID();
      const sanitizedFilename = sanitizeFilename(input.originalFilename);
      const storagePath = buildLabUploadStoragePath({
        patientId,
        idempotencyKey,
        sanitizedFilename,
      });
      const uploadUrl = await createLabUploadSignedUrl(storagePath);
      return { idempotencyKey, storagePath, uploadUrl };
    }),

  /**
   * Story 1.5 — finalize the import after the client `PUT`s the file
   * bytes. Writes the `uploads` row (idempotent on the server-generated
   * `idempotency_key` UNIQUE seam), enqueues the `extraction.document`
   * job, and emits the `upload.queued` audit event.
   *
   * All three writes run inside the outer `protectedProcedure`
   * transaction wrap (Story 1.4 P27 investigation), so a throw from
   * any step rolls back the others — no orphan rows, no orphan jobs.
   * Ordering: write upload row → enqueue job → emit audit. If audit
   * throws, both the row and the queued job are rolled back; the
   * client retries with the same `idempotencyKey` and the
   * ON CONFLICT no-op makes the second attempt safe.
   */
  confirmImport: protectedProcedure
    .input(UploadImportConfirmSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      // Review P38 — re-derive `storagePath` server-side from
      // `(patientId, idempotencyKey, sanitizeFilename(originalFilename))`.
      // The client used to send `storagePath` echoed back from
      // `requestImport`; trusting that echo let a hostile client point
      // a `uploads` row at any string. We rebuild the path here and
      // ignore whatever the client sent.
      const sanitizedFilename = sanitizeFilename(input.originalFilename);
      const storagePath = buildLabUploadStoragePath({
        patientId,
        idempotencyKey: input.idempotencyKey,
        sanitizedFilename,
      });

      // Review P39 — verify the storage object actually exists at the
      // server-derived path before writing the row + enqueueing the
      // extraction job. A client that calls `confirmImport` without a
      // prior PUT (or with a forged idempotencyKey it never requested)
      // hits a `NOT_FOUND` here.
      const stored = await statLabUploadObject(storagePath);
      if (!stored) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "UPLOAD_OBJECT_NOT_FOUND",
        });
      }

      // Round-2 P51 — bound-check the server-reported size against
      // UPLOAD_MAX_BYTES. Supabase Storage has no per-bucket size cap
      // configured here; without this check, a client can PUT 50 MB
      // to the signed URL and we'd record it in the DB + enqueue
      // extraction work that breaks NFR-P1.
      if (stored.sizeBytes > UPLOAD_MAX_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "UPLOAD_OBJECT_TOO_LARGE",
        });
      }

      // Round-2 P49 — hard-reject when Supabase reports a content
      // type outside the allowed list (commonly
      // `application/octet-stream` for unrecognised binaries). Round-1
      // P42's previous fallback to `input.mimeType` re-opened the
      // client-trust hole P42 was meant to close: the audit log would
      // have recorded whatever the client claimed. Now the only
      // accepted path is storage-reported AND in the allowlist.
      if (!stored.contentType || !isUploadMimeType(stored.contentType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "UPLOAD_OBJECT_UNSUPPORTED_MIME",
        });
      }
      const storedContentType = stored.contentType;

      const insertedRow = await writeUpload(ctx.db, {
        patientId,
        idempotencyKey: input.idempotencyKey,
        storagePath,
        mimeType: storedContentType,
        sizeBytes: stored.sizeBytes,
        originalFilename: input.originalFilename,
        source: "onboarding_import",
      });

      if (!insertedRow) {
        // Idempotent path — the same `idempotency_key` was submitted
        // before (offline retry). No second job, no second audit.
        return { uploadId: null, created: false as const };
      }

      await enqueueExtractDocument(ctx.db, {
        patientId,
        payload: {
          uploadId: insertedRow.id,
          storagePath,
          idempotencyKey: input.idempotencyKey,
          mimeType: storedContentType,
        },
      });

      await writeAuditLog(ctx.db, {
        actorId: patientId,
        actorType: "patient",
        event: "upload.queued",
        resourceId: insertedRow.id,
        resourceType: "upload",
        metadata: {
          source: "onboarding_import",
          mimeType: storedContentType,
          sizeBytes: stored.sizeBytes,
          actor: "self",
        },
      });

      return { uploadId: insertedRow.id, created: true as const };
    }),
} satisfies TRPCRouterRecord;
