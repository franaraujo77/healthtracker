// Supabase Auth callback handler
// Full implementation (magic link exchange, PKCE) is configured in Story 0.3.
import { NextResponse } from "next/server";

export const GET = () => NextResponse.json({ ok: true });
export const POST = () => NextResponse.json({ ok: true });
