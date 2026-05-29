/**
 * Story 6.3 R1-H1 fix-up — cache-key proof.
 *
 * The H1 finding was: the modal called
 *   queryClient.invalidateQueries({
 *     queryKey: trpc.sharing.getActivationStatus.queryKey(),
 *   })
 * but no client subscriber was reading that key (the value came
 * from the RSC), so the banner reappeared after the success toast.
 *
 * The fix made the banner a `useQuery` subscriber via
 *   trpc.sharing.getActivationStatus.queryOptions({}, ...)
 *
 * This test pins the invariant the H1 fix relies on: the partial
 * `.queryKey()` used by the modal MUST be a prefix of the full
 * key produced by `.queryOptions({}).queryKey` that the banner
 * subscribes with. TanStack Query's default matcher
 * (`exact: false`) does prefix matching, so a prefix-match here
 * means the invalidation fires the subscriber's refetch.
 *
 * Render-time DOM tests for the banner would have caught H1
 * directly, but `apps/web` has no Vitest infra (spec T8 deviation).
 * This Node-only check is the cheapest substitute that locks the
 * regression in place — if someone ever refactors the resolver
 * path (e.g. moves it to `professionalRouter`), the keys drift and
 * this test fails fast.
 */
import { QueryClient } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { describe, expect, it } from "vitest";

import { appRouter } from "../../src/root";

describe("R1-H1 — getActivationStatus cache-key invariant", () => {
  const queryClient = new QueryClient();
  const proxy = createTRPCOptionsProxy({
    router: appRouter,
    // No live context needed — `.queryKey()` and `.queryOptions()`
    // are key-shape constructors; they never invoke the resolver.
    ctx: () => ({}) as never,
    queryClient,
  });

  it("modal's .queryKey() is a prefix of banner's .queryOptions({}).queryKey", () => {
    const modalKey = proxy.sharing.getActivationStatus.queryKey();
    const bannerKey = proxy.sharing.getActivationStatus.queryOptions(
      {},
    ).queryKey;

    // First positional element is the path tuple — these MUST be
    // identical or the prefix match cannot work.
    expect(bannerKey[0]).toEqual(modalKey[0]);
    expect(modalKey[0]).toEqual(["sharing", "getActivationStatus"]);
  });

  it("invalidateQueries on the modal's key refetches the banner's subscription", async () => {
    const bannerOptions = proxy.sharing.getActivationStatus.queryOptions({});
    // Seed the cache with the banner's full key.
    queryClient.setQueryData(bannerOptions.queryKey, {
      activated: false,
      displayName: null,
      category: null,
    });
    expect(queryClient.getQueryData(bannerOptions.queryKey)).toEqual({
      activated: false,
      displayName: null,
      category: null,
    });

    // Invalidate using the modal's partial key. With `exact: false`
    // (the default), TanStack Query's matcher uses
    // `partialMatchKey` — the entry above MUST match and become
    // stale (its `state.isInvalidated` flips to true).
    await queryClient.invalidateQueries({
      queryKey: proxy.sharing.getActivationStatus.queryKey(),
    });

    const entry = queryClient
      .getQueryCache()
      .find({ queryKey: bannerOptions.queryKey });
    expect(entry).toBeDefined();
    expect(entry?.state.isInvalidated).toBe(true);
  });
});
