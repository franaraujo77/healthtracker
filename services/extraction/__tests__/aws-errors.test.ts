import { describe, expect, it } from "vitest";

import {
  isProgrammerError,
  isTransientTextractError,
} from "../src/textract/aws-errors.js";

describe("isProgrammerError", () => {
  it("is true for TypeError / ReferenceError / SyntaxError", () => {
    expect(isProgrammerError(new TypeError("x"))).toBe(true);
    expect(isProgrammerError(new ReferenceError("x"))).toBe(true);
    expect(isProgrammerError(new SyntaxError("x"))).toBe(true);
  });

  it("is false for a plain Error, an SDK error, and non-errors", () => {
    expect(isProgrammerError(new Error("x"))).toBe(false);
    expect(
      isProgrammerError({ name: "ThrottlingException", message: "x" }),
    ).toBe(false);
    expect(isProgrammerError(null)).toBe(false);
    expect(isProgrammerError("boom")).toBe(false);
  });
});

describe("isTransientTextractError", () => {
  it("is true when the SDK marks the error $retryable", () => {
    expect(
      isTransientTextractError(
        Object.assign(new Error("throttled"), {
          name: "ThrottlingException",
          $retryable: { throttling: true },
        }),
      ),
    ).toBe(true);
  });

  it("is true for a 5xx httpStatusCode", () => {
    expect(
      isTransientTextractError({ $metadata: { httpStatusCode: 503 } }),
    ).toBe(true);
    expect(
      isTransientTextractError({ $metadata: { httpStatusCode: 500 } }),
    ).toBe(true);
  });

  it("is true for a known throttle/server name (case-insensitive)", () => {
    expect(isTransientTextractError({ name: "ThrottlingException" })).toBe(
      true,
    );
    expect(isTransientTextractError({ name: "serviceunavailable" })).toBe(true);
    expect(isTransientTextractError({ name: "InternalServerError" })).toBe(
      true,
    );
  });

  it("is true for Textract LimitExceededException (a real throttle)", () => {
    // AWS includes LimitExceededException in THROTTLING_ERROR_CODES; it is a
    // concurrency/transaction-limit back-pressure error that should retry.
    expect(
      isTransientTextractError({
        name: "LimitExceededException",
        $metadata: { httpStatusCode: 429 },
      }),
    ).toBe(true);
  });

  it("is true for an HTTP 429 throttle even with an unfamiliar name", () => {
    expect(
      isTransientTextractError({
        name: "SomeNewThrottle",
        $metadata: { httpStatusCode: 429 },
      }),
    ).toBe(true);
  });

  it("is true for a network timeout code", () => {
    expect(isTransientTextractError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientTextractError({ code: "econnreset" })).toBe(true);
  });

  it("is false for a 4xx permanent fault", () => {
    expect(
      isTransientTextractError(
        Object.assign(new Error("bad doc"), {
          name: "InvalidParameterException",
          $metadata: { httpStatusCode: 400 },
        }),
      ),
    ).toBe(false);
    expect(
      isTransientTextractError({
        name: "UnsupportedDocumentException",
        $metadata: { httpStatusCode: 415 },
      }),
    ).toBe(false);
  });

  it("is false for a plain Error and non-error inputs (default = permanent)", () => {
    expect(isTransientTextractError(new Error("mapping blew up"))).toBe(false);
    expect(isTransientTextractError(null)).toBe(false);
    expect(isTransientTextractError("boom")).toBe(false);
  });
});
