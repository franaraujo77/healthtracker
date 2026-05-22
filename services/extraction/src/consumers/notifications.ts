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
}

interface NotificationCopy {
  title: string;
  body: string;
}

const COPY: Record<NotificationKind, (upload: UploadRow) => NotificationCopy> =
  {
    complete: (u) => ({
      title: "Seus resultados estão prontos para ver",
      body: truncate(u.original_filename, 60),
    }),
    pending_review: (u) => ({
      title: "Um resultado precisa da sua confirmação",
      body: truncate(u.original_filename, 60),
    }),
    failed: (u) => ({
      title: "Não conseguimos processar este arquivo. Toque para ver as opções.",
      body: truncate(u.original_filename, 60),
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
          SELECT id, original_filename, metadata->>'reason' AS failure_reason
          FROM uploads
          WHERE id = ${uploadId}::uuid
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
 */
export function createDefaultExpoPushClient(opts?: {
  accessToken?: string;
}): ExpoPushClient {
  return {
    async sendBatch(messages) {
      if (messages.length === 0) return [];
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(opts?.accessToken
            ? { Authorization: `Bearer ${opts.accessToken}` }
            : {}),
        },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        throw new Error(
          `Expo Push API error: ${response.status} ${response.statusText}`,
        );
      }
      const json = (await response.json()) as { data?: ExpoPushTicket[] };
      return json.data ?? [];
    },
  };
}
