import "server-only";

import { cache } from "react";

import {
  createSupabaseServerClient,
  getSession as getSecureSession,
} from "@healthtracker/auth/server";

export { createSupabaseServerClient };

// Secure getSession: calls getUser() first to re-validate the JWT server-side,
// unlike getSession() alone which trusts the cookie without re-validation.
export const getSession = cache(getSecureSession);
