# Auth Code Review Checklist

Use this checklist when reviewing any PR that touches authentication, session handling, middleware, or auth callbacks.

## Redirect Safety

- [ ] `next` / redirect param is validated through `safeRedirectPath` (or equivalent allowlist) before use — no raw `redirect(searchParams.get('next'))` calls
- [ ] Auth callback route never reflects an arbitrary URL from query params into a server-side redirect
- [ ] Redirect targets are relative paths only; absolute URLs require explicit allowlisting

## Session Validation

- [ ] Server-side session reads use `@healthtracker/auth/server` — never call `supabase.auth.getSession()` directly on the server (trusts cookie without JWT re-validation)
- [ ] `getUser()` (not `getSession()`) is used wherever the caller is making an authorization decision
- [ ] tRPC context does not construct its own Supabase client; it imports the centralised factory from `packages/auth/`

## Auth State & Query Cache

- [ ] `onAuthStateChange` listeners fire cache invalidation only on `SIGNED_IN`, `SIGNED_OUT`, `USER_UPDATED` — not on `TOKEN_REFRESHED` (avoids query cache pollution on silent token refresh)
- [ ] Listeners are cleaned up (`subscription.unsubscribe()`) on component unmount

## Deep-Link / PKCE Flow (Expo)

- [ ] PKCE code exchange is guarded against double-consumption — a `cancelled` / `consumed` flag is set before `exchangeCodeForSession` to prevent race on re-render
- [ ] `queryParams.code` is guarded against `string[]` (URL params can be arrays): use `Array.isArray(code) ? code[0] : code`
- [ ] Deep-link handler disposes listener after first successful exchange

## Error Pages & User Feedback

- [ ] `/auth/error` page exists and is reachable — auth callback errors must redirect there, not to `/`
- [ ] Auth error objects are logged (server-side) before redirecting — no silent discard
- [ ] Client-facing error messages do not expose internal error details or stack traces

## Middleware

- [ ] Middleware returns `supabaseResponse` (the response object mutated by the Supabase SSR helper) — never `NextResponse.next()` or a fresh response, which would drop Set-Cookie headers
- [ ] Session refresh call (`supabase.auth.getUser()`) happens before any route guard logic in middleware
- [ ] Protected routes are explicitly listed or matched by pattern; catch-all fallback is deny-by-default

## General

- [ ] No Supabase client is instantiated outside `packages/auth/` — grep for `createClient` in `apps/` and `packages/api/`
- [ ] `.env` vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are the only Supabase keys referenced client-side; `SUPABASE_SERVICE_ROLE_KEY` never appears in client bundles
- [ ] Auth-related catch blocks log the error before re-throwing or redirecting — no empty `catch {}` blocks
