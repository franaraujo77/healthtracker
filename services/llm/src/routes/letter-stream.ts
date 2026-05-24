import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type postgres from "postgres";

import { verifyJwt } from "../auth.js";
import { subscribe } from "../streams/letter-fanout.js";

interface RouteParams {
  letterId: string;
}

interface LetterStatusRow {
  patient_id: string;
  status: "queued" | "generating" | "complete" | "failed";
  body: string | null;
  failure_reason: string | null;
}

/**
 * Story 4.1 — `GET /api/stream/letter/:letterId` SSE endpoint.
 *
 * Event contract (verbatim from architecture.md §7 lines 757–772):
 *   data: {"type":"token","content":"..."}\n\n
 *   data: {"type":"done","letterId":"..."}\n\n
 *   data: {"type":"error","code":"LETTER_UNAVAILABLE"}\n\n
 *
 * Authorization model: `404` on missing letter / wrong patient — do
 * NOT return `403` (leaks existence). `letters.patient_id !=
 * auth.uid()` returns `404` even if the row exists.
 *
 * Idempotent re-open: when the letter is already `complete` at the
 * time the client connects, the handler emits the cached body as
 * one token then `done` — no Anthropic call.
 */
export function registerLetterStreamRoute(
  app: FastifyInstance,
  deps: { sql: postgres.Sql },
): void {
  app.get<{ Params: RouteParams }>(
    "/api/stream/letter/:letterId",
    async (
      request: FastifyRequest<{ Params: RouteParams }>,
      reply: FastifyReply,
    ) => {
      const userId = await verifyJwt(request.headers.authorization);
      if (!userId) {
        await reply.code(401).send({ error: "unauthorized" });
        return;
      }
      const { letterId } = request.params;

      const rows = await deps.sql<LetterStatusRow[]>`
        SELECT patient_id, status, body, failure_reason
        FROM letters
        WHERE id = ${letterId}::uuid
        LIMIT 1
      `;
      const letter = rows[0];
      if (letter?.patient_id !== userId) {
        await reply.code(404).send({ error: "not_found" });
        return;
      }

      // Audit the read. NFR-S4 audit-log discipline. Fail-open on
      // audit-write error (network/db blip) so the patient still
      // sees their Letter — but log loudly so ops can investigate.
      try {
        await deps.sql`
          INSERT INTO audit_log
            (actor_id, actor_type, event, resource_id, resource_type, metadata)
          VALUES (
            ${letter.patient_id}::uuid,
            'patient',
            'letter.read',
            ${letterId}::uuid,
            'letter',
            '{}'::jsonb
          )
        `;
      } catch (err) {
        console.warn(
          `[letter-stream] letterId=${letterId}: audit.letter.read write failed`,
          err,
        );
      }

      reply.raw.statusCode = 200;
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.hijack();

      const write = (payload: Record<string, unknown>): void => {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // Already terminal — replay cached body (re-read path).
      if (letter.status === "complete" && letter.body !== null) {
        write({ type: "token", content: letter.body });
        write({ type: "done", letterId });
        reply.raw.end();
        return;
      }
      if (letter.status === "failed") {
        write({
          type: "error",
          code: letter.failure_reason ?? "LETTER_UNAVAILABLE",
        });
        reply.raw.end();
        return;
      }

      // queued or generating — attach to the in-process fan-out.
      let closed = false;
      const unsubscribe = subscribe(letterId, (event) => {
        if (closed) return;
        write(event);
        if (event.type === "done" || event.type === "error") {
          closed = true;
          unsubscribe();
          reply.raw.end();
        }
      });

      request.raw.on("close", () => {
        closed = true;
        unsubscribe();
      });
    },
  );
}
