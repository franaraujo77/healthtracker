import { z } from "zod/v4";

/**
 * Story 7.4 — voice memo validators and pt-BR copy.
 *
 * Patient-authored 30-second audio attached to a specific upload.
 * Same privacy backbone as life events / emotional check-ins:
 * `privacy_flag = 'patient_only'`, audit kind out of
 * `ACCESS_LOG_EVENT_KINDS`, denial-by-RLS-absence.
 *
 * Schema twin: `packages/db/src/schema/voice_memos.ts`.
 */

/** AC3 — 30-second cap. */
export const VOICE_MEMO_MAX_DURATION_MS = 30_000 as const;

export const VOICE_MEMO_PRIVACY_FLAGS = ["patient_only"] as const;
export type VoiceMemoPrivacyFlag = (typeof VOICE_MEMO_PRIVACY_FLAGS)[number];

/**
 * AC5 — `attachToUpload` mutation input. The client uploads the audio
 * file to Supabase Storage at `<patientId>/<voiceMemoId>.m4a` first,
 * THEN calls this mutation with the storage_path + duration. The
 * resolver validates ownership, path prefix, storage existence, and
 * the (upload_id) UNIQUE before writing the row.
 *
 * `storagePath` MUST start with `<patientId>/` — defense-in-depth
 * against a forged path that would otherwise INSERT a row pointing
 * to a foreign patient's folder.
 */
export const attachVoiceMemoInputSchema = z
  .object({
    uploadId: z.string().uuid(),
    storagePath: z.string().trim().min(1).max(512),
    durationMs: z.number().int().min(1).max(VOICE_MEMO_MAX_DURATION_MS),
  })
  .strict();
export type AttachVoiceMemoInput = z.infer<typeof attachVoiceMemoInputSchema>;

export const voiceMemoViewSchema = z.object({
  id: z.string().uuid(),
  uploadId: z.string().uuid(),
  storagePath: z.string(),
  durationMs: z.number(),
  privacyFlag: z.enum(VOICE_MEMO_PRIVACY_FLAGS),
  createdAt: z.date(),
});
export type VoiceMemoView = z.infer<typeof voiceMemoViewSchema>;

// ---------------------------------------------------------------------------
// pt-BR UI copy (AC10).
// ---------------------------------------------------------------------------

export const VOICE_MEMO_CTA_PT_BR = "Adicionar memo de voz";
export const VOICE_MEMO_RECORDER_TITLE_PT_BR =
  "Conte como você está se sentindo";
export const VOICE_MEMO_RECORD_PT_BR = "Gravar";
export const VOICE_MEMO_STOP_PT_BR = "Parar";
export const VOICE_MEMO_SAVE_PT_BR = "Salvar";
export const VOICE_MEMO_SKIP_PT_BR = "Pular";
export const VOICE_MEMO_PRIVACY_HINT_PT_BR =
  "Máximo 30 segundos · Apenas para você";
export const VOICE_MEMO_LIMIT_REACHED_PT_BR = "Limite de 30 segundos atingido.";
export const VOICE_MEMO_PERMISSION_DENIED_PT_BR =
  "Permita o acesso ao microfone para gravar.";
export const VOICE_MEMO_SAVED_PT_BR = "Memo de voz salvo.";
export const VOICE_MEMO_SAVE_ERROR_PT_BR =
  "Não conseguimos salvar — tente novamente.";

/** Supabase Storage bucket name. */
export const VOICE_MEMOS_STORAGE_BUCKET = "voice_memos";

/**
 * Helper — emit the canonical Storage path for a patient's voice memo.
 * Used at upload time (client → Storage) AND server-side at validation.
 */
export function voiceMemoStoragePath(
  patientId: string,
  voiceMemoId: string,
): string {
  return `${patientId}/${voiceMemoId}.m4a`;
}

/**
 * Server-side path-prefix validator. Asserts the path starts with the
 * patient's id segment AND contains no traversal segments — so a
 * forged input cannot point at a foreign folder via `..`.
 *
 * R1-M1 — `..` and `\\` are rejected in addition to the prefix check
 * because Supabase Storage's server-side path normalization is not
 * uniformly applied by the JS SDK's `list()` API; the existence probe
 * runs as service-role and bypasses Storage RLS.
 */
export function isOwnVoiceMemoStoragePath(
  storagePath: string,
  patientId: string,
): boolean {
  if (!storagePath.startsWith(`${patientId}/`)) return false;
  if (storagePath.includes("..")) return false;
  if (storagePath.includes("\\")) return false;
  // Exactly one `/` separator (patient prefix + bare filename).
  const slashCount = storagePath.split("/").length - 1;
  if (slashCount !== 1) return false;
  return true;
}
