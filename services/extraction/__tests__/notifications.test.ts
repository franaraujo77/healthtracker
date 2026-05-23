import { describe, expect, it, vi } from "vitest";

import {
  buildNotificationPayload,
  isPreferenceMuted,
  registerNotificationsConsumer,
} from "../src/consumers/notifications.js";

const UPLOAD = {
  id: "11111111-1111-1111-1111-111111111111",
  original_filename: "hemograma-2024-03-15.pdf",
  failure_reason: null,
  lab_name: null,
};

const TOKENS = ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"];

describe("buildNotificationPayload", () => {
  it("renders the AC2 copy for 'complete'", () => {
    const out = buildNotificationPayload(UPLOAD, "complete", TOKENS);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      to: "ExponentPushToken[aaa]",
      title: "Seus resultados estão prontos para ver",
      body: UPLOAD.original_filename,
      data: {
        uploadId: UPLOAD.id,
        kind: "complete",
        deepLink: `/inicio/uploads/${UPLOAD.id}`,
      },
    });
  });

  it("renders the AC3 copy for 'pending_review' (no alarm language)", () => {
    const out = buildNotificationPayload(UPLOAD, "pending_review", [
      TOKENS[0]!,
    ]);
    expect(out[0]?.title).toBe("Um resultado precisa da sua confirmação");
    expect(out[0]?.data.kind).toBe("pending_review");
  });

  it("renders the AC4 copy for 'failed' with the tap-for-options prompt", () => {
    const out = buildNotificationPayload(UPLOAD, "failed", [TOKENS[0]!]);
    expect(out[0]?.title).toBe(
      "Não conseguimos processar este arquivo. Toque para ver as opções.",
    );
  });

  it("truncates filenames longer than 60 chars with an ellipsis", () => {
    const longName = "a".repeat(80) + ".pdf";
    const out = buildNotificationPayload(
      { ...UPLOAD, original_filename: longName },
      "complete",
      [TOKENS[0]!],
    );
    expect(out[0]?.body.length).toBeLessThanOrEqual(60);
    expect(out[0]?.body.endsWith("…")).toBe(true);
  });

  it("emits zero messages for an empty token list", () => {
    expect(buildNotificationPayload(UPLOAD, "complete", [])).toEqual([]);
  });

  it("R1-P156 — prefers lab_name over original_filename when available", () => {
    const out = buildNotificationPayload(
      { ...UPLOAD, lab_name: "Fleury" },
      "complete",
      [TOKENS[0]!],
    );
    expect(out[0]?.body).toBe("Fleury");
  });
});

/**
 * R2-P178 — handler-level tests for `registerNotificationsConsumer`.
 * The fake `boss.work` captures the handler so we can invoke it
 * directly with a synthetic job; the fake `sql` returns scripted
 * results per call.
 */
function makeFakeBoss() {
  let handler:
    | ((jobs: { data: { patientId: string; payload: { uploadId: string; kind: string } } }[]) => Promise<void>)
    | undefined;
  const work = vi.fn((_name: string, _opts: unknown, h: typeof handler) => {
    handler = h;
    return Promise.resolve();
  });
  return {
    boss: { work } as unknown as Parameters<typeof registerNotificationsConsumer>[0],
    getHandler: () => handler!,
  };
}

interface SqlCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(responses: unknown[][]) {
  const queue = [...responses];
  const calls: SqlCall[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as Parameters<typeof registerNotificationsConsumer>[1]["sql"];
  return { sql, calls };
}

describe("registerNotificationsConsumer handler", () => {
  it("skips when the patient has zero active push tokens", async () => {
    const { boss, getHandler } = makeFakeBoss();
    const { sql, calls } = makeFakeSql([
      // Story 2.8 — preference gate SELECT (no row → all-true → not muted)
      [],
      // upload SELECT
      [UPLOAD],
      // tokens SELECT — empty
      [],
    ]);
    const sendBatch = vi.fn(() => Promise.resolve([]));
    await registerNotificationsConsumer(boss, {
      sql,
      expoPushClient: { sendBatch },
    });
    await getHandler()([
      {
        data: { patientId: "p-1", payload: { uploadId: UPLOAD.id, kind: "complete" } },
      },
    ]);
    expect(sendBatch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(3);
  });

  it("revokes a token that comes back DeviceNotRegistered", async () => {
    const { boss, getHandler } = makeFakeBoss();
    const tokens = [{ id: "tok-1", expo_token: TOKENS[0] }];
    const { sql, calls } = makeFakeSql([
      // Story 2.8 — preference gate (no row → not muted)
      [],
      [UPLOAD],
      tokens,
      // The UPDATE on revoke — no rows expected back
      [],
    ]);
    const sendBatch = vi.fn(() =>
      Promise.resolve([
        { status: "error", details: { error: "DeviceNotRegistered" } },
      ]),
    );
    await registerNotificationsConsumer(boss, {
      sql,
      expoPushClient: { sendBatch },
    });
    await getHandler()([
      {
        data: { patientId: "p-1", payload: { uploadId: UPLOAD.id, kind: "complete" } },
      },
    ]);
    expect(sendBatch).toHaveBeenCalledTimes(1);
    // 4 SQL calls: prefs gate + upload + tokens + revoke UPDATE.
    expect(calls).toHaveLength(4);
  });

  it("skips silently when the upload row is missing", async () => {
    const { boss, getHandler } = makeFakeBoss();
    // prefs gate (empty), then upload SELECT (empty → missing).
    const { sql } = makeFakeSql([[], []]);
    const sendBatch = vi.fn(() => Promise.resolve([]));
    await registerNotificationsConsumer(boss, {
      sql,
      expoPushClient: { sendBatch },
    });
    await getHandler()([
      {
        data: { patientId: "p-1", payload: { uploadId: UPLOAD.id, kind: "complete" } },
      },
    ]);
    expect(sendBatch).not.toHaveBeenCalled();
  });
});

describe("isPreferenceMuted — Story 2.8 preference gate", () => {
  function makeSqlReturning(rows: unknown[]) {
    return ((strings: TemplateStringsArray, ..._values: unknown[]) => {
      void strings;
      return Promise.resolve(rows);
    }) as unknown as Parameters<typeof isPreferenceMuted>[0];
  }

  it("returns false (not muted) when no preference row exists — all-true default", async () => {
    const sql = makeSqlReturning([]);
    expect(await isPreferenceMuted(sql, "p-1", "complete")).toBe(false);
    expect(await isPreferenceMuted(sql, "p-1", "pending_review")).toBe(false);
    expect(await isPreferenceMuted(sql, "p-1", "failed")).toBe(false);
  });

  it("kind=complete checks results_ready", async () => {
    const muted = makeSqlReturning([
      {
        results_ready: false,
        letters_ready: true,
        record_access: true,
        review_required: true,
      },
    ]);
    expect(await isPreferenceMuted(muted, "p-1", "complete")).toBe(true);
    const unmuted = makeSqlReturning([
      {
        results_ready: true,
        letters_ready: false,
        record_access: false,
        review_required: false,
      },
    ]);
    expect(await isPreferenceMuted(unmuted, "p-1", "complete")).toBe(false);
  });

  it("kind=failed also checks results_ready (folded by Clarification #1)", async () => {
    const muted = makeSqlReturning([
      {
        results_ready: false,
        letters_ready: true,
        record_access: true,
        review_required: true,
      },
    ]);
    expect(await isPreferenceMuted(muted, "p-1", "failed")).toBe(true);
  });

  it("kind=pending_review checks review_required", async () => {
    const muted = makeSqlReturning([
      {
        results_ready: true,
        letters_ready: true,
        record_access: true,
        review_required: false,
      },
    ]);
    expect(await isPreferenceMuted(muted, "p-1", "pending_review")).toBe(true);
    // A mute on results_ready should NOT affect pending_review.
    const partial = makeSqlReturning([
      {
        results_ready: false,
        letters_ready: true,
        record_access: true,
        review_required: true,
      },
    ]);
    expect(await isPreferenceMuted(partial, "p-1", "pending_review")).toBe(
      false,
    );
  });
});

describe("R2-P229 — kind→preference snapshot sync", () => {
  it("worker isPreferenceMuted handles every NotificationKind", async () => {
    // Pin the worker's behavior: each kind in the union has a
    // defined response (true/false) for both muted and unmuted
    // states. If a new kind is added to `emit.ts` without updating
    // the switch in `isPreferenceMuted`, the exhaustiveness `never`
    // check at compile-time + this runtime snapshot pin both halves.
    const sqlMuted = ((strings: TemplateStringsArray) => {
      void strings;
      return Promise.resolve([
        {
          results_ready: false,
          letters_ready: false,
          record_access: false,
          review_required: false,
        },
      ]);
    }) as unknown as Parameters<typeof isPreferenceMuted>[0];
    expect(await isPreferenceMuted(sqlMuted, "p", "complete")).toBe(true);
    expect(await isPreferenceMuted(sqlMuted, "p", "pending_review")).toBe(true);
    expect(await isPreferenceMuted(sqlMuted, "p", "failed")).toBe(true);
  });
});
