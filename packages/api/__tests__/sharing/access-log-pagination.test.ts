/**
 * Story 5.3 T3.4 — synchronous unit tests for the Access Log
 * pagination helpers. These cover the pure pieces of the
 * `listAccessLog` resolver (cursor codec + token-status derivation)
 * without needing testcontainers; the SQL-shape assertions land in
 * the (Docker-gated) integration test.
 */
import { describe, expect, it } from "vitest";

import {
  ACCESS_LOG_EVENT_KINDS,
  ACCESS_LOG_EVENT_LABEL_PT_BR_FN,
  isAccessLogEventKind,
  listAccessLogInputSchema,
} from "@healthtracker/validators";

import {
  computeAccessLogTokenStatus,
  decodeAccessLogCursor,
  encodeAccessLogCursor,
  resolveAccessLogTokenStatus,
} from "../../src/sharing";

const FIXED_NOW = new Date("2026-05-26T12:00:00.000Z");

describe("Access Log cursor codec (Story 5.3 AC12)", () => {
  it("encodes a `{iso}|{uuid}` string", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const ts = new Date("2026-05-20T10:30:00.000Z");
    expect(encodeAccessLogCursor(ts, id)).toBe(
      `2026-05-20T10:30:00.000Z|${id}`,
    );
  });

  it("round-trips through decode", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const ts = new Date("2026-05-20T10:30:00.000Z");
    const decoded = decodeAccessLogCursor(encodeAccessLogCursor(ts, id));
    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe(id);
    expect(decoded?.createdAt.getTime()).toBe(ts.getTime());
  });

  it("returns null for an empty / undefined cursor", () => {
    expect(decodeAccessLogCursor(undefined)).toBeNull();
    expect(decodeAccessLogCursor("")).toBeNull();
  });

  it("returns null for a malformed cursor (no pipe)", () => {
    expect(decodeAccessLogCursor("2026-05-20T10:30:00.000Z")).toBeNull();
  });

  it("returns null for a non-UUID id portion", () => {
    expect(
      decodeAccessLogCursor("2026-05-20T10:30:00.000Z|not-a-uuid"),
    ).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(
      decodeAccessLogCursor("not-a-date|11111111-1111-4111-8111-111111111111"),
    ).toBeNull();
  });

  it("returns null for an empty id portion (avoids `iso|` rejection round-trip)", () => {
    expect(decodeAccessLogCursor("2026-05-20T10:30:00.000Z|")).toBeNull();
  });
});

describe("Access Log token-status derivation (Story 5.3 AC4)", () => {
  it("revoked beats every other state", () => {
    const past = new Date(FIXED_NOW.getTime() - 1_000);
    const future = new Date(FIXED_NOW.getTime() + 1_000);
    expect(computeAccessLogTokenStatus(future, past, FIXED_NOW)).toBe(
      "revogado",
    );
    expect(computeAccessLogTokenStatus(null, past, FIXED_NOW)).toBe("revogado");
  });

  it("null expires_at → 'sem prazo'", () => {
    expect(computeAccessLogTokenStatus(null, null, FIXED_NOW)).toBe(
      "sem prazo",
    );
  });

  it("expires_at <= now → 'expirado'", () => {
    const past = new Date(FIXED_NOW.getTime() - 1_000);
    expect(computeAccessLogTokenStatus(past, null, FIXED_NOW)).toBe("expirado");
    // Boundary — exactly `now` counts as expired (no negative leeway).
    expect(computeAccessLogTokenStatus(FIXED_NOW, null, FIXED_NOW)).toBe(
      "expirado",
    );
  });

  it("future expires_at → 'ativo'", () => {
    const future = new Date(FIXED_NOW.getTime() + 1_000);
    expect(computeAccessLogTokenStatus(future, null, FIXED_NOW)).toBe("ativo");
  });

  it("resolveAccessLogTokenStatus returns null when no token is joined", () => {
    expect(
      resolveAccessLogTokenStatus({
        hasJoinedToken: false,
        expiresAt: null,
        revokedAt: null,
        now: FIXED_NOW,
      }),
    ).toBeNull();
  });
});

describe("Access Log input schema (Story 5.3 AC4)", () => {
  it("defaults pageSize to 20", () => {
    const parsed = listAccessLogInputSchema.parse({});
    expect(parsed.pageSize).toBe(20);
  });

  it("clamps oversize pageSize via min/max guards", () => {
    expect(listAccessLogInputSchema.safeParse({ pageSize: 51 }).success).toBe(
      false,
    );
    expect(listAccessLogInputSchema.safeParse({ pageSize: 0 }).success).toBe(
      false,
    );
  });
});

describe("Access Log event allowlist (Story 5.3 AC11)", () => {
  // Story 5.5 — `record.exported` added to the allowlist (AC10).
  // Story 5.6 — `account.deletion_requested` added (AC10). The
  // system-actor `export.generated` / `export.failed` /
  // `account.deletion_completed` / `account.deletion_failed` stay OUT.
  it("contains exactly the 10 patient-actor kinds", () => {
    expect(new Set(ACCESS_LOG_EVENT_KINDS)).toEqual(
      new Set([
        "pending_invite.created",
        "share_token.created",
        "sharing.configured",
        "conversation_starter.queued",
        "conversation_starter.generated",
        "conversation_starter.failed",
        "share_token.revoked",
        "share_token.read",
        "record.exported",
        "account.deletion_requested",
      ]),
    );
  });

  it("isAccessLogEventKind narrows safe strings", () => {
    expect(isAccessLogEventKind("share_token.read")).toBe(true);
    expect(isAccessLogEventKind("letter.queued")).toBe(false);
    expect(isAccessLogEventKind("")).toBe(false);
  });
});

describe("Access Log event label copy (Story 5.3 AC2)", () => {
  it("renders pt-BR copy for every kind in the allowlist", () => {
    for (const kind of ACCESS_LOG_EVENT_KINDS) {
      const out = ACCESS_LOG_EVENT_LABEL_PT_BR_FN(kind, {
        displayName: "Dra. Renata",
        durationLabel: "7 dias",
        biomarkerChangeCount: 3,
      });
      expect(out).toMatch(/Dra\. Renata|Você/);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("pluralises 'alteração' / 'alterações' on sharing.configured", () => {
    const one = ACCESS_LOG_EVENT_LABEL_PT_BR_FN("sharing.configured", {
      displayName: "Dra. Renata",
      biomarkerChangeCount: 1,
    });
    const many = ACCESS_LOG_EVENT_LABEL_PT_BR_FN("sharing.configured", {
      displayName: "Dra. Renata",
      biomarkerChangeCount: 3,
    });
    expect(one).toContain("1 alteração");
    expect(many).toContain("3 alterações");
  });

  // Patch #9 (2026-05-26) — `(0 alterações)` is hostile copy on
  // historical / no-change rows. Distinct phrasing without the
  // parenthetical when the count is zero; preserve the existing
  // wording when count > 0.
  it("sharing.configured: drops the parenthetical when biomarkerChangeCount is 0", () => {
    const zero = ACCESS_LOG_EVENT_LABEL_PT_BR_FN("sharing.configured", {
      displayName: "Dra. Renata",
      biomarkerChangeCount: 0,
    });
    expect(zero).toBe("Você revisou as visibilidades para Dra. Renata.");
    expect(zero).not.toContain("0 alterações");
    expect(zero).not.toContain("(");
  });

  it("sharing.configured: keeps the parenthetical when biomarkerChangeCount > 0", () => {
    const some = ACCESS_LOG_EVENT_LABEL_PT_BR_FN("sharing.configured", {
      displayName: "Dra. Renata",
      biomarkerChangeCount: 2,
    });
    expect(some).toBe(
      "Você atualizou as visibilidades para Dra. Renata (2 alterações).",
    );
  });

  it("omits the duration clause when no durationLabel is provided", () => {
    const out = ACCESS_LOG_EVENT_LABEL_PT_BR_FN("share_token.created", {
      displayName: "Dra. Renata",
    });
    expect(out).not.toContain("por undefined");
    expect(out).toContain("Dra. Renata");
  });
});
