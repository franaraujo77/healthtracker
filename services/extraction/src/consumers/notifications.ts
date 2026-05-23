import type { PgBoss } from "pg-boss";
import type postgres from "postgres";

import type { JobPayload } from "@healthtracker/types";

/**
 * Story 2.5 — consumer for the `notification.send` queue. Each job
 * carries `{ uploadId, patientId, kind }`. The handler:
 *   1. SELECTs active push tokens for the patient (revoked_at IS NULL).
 *   2. SELECTs upload metadata (original_filename, lab name aggregate).
 *   3. Builds the Expo Push payload per `kind`.
 *   4. POSTs to the Expo Push API in one batch.
 *   5. Parses tickets; on `DeviceNotRegistered`, soft-deletes the token.
 *
 * On transient errors (network / 5xx / rate-limit), the handler
 * throws — pg-boss retries with exponential backoff. The
 * `notification.send` queue uses `retryLimit: 5` to absorb Expo
 * Push API outages.
 */

export type NotificationKind = "complete" | "pending_review" | "failed";

interface NotificationSendPayload {
  uploadId: string;
  kind: NotificationKind;
}

interface PushTokenRow {
  id: string;
  expo_token: string;
}

interface UploadRow {
  id: string;
  original_filename: string;
  failure_reason: string | null;
  /** R1-P156 + F141 — lab_name as written by the extraction worker's
   *  dispatcher (dominant lab across published observations). Read
   *  directly from `uploads.lab_name` since F141; the correlated
   *  subquery on `observations` is gone. Falls back to null when no
   *  publishable observation was written (typical for
   *  `pending_review` / `failed`). */
  lab_name: string | null;
}

interface NotificationCopy {
  title: string;
  body: string;
}

// R1-P156 — AC2 says the body should identify the upload by lab
// name when available, falling back to the original filename. The
// notifications-consumer SELECT joins `observations` for the most
// common lab name. `pending_review` + `failed` paths typically
// won't have published observations, so they fall back as expected.
function bodyForUpload(u: UploadRow): string {
  return truncate(u.lab_name ?? u.original_filename, 60);
}

const COPY: Record<NotificationKind, (upload: UploadRow) => NotificationCopy> =
  {
    complete: (u) => ({
      title: "Seus resultados estão prontos para ver",
      body: bodyForUpload(u),
    }),
    pending_review: (u) => ({
      title: "Um resultado precisa da sua confirmação",
      body: bodyForUpload(u),
    }),
    failed: (u) => ({
      title:
        "Não conseguimos processar este arquivo. Toque para ver as opções.",
      body: bodyForUpload(u),
    }),
  };

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushClient {
  sendBatch(
    messages: {
      to: string;
      title: string;
      body: string;
      data: { uploadId: string; kind: NotificationKind; deepLink: string };
    }[],
  ): Promise<ExpoPushTicket[]>;
}

export function buildNotificationPayload(
  upload: UploadRow,
  kind: NotificationKind,
  tokens: string[],
): {
  to: string;
  title: string;
  body: string;
  data: { uploadId: string; kind: NotificationKind; deepLink: string };
}[] {
  const copy = COPY[kind](upload);
  return tokens.map((token) => ({
    to: token,
    title: copy.title,
    body: copy.body,
    data: {
      uploadId: upload.id,
      kind,
      deepLink: `/inicio/uploads/${upload.id}`,
    },
  }));
}

/**
 * Story 2.8 — preference gate. Maps the `kind` to the matching
 * `notification_preferences` column and returns true when the
 * patient has muted that family. A missing row (first-time patient)
 * is treated as all-true (no mute).
 *
 * Kind → column mapping (mirrors API helper docs):
 *   - complete       → results_ready
 *   - pending_review → review_required
 *   - failed         → results_ready (folded into the same toggle;
 *                                     spec Clarification #1)
 */
export async function isPreferenceMuted(
  sql: postgres.Sql,
  patientId: string,
  kind: NotificationKind,
): Promise<boolean> {
  // R1-P218 — fail-open on infra fault (table doesn't exist in some
  // env, column drift, transient DB blip). Without this guard the
  // throw bubbles to the handler's outer catch and pg-boss retries
  // forever; muting the gate is worse than over-delivering.
  let rows: {
    results_ready: boolean;
    letters_ready: boolean;
    record_access: boolean;
    review_required: boolean;
  }[];
  try {
    rows = await sql<
      {
        results_ready: boolean;
        letters_ready: boolean;
        record_access: boolean;
        review_required: boolean;
      }[]
    >`
      SELECT results_ready, letters_ready, record_access, review_required
      FROM notification_preferences
      WHERE patient_id = ${patientId}::uuid
      LIMIT 1
    `;
  } catch (err) {
    // R2-P226 — narrow fail-open to db/network-shaped errors so
    // programmer errors (TypeError, ReferenceError) still surface.
    // PG driver errors carry a `code` (SQLSTATE) or come from
    // `postgres`'s `PostgresError`; transient network errors match
    // the regex below.
    const isInfraFault =
      err instanceof TypeError === false &&
      err instanceof ReferenceError === false &&
      err instanceof SyntaxError === false &&
      err instanceof Error &&
      (("code" in err && typeof err.code === "string") ||
        /ECONN|ENETDOWN|ETIMEDOUT|timeout|connection/i.test(err.message));
    if (!isInfraFault) throw err;
    console.warn(
      `[notification.send] notification_preferences_lookup_failed patientId=${patientId} kind=${kind} — fail-open`,
      err,
    );
    return false;
  }
  const row = rows[0];
  if (!row) return false; // No row → all-true defaults; never muted.
  // R2-P229 — the mapping below must stay in sync with
  // `NOTIFICATION_KIND_TO_PREFERENCE` in `@healthtracker/validators`.
  // A snapshot test in `__tests__/notifications.test.ts` pins both
  // surfaces so a new kind can't silently desynchronize.
  switch (kind) {
    case "complete":
    case "failed":
      return row.results_ready === false;
    case "pending_review":
      return row.review_required === false;
    default: {
      const exhaustive: never = kind;
      void exhaustive;
      return false;
    }
  }
}

export async function registerNotificationsConsumer(
  boss: PgBoss,
  deps: {
    sql: postgres.Sql;
    expoPushClient: ExpoPushClient;
  },
): Promise<void> {
  await boss.work<JobPayload<NotificationSendPayload>>(
    "notification.send",
    { batchSize: 10 },
    async (jobs) => {
      for (const job of jobs) {
        const { uploadId, kind } = job.data.payload;
        const patientId = job.data.patientId;

        // Story 2.8 — preference gate. Skip the Expo Push POST when
        // the patient has muted the matching event family. Missing
        // row (first-time patient) is treated as all-true.
        if (await isPreferenceMuted(deps.sql, patientId, kind)) {
          console.log(
            `[notification.send] patientId=${patientId} kind=${kind}: muted by preference — skipping`,
          );
          continue;
        }

        // F141 — read lab_name straight from `uploads`; the dispatcher
        // populates it at observation-publish time (see
        // `consumers/document.ts`).
        const uploads = await deps.sql<UploadRow[]>`
          SELECT
            u.id,
            u.original_filename,
            u.metadata->>'reason' AS failure_reason,
            u.lab_name AS lab_name
          FROM uploads u
          WHERE u.id = ${uploadId}::uuid
          LIMIT 1
        `;
        const upload = uploads[0];
        if (!upload) {
          console.warn(
            `[notification.send] uploadId=${uploadId}: upload row missing — skipping`,
          );
          continue;
        }

        const tokens = await deps.sql<PushTokenRow[]>`
          SELECT id, expo_token
          FROM push_tokens
          WHERE patient_id = ${patientId}::uuid AND revoked_at IS NULL
        `;
        if (tokens.length === 0) {
          console.log(
            `[notification.send] patientId=${patientId}: no active push tokens — skipping`,
          );
          continue;
        }

        const messages = buildNotificationPayload(
          upload,
          kind,
          tokens.map((t) => t.expo_token),
        );
        const tickets = await deps.expoPushClient.sendBatch(messages);

        // Expo returns one ticket per message; same order. On
        // `DeviceNotRegistered`, soft-delete the corresponding
        // token so future sends skip it.
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const token = tokens[i];
          if (!ticket || !token) continue;
          if (
            ticket.status === "error" &&
            ticket.details?.error === "DeviceNotRegistered"
          ) {
            await deps.sql`
              UPDATE push_tokens
              SET revoked_at = now()
              WHERE id = ${token.id}::uuid
            `;
            console.warn(
              `[notification.send] token id=${token.id}: DeviceNotRegistered — revoked`,
            );
          } else if (ticket.status === "error") {
            console.error(
              `[notification.send] ticket error for token id=${token.id}: ${ticket.message ?? "unknown"}`,
            );
          }
        }
      }
    },
  );
}

/**
 * Default Expo Push client — POSTs to the public Expo Push API.
 * Anonymous use is allowed for `ExponentPushToken[...]` recipients;
 * an access token improves rate limits but is optional.
 *
 * R1-P157 — chunk messages in groups of 100 (the Expo API's per-call
 * cap). Patients with > 100 active devices would otherwise hit a
 * 413. Each chunk's tickets are appended to the response array in
 * the same order, preserving the consumer's positional ticket→token
 * mapping.
 */
const EXPO_PUSH_BATCH_SIZE = 100;

export function createDefaultExpoPushClient(opts?: {
  accessToken?: string;
}): ExpoPushClient {
  return {
    async sendBatch(messages) {
      if (messages.length === 0) return [];
      const allTickets: ExpoPushTicket[] = [];
      const chunkCount = Math.ceil(messages.length / EXPO_PUSH_BATCH_SIZE);
      for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH_SIZE) {
        const chunkIndex = Math.floor(i / EXPO_PUSH_BATCH_SIZE);
        const chunk = messages.slice(i, i + EXPO_PUSH_BATCH_SIZE);
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(opts?.accessToken
              ? { Authorization: `Bearer ${opts.accessToken}` }
              : {}),
          },
          body: JSON.stringify(chunk),
        });
        if (!response.ok) {
          // R2-P173 — log chunk progress before the throw so ops can
          // correlate duplicate pushes on pg-boss retry. F143 tracks
          // a future per-chunk receipt log so retries can skip
          // already-delivered chunks.
          throw new Error(
            `Expo Push API error: ${response.status} ${response.statusText} (chunk ${chunkIndex + 1}/${chunkCount}; ${i} messages already delivered will resend on retry)`,
          );
        }
        const json = (await response.json()) as { data?: ExpoPushTicket[] };
        allTickets.push(...(json.data ?? []));
      }
      return allTickets;
    },
  };
}
