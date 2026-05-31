import { describe, expect, it } from "vitest";

import { isSilentDuplicateEmailSignUp } from "@healthtracker/validators";

/**
 * Regression coverage for Supabase's email-enumeration protection
 * silent-duplicate response shape. Without this detection, both the
 * web and Expo registration forms (`apps/web/src/app/auth/register/
 * register-form.tsx` + `apps/expo/src/app/register.tsx`) treat the
 * fake-success response identically to a real verification-email send
 * and the patient waits forever for an email that never arrives.
 */
describe("isSilentDuplicateEmailSignUp", () => {
  it("returns true when session is null AND user has empty identities[] (the silent-duplicate shape)", () => {
    const data = {
      user: { identities: [] },
      session: null,
    };
    expect(isSilentDuplicateEmailSignUp(data)).toBe(true);
  });

  it("returns false when session is null but identities is populated (genuine first-time signup, verification email actually sent)", () => {
    const data = {
      user: { identities: [{ provider: "email" }] },
      session: null,
    };
    expect(isSilentDuplicateEmailSignUp(data)).toBe(false);
  });

  it("returns false when a session is present (immediate signin path; email-confirmation disabled)", () => {
    const data = {
      user: { identities: [] },
      session: { access_token: "abc" },
    };
    expect(isSilentDuplicateEmailSignUp(data)).toBe(false);
  });

  it("returns false when user is null (e.g. unusual rate-limited response)", () => {
    const data = { user: null, session: null };
    expect(isSilentDuplicateEmailSignUp(data)).toBe(false);
  });

  it("returns false when identities is undefined (defensive; older SDK shape)", () => {
    const data = {
      user: {},
      session: null,
    };
    expect(isSilentDuplicateEmailSignUp(data)).toBe(false);
  });

  it("returns false when identities is null (defensive)", () => {
    const data = {
      user: { identities: null },
      session: null,
    };
    expect(isSilentDuplicateEmailSignUp(data)).toBe(false);
  });
});
