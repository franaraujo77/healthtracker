// Keys that are PII in all object contexts (extra, breadcrumbs, request body, contexts bags)
const PII_KEYS = new Set([
  "patient_id",
  "loinc_code",
  "value_numeric",
  "unit_ucum",
  "email",
  "phone",
  "full_name",
]);

// Additional keys that are PII only in user identity objects (user.name is a person name, not a software name)
const USER_PII_KEYS = new Set([...PII_KEYS, "name"]);

interface SentryEvent {
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
  breadcrumbs?: { values?: Array<{ data?: Record<string, unknown> }> };
  request?: { data?: unknown; headers?: Record<string, string> };
  tags?: Record<string, string>;
}

function scrubObject(
  obj: Record<string, unknown>,
  keys: Set<string> = PII_KEYS,
): Record<string, unknown> {
  const result = { ...obj };
  for (const key of keys) {
    if (key in result) delete result[key];
  }
  return result;
}

export function sentryBeforeSend(event: SentryEvent): SentryEvent | null {
  if (event.user) {
    event.user = scrubObject(
      event.user as Record<string, unknown>,
      USER_PII_KEYS,
    );
  }
  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }
  if (event.contexts) {
    for (const ctxKey of Object.keys(event.contexts)) {
      const ctx = event.contexts[ctxKey];
      if (ctx && typeof ctx === "object") {
        event.contexts[ctxKey] = scrubObject(ctx as Record<string, unknown>);
      }
    }
  }
  if (event.breadcrumbs?.values) {
    event.breadcrumbs.values = event.breadcrumbs.values.map((crumb) => ({
      ...crumb,
      data: crumb.data ? scrubObject(crumb.data) : crumb.data,
    }));
  }
  // Redact entire request body — may contain biomarker values posted via form/API
  if (event.request?.data !== undefined) {
    event.request.data = "[Scrubbed]";
  }
  return event;
}
