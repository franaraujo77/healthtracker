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
  breadcrumbs?: { values?: { data?: Record<string, unknown> }[] };
  request?: { data?: unknown; headers?: Record<string, string> };
  tags?: Record<string, string>;
}

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

function scrubObject(
  obj: Record<string, unknown>,
  keys: Set<string> = PII_KEYS,
  depth = 3,
): Record<string, unknown> {
  const result = { ...obj };
  for (const k of Object.keys(result)) {
    if (keys.has(k)) {
      delete result[k];
    } else if (
      depth > 0 &&
      result[k] !== null &&
      typeof result[k] === "object"
    ) {
      if (Array.isArray(result[k])) {
        result[k] = (result[k] as unknown[]).map((item) =>
          item !== null && typeof item === "object" && !Array.isArray(item)
            ? scrubObject(item as Record<string, unknown>, keys, depth - 1)
            : item,
        );
      } else {
        result[k] = scrubObject(
          result[k] as Record<string, unknown>,
          keys,
          depth - 1,
        );
      }
    }
  }
  return result;
}

export function sentryBeforeSend(event: SentryEvent): SentryEvent | null {
  if (event.user) {
    event.user = scrubObject(event.user, USER_PII_KEYS);
  }
  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }
  if (event.contexts) {
    for (const ctxKey of Object.keys(event.contexts)) {
      const ctx = event.contexts[ctxKey];
      if (ctx && typeof ctx === "object") {
        event.contexts[ctxKey] = scrubObject(ctx);
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
  // Strip sensitive request headers (auth tokens, session cookies)
  if (event.request?.headers) {
    const scrubbed: Record<string, string> = {};
    for (const [k, v] of Object.entries(event.request.headers)) {
      scrubbed[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "[Scrubbed]" : v;
    }
    event.request.headers = scrubbed;
  }
  // Scrub PII from tags (tags are user-defined key/value pairs)
  if (event.tags) {
    event.tags = scrubObject(event.tags) as Record<string, string>;
  }
  return event;
}
