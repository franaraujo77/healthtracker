import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

/**
 * Inference helpers for input types
 * @example
 * type PostByIdInput = RouterInputs['post']['byId']
 *      ^? { id: number }
 */
type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type AllPostsOutput = RouterOutputs['post']['all']
 *      ^? Post[]
 */
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export { createTRPCContext } from "./trpc";
export type { RouterInputs, RouterOutputs };

/**
 * Story 6.1 R1-M1 — narrow apps-facing wrapper for the malformed
 * `[token]` segment audit row. The `/m/[token]` Next.js RSC bypasses
 * the resolver (Zod would reject the unknown-sentinel uuid) but the
 * audit row MUST still fire. `auditMalformedTokenProbe` exposes that
 * single contract without leaking the raw `db` handle into apps-layer
 * code (round-1 reviewer concern about RLS-on / RLS-off drift).
 *
 * `writePreAuthAudit` is the lower-level building block used by the
 * resolver and re-exported here only so integration tests can assert
 * the audit-row shape end-to-end.
 */
export { auditMalformedTokenProbe, writePreAuthAudit } from "./router/sharing";
