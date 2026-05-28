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
 * Story 6.1 — surfaced so the `/m/[token]` web route (Next.js RSC)
 * can emit the malformed-segment audit row without going through a
 * tRPC procedure (the resolver's Zod input would reject the
 * unknown-sentinel as not a valid uuid).
 */
export { writePreAuthAudit } from "./router/sharing";
