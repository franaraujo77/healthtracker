import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Auth is handled by /auth/callback (PKCE exchange). This legacy path redirects
// to the error page so stale integrations don't silently appear to succeed.
export const GET = (request: NextRequest) =>
  NextResponse.redirect(new URL("/auth/error", request.url));
export const POST = () => NextResponse.json({ ok: false }, { status: 404 });
