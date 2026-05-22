import { describe, expect, it } from "vitest";

import { buildNotificationPayload } from "../src/consumers/notifications.js";

const UPLOAD = {
  id: "11111111-1111-1111-1111-111111111111",
  original_filename: "hemograma-2024-03-15.pdf",
  failure_reason: null,
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
});
