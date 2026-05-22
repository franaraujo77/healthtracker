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
  /** R1-P156 — most-common lab_name across the upload's
   *  observations; falls back to null when none have published yet
   *  (typical for `pending_review` or `failed` notifications). */
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
      title: "Não conseguimos processar este arquivo. Toque para ver as opções.",
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

        const uploads = await deps.sql<UploadRow[]>`
          SELECT
            u.id,
            u.original_filename,
            u.metadata->>'reason' AS failure_reason,
            (
              SELECT lab_name
              FROM observations
              WHERE upload_id = u.id AND lab_name IS NOT NULL
              GROUP BY lab_name
              ORDER BY count(*) DESC
              LIMIT 1
            ) AS lab_name
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
