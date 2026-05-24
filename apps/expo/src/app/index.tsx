import { Redirect } from "expo-router";

// Root entry: route the user into the actual app. Signed-in patients
// see the Início tab (auth listener in _layout.tsx already handles the
// not-signed-in path — it redirects to (auth) when the session is
// absent, and to onboarding/biometric gates per Story 1.x). The
// previous home was the unmodified `create-t3-turbo` template's posts
// list; the `post` table + router + UI are deleted in the same commit
// as a hygiene cleanup (Epic 0/1 leftovers).
export default function Index() {
  return <Redirect href="/inicio" />;
}
