import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";

// Root entry: route the user into the actual app. Signed-in patients
// land on the Início (Story 3.x), everyone else funnels to the
// register/sign-in flow (Story 1.1). The previous landing page was
// the unmodified `create-t3-turbo` template's posts demo — the `post`
// table, router, and UI are deleted in the same commit as a hygiene
// cleanup (Epic 0/1 leftovers).
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/auth/register");
  redirect("/inicio");
}
