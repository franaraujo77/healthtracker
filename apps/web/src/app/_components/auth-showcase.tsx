import { Button } from "@healthtracker/ui/button";

import { getSession } from "~/auth/server";

export async function AuthShowcase() {
  const session = await getSession();

  if (!session) {
    return (
      <div>
        <p className="text-center text-xl">Not signed in</p>
        {/* Full sign-in UI implemented in Story 1.1 */}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <p className="text-center text-2xl">
        <span>Signed in</span>
      </p>
      {/* Sign-out action implemented in Story 1.1 */}
      <Button size="lg">Sign out (Story 1.1)</Button>
    </div>
  );
}
