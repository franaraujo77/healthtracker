import { describe, expect, it } from "vitest";

import { sentryBeforeSend } from "./sentry";

describe("sentryBeforeSend", () => {
  it("scrubs patient_id from extra", () => {
    const event = { extra: { patient_id: "uuid-123", error_code: "E001" } };
    const result = sentryBeforeSend(event as any);
    expect(result?.extra).not.toHaveProperty("patient_id");
    expect(result?.extra).toHaveProperty("error_code", "E001");
  });

  it("scrubs loinc_code from breadcrumb data", () => {
    const event = {
      breadcrumbs: {
        values: [{ data: { loinc_code: "2345-7", label: "fetch" } }],
      },
    };
    const result = sentryBeforeSend(event as any);
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
    const result = sentryBeforeSend(event as any);
    expect(result?.extra).not.toHaveProperty("value_numeric");
    expect(result?.extra).not.toHaveProperty("unit_ucum");
    expect(result?.extra).toHaveProperty("biomarker_label");
  });

  it("scrubs user email and name, keeps id", () => {
    const event = {
      user: { id: "u1", email: "patient@example.com", name: "João" },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.user).not.toHaveProperty("email");
    expect(result?.user).not.toHaveProperty("name");
    expect(result?.user).toHaveProperty("id", "u1");
  });

  it("redacts request body entirely", () => {
    const event = {
      request: { data: { patient_id: "uuid", value_numeric: 5.2 } },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.request?.data).toBe("[Scrubbed]");
  });

  it("passes through events with no PII unchanged", () => {
    const event = {
      tags: { env: "production" },
      extra: { request_id: "req-abc" },
    };
    const result = sentryBeforeSend(event as any);
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
    const result = sentryBeforeSend(event as any);
    expect(result?.contexts?.patient).not.toHaveProperty("patient_id");
    expect(result?.contexts?.patient).toHaveProperty("region", "sp");
    expect(result?.contexts?.runtime).toHaveProperty("name", "node");
  });
});
