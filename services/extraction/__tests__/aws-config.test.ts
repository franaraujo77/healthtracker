import { describe, expect, it } from "vitest";

import {
  assertAwsTextractConfig,
  AWS_TEXTRACT_REGION,
} from "../src/textract/aws-config.js";

/**
 * Story 9.2 — the boot gate is a pure function tested with fake env
 * objects (never `process.env`), so it is hermetic and asserts the
 * region pin + credential-presence rules without any live AWS call
 * (NFR-S8).
 */

const STATIC_KEYS = {
  AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  AWS_SECRET_ACCESS_KEY: "secret",
};

describe("assertAwsTextractConfig", () => {
  it("accepts sa-east-1 + static keys and returns the pinned region", () => {
    expect(
      assertAwsTextractConfig({ AWS_REGION: "sa-east-1", ...STATIC_KEYS }),
    ).toEqual({ region: "sa-east-1" });
  });

  it("defaults an unset region to sa-east-1 (pinned)", () => {
    expect(assertAwsTextractConfig({ ...STATIC_KEYS })).toEqual({
      region: AWS_TEXTRACT_REGION,
    });
  });

  it("throws when the region is not sa-east-1 (residency pin)", () => {
    expect(() =>
      assertAwsTextractConfig({ AWS_REGION: "us-east-1", ...STATIC_KEYS }),
    ).toThrow(/AWS_REGION must be 'sa-east-1'/);
  });

  it("treats a blank/whitespace AWS_REGION as unset (defaults to the pin)", () => {
    // A declared-but-empty env var ("") is the common Railway/Docker shape;
    // it must default, not crash boot.
    expect(assertAwsTextractConfig({ AWS_REGION: "", ...STATIC_KEYS })).toEqual(
      { region: AWS_TEXTRACT_REGION },
    );
    expect(
      assertAwsTextractConfig({ AWS_REGION: "  sa-east-1  ", ...STATIC_KEYS }),
    ).toEqual({ region: AWS_TEXTRACT_REGION });
  });

  it("throws when no credentials are resolvable", () => {
    expect(() => assertAwsTextractConfig({ AWS_REGION: "sa-east-1" })).toThrow(
      /No resolvable AWS credentials/,
    );
  });

  it("throws naming the DPA-signed account requirement", () => {
    expect(() => assertAwsTextractConfig({})).toThrow(/signed-DPA/);
  });

  it("accepts a container task role (no static keys)", () => {
    expect(
      assertAwsTextractConfig({
        AWS_REGION: "sa-east-1",
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc",
      }),
    ).toEqual({ region: "sa-east-1" });
  });

  it("accepts a web-identity task role (no static keys)", () => {
    expect(
      assertAwsTextractConfig({
        AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/secrets/token",
        AWS_ROLE_ARN: "arn:aws:iam::123:role/textract",
      }),
    ).toEqual({ region: AWS_TEXTRACT_REGION });
  });

  it("throws when only one half of the static key pair is present", () => {
    expect(() =>
      assertAwsTextractConfig({ AWS_ACCESS_KEY_ID: "AKIAEXAMPLE" }),
    ).toThrow(/No resolvable AWS credentials/);
  });

  it("rejects a web-identity token file with no AWS_ROLE_ARN (SDK can't resolve it)", () => {
    expect(() =>
      assertAwsTextractConfig({
        AWS_REGION: "sa-east-1",
        AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/secrets/token",
      }),
    ).toThrow(/No resolvable AWS credentials/);
  });
});
