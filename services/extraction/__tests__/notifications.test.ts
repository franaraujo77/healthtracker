import { describe, expect, it, vi } from "vitest";

import {
  buildNotificationPayload,
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
    expect(calls).toHaveLength(2);
  });

  it("revokes a token that comes back DeviceNotRegistered", async () => {
    const { boss, getHandler } = makeFakeBoss();
    const tokens = [{ id: "tok-1", expo_token: TOKENS[0] }];
    const { sql, calls } = makeFakeSql([
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
    // The 3rd SQL call is the UPDATE push_tokens SET revoked_at = now()
    expect(calls).toHaveLength(3);
  });

  it("skips silently when the upload row is missing", async () => {
    const { boss, getHandler } = makeFakeBoss();
    const { sql } = makeFakeSql([[]]);
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
