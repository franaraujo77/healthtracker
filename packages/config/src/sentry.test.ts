import { describe, expect, it } from "vitest";

import { sentryBeforeSend } from "./sentry";

describe("sentryBeforeSend", () => {
  it("scrubs patient_id from extra", () => {
    const event = { extra: { patient_id: "uuid-123", error_code: "E001" } };
    const result = sentryBeforeSend(event);
    expect(result?.extra).not.toHaveProperty("patient_id");
    expect(result?.extra).toHaveProperty("error_code", "E001");
  });

  it("scrubs loinc_code from breadcrumb data", () => {
    const event = {
      breadcrumbs: {
        values: [{ data: { loinc_code: "2345-7", label: "fetch" } }],
      },
    };
    const result = sentryBeforeSend(event);
    expect(result?.breadcrumbs?.values?.[0]?.data).not.toHaveProperty(
      "loinc_code",
    );
    expect(result?.breadcrumbs?.values?.[0]?.data).toHaveProperty(
      "label",
      "fetch",
    );
  });

  it("scrubs value_numeric and unit_ucum from extra", () => {
    const event = {
      extra: {
        value_numeric: 5.2,
        unit_ucum: "mmol/L",
        biomarker_label: "glucose",
      },
    };
    const result = sentryBeforeSend(event);
    expect(result?.extra).not.toHaveProperty("value_numeric");
    expect(result?.extra).not.toHaveProperty("unit_ucum");
    expect(result?.extra).toHaveProperty("biomarker_label");
  });

  it("scrubs user email and name, keeps id", () => {
    const event = {
      user: { id: "u1", email: "patient@example.com", name: "João" },
    };
    const result = sentryBeforeSend(event);
    expect(result?.user).not.toHaveProperty("email");
    expect(result?.user).not.toHaveProperty("name");
    expect(result?.user).toHaveProperty("id", "u1");
  });

  it("redacts request body entirely", () => {
    const event = {
      request: { data: { patient_id: "uuid", value_numeric: 5.2 } },
    };
    const result = sentryBeforeSend(event);
    expect(result?.request?.data).toBe("[Scrubbed]");
  });

  it("passes through events with no PII unchanged", () => {
    const event = {
      tags: { env: "production" },
      extra: { request_id: "req-abc" },
    };
    const result = sentryBeforeSend(event);
    expect(result?.tags).toEqual({ env: "production" });
    expect(result?.extra).toEqual({ request_id: "req-abc" });
  });

  it("scrubs PII from all contexts bags", () => {
    const event = {
      contexts: {
        patient: { patient_id: "uuid-123", region: "sp" },
        runtime: { name: "node", version: "20" },
      },
    };
    const result = sentryBeforeSend(event);
    expect(result?.contexts?.patient).not.toHaveProperty("patient_id");
    expect(result?.contexts?.patient).toHaveProperty("region", "sp");
    expect(result?.contexts?.runtime).toHaveProperty("name", "node");
  });

  it("scrubs nested PII inside extra objects", () => {
    const event = {
      extra: {
        biomarker: {
          patient_id: "uuid-123",
          value_numeric: 5.2,
          label: "glucose",
        },
      },
    };
    const result = sentryBeforeSend(event);
    const nested = result?.extra?.biomarker as Record<string, unknown>;
    expect(nested).not.toHaveProperty("patient_id");
    expect(nested).not.toHaveProperty("value_numeric");
    expect(nested).toHaveProperty("label", "glucose");
  });

  it("scrubs PII keys from tags", () => {
    const event = {
      tags: { env: "production", patient_id: "uuid-123", email: "x@x.com" },
    };
    const result = sentryBeforeSend(event);
    expect(result?.tags).not.toHaveProperty("patient_id");
    expect(result?.tags).not.toHaveProperty("email");
    expect(result?.tags).toHaveProperty("env", "production");
  });

  it("scrubs sensitive request headers", () => {
    const event = {
      request: {
        headers: {
          authorization: "Bearer token123",
          "content-type": "application/json",
          cookie: "session=abc",
          "set-cookie": "id=abc; Path=/",
          "x-api-key": "sk-secret",
        },
      },
    };
    const result = sentryBeforeSend(event);
    expect(result?.request?.headers?.authorization).toBe("[Scrubbed]");
    expect(result?.request?.headers?.cookie).toBe("[Scrubbed]");
    expect(result?.request?.headers?.["set-cookie"]).toBe("[Scrubbed]");
    expect(result?.request?.headers?.["x-api-key"]).toBe("[Scrubbed]");
    expect(result?.request?.headers?.["content-type"]).toBe("application/json");
  });

  it("scrubs phone from extra", () => {
    const event = { extra: { phone: "+5511999999999", ref: "call-123" } };
    const result = sentryBeforeSend(event);
    expect(result?.extra).not.toHaveProperty("phone");
    expect(result?.extra).toHaveProperty("ref", "call-123");
  });

  it("scrubs full_name from extra", () => {
    const event = { extra: { full_name: "João Silva", region: "sp" } };
    const result = sentryBeforeSend(event);
    expect(result?.extra).not.toHaveProperty("full_name");
    expect(result?.extra).toHaveProperty("region", "sp");
  });

  it("scrubs PII from arrays of objects inside extra", () => {
    const event = {
      extra: {
        readings: [
          { patient_id: "uuid-123", value_numeric: 5.2, label: "glucose" },
        ],
      },
    };
    const result = sentryBeforeSend(event);
    const readings = result?.extra?.readings as Record<string, unknown>[];
    expect(readings[0]).not.toHaveProperty("patient_id");
    expect(readings[0]).not.toHaveProperty("value_numeric");
    expect(readings[0]).toHaveProperty("label", "glucose");
  });

  it("scrubs PII from nested arrays-of-arrays inside extra", () => {
    const event = {
      extra: {
        readings: [
          [{ patient_id: "uuid-123", value_numeric: 5.2, label: "glucose" }],
        ],
      },
    };
    const result = sentryBeforeSend(event);
    const readings = result?.extra?.readings as Record<string, unknown>[][];
    const [firstGroup = []] = readings;
    const [inner = {}] = firstGroup;
    expect(inner).not.toHaveProperty("patient_id");
    expect(inner).not.toHaveProperty("value_numeric");
    expect(inner).toHaveProperty("label", "glucose");
  });
});
