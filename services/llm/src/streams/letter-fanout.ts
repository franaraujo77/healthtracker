/**
 * Story 4.1 — in-memory fan-out between the `letter.generate` pg-boss
 * consumer (writer) and the `GET /api/stream/letter/:letterId` SSE
 * handler (reader). The consumer pushes tokens as they arrive from
 * Anthropic; the SSE handler subscribes by `letterId` and replays
 * any tokens that arrived before it connected, then forwards live
 * tokens until `done` or `error`.
 *
 * Scope: single-process. This is fine for the Story 4.1 launch
 * (Railway runs `services/llm` as a single persistent server). If
 * Story 4.2 or later horizontally scales the LLM service, a Redis-
 * backed bus replaces this module; the public API stays identical.
 *
 * Lifecycle: an entry is created on the first `publish` call for a
 * `letterId`. On `done`/`error` the buffer is kept for an additional
 * `RETENTION_MS` (60 s) so a slightly-late mobile subscriber still
 * gets the full body; after that it is GC'd.
 */

type FanoutEvent =
  | { type: "token"; content: string }
  | { type: "done"; letterId: string }
  | { type: "error"; code: string };

interface BufferEntry {
  events: FanoutEvent[];
  subscribers: Set<(event: FanoutEvent) => void>;
  closedAt: number | null;
}

const RETENTION_MS = 60_000;

const buffers = new Map<string, BufferEntry>();

/* eslint-disable-next-line @typescript-eslint/no-empty-function -- closed-buffer subscribe needs an unsubscribe noop */
function noop(): void {}

function ensure(letterId: string): BufferEntry {
  let entry = buffers.get(letterId);
  if (!entry) {
    entry = { events: [], subscribers: new Set(), closedAt: null };
    buffers.set(letterId, entry);
  }
  return entry;
}

function scheduleGc(letterId: string): void {
  setTimeout(() => {
    const entry = buffers.get(letterId);
    if (!entry) return;
    if (entry.subscribers.size === 0 && entry.closedAt !== null) {
      buffers.delete(letterId);
    }
  }, RETENTION_MS).unref();
}

export function publishToken(letterId: string, content: string): void {
  const entry = ensure(letterId);
  if (entry.closedAt !== null) return;
  const event: FanoutEvent = { type: "token", content };
  entry.events.push(event);
  for (const sub of entry.subscribers) sub(event);
}

export function publishDone(letterId: string): void {
  const entry = ensure(letterId);
  if (entry.closedAt !== null) return;
  const event: FanoutEvent = { type: "done", letterId };
  entry.events.push(event);
  entry.closedAt = Date.now();
  for (const sub of entry.subscribers) sub(event);
  scheduleGc(letterId);
}

export function publishError(letterId: string, code: string): void {
  const entry = ensure(letterId);
  if (entry.closedAt !== null) return;
  const event: FanoutEvent = { type: "error", code };
  entry.events.push(event);
  entry.closedAt = Date.now();
  for (const sub of entry.subscribers) sub(event);
  scheduleGc(letterId);
}

/**
 * Subscribe to a `letterId`'s event stream. Replays any buffered
 * events synchronously, then continues forwarding live events.
 * Returns an `unsubscribe` callback the SSE handler must invoke on
 * connection close.
 */
export function subscribe(
  letterId: string,
  onEvent: (event: FanoutEvent) => void,
): () => void {
  const entry = ensure(letterId);
  // Replay backlog first so a slightly-late subscriber sees the
  // tokens that arrived before its connect.
  for (const event of entry.events) onEvent(event);
  if (entry.closedAt !== null) {
    // Already closed — nothing to subscribe to; caller still
    // expects an unsubscribe handle for symmetry.
    return noop;
  }
  entry.subscribers.add(onEvent);
  return () => {
    entry.subscribers.delete(onEvent);
  };
}

/** Test-only — reset buffers between cases. Do not call in prod code. */
export function __resetForTests(): void {
  buffers.clear();
}
