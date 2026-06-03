/**
 * Story 9.3 — pure classification of `textractAdapter.extract()` failures
 * for the consumer's catch block. No SDK client, no network — just shape
 * inspection of a thrown `unknown`, so the matrix is unit-tested directly.
 *
 * Three outcomes at the call site (see `consumers/document.ts`):
 *   - programmer error  → re-throw (a bug must surface in pg-boss/Sentry,
 *                          never dead-letter a patient's upload)
 *   - transient error   → re-throw (let the pg-boss retry policy run; it
 *                          dead-letters only after retry exhaustion)
 *   - everything else   → permanent → dead-letter immediately (retrying a
 *                          4xx / mapping fault just loops to the limit)
 *
 * The DEFAULT for an unrecognised shape is permanent (NOT transient): a
 * fault we cannot positively classify as retryable must not loop forever.
 */

/** Read a string-ish property off an unknown error without an `any` cast. */
function prop(err: unknown, key: string): unknown {
  if (typeof err !== "object" || err === null) return undefined;
  return (err as Record<string, unknown>)[key];
}

/**
 * Programmer errors — bugs in our code, not runtime faults. Must surface,
 * never be swallowed into a dead-letter (CLAUDE.md narrow-catch discipline).
 */
export function isProgrammerError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError
  );
}

// Throttling / server-fault / network exception names worth retrying.
// Lowercased for case-insensitive matching. The Textract-thrown throttles
// (`ThrottlingException`, `ProvisionedThroughputExceededException`,
// `LimitExceededException`) mirror AWS's own `THROTTLING_ERROR_CODES`; the
// rest are generic-AWS / transport names kept as defensive breadth.
const TRANSIENT_NAMES = new Set([
  "throttlingexception",
  "throttledexception",
  "provisionedthroughputexceededexception",
  "limitexceededexception",
  "toomanyrequestsexception",
  "requestlimitexceeded",
  "requestthrottledexception",
  "internalservererror",
  "internalfailure",
  "serviceunavailable",
  "serviceunavailableexception",
  "timeouterror",
  "requesttimeout",
]);
const TRANSIENT_CODES = new Set(["etimedout", "econnreset", "eai_again"]);

/**
 * Transient extraction errors — re-throw so the pg-boss retry policy runs.
 * True when the error name/code is a known throttle/timeout, OR it is a 5xx
 * or 429, OR the SDK explicitly marked it `$retryable`. Everything else is
 * treated as permanent by the caller.
 *
 * NOTE: `$retryable` is only ONE signal — the AWS SDK does not stamp it on
 * every retryable Textract throttle (its own `isThrottlingError` matches on
 * the exception name + HTTP 429). So the name set + status checks are
 * load-bearing, not the `$retryable` flag.
 */
export function isTransientTextractError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const name = prop(err, "name");
  if (typeof name === "string" && TRANSIENT_NAMES.has(name.toLowerCase())) {
    return true;
  }

  // 5xx (server fault) or 429 (throttle) from Textract → retryable.
  const status = prop(prop(err, "$metadata"), "httpStatusCode");
  if (typeof status === "number" && (status >= 500 || status === 429)) {
    return true;
  }

  const code = prop(err, "code");
  if (typeof code === "string" && TRANSIENT_CODES.has(code.toLowerCase())) {
    return true;
  }

  // The SDK marks some retryable errors with `$retryable` (e.g.
  // `{ throttling: true }`) — honour it when present.
  if (prop(err, "$retryable") != null) return true;

  return false;
}
