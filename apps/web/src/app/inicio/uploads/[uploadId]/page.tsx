import { redirect } from "next/navigation";

import { REGISTER_ROUTE } from "@healthtracker/validators";

import { getSession } from "~/auth/server";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { UploadDetailClient } from "./upload-detail-client";

// Story 2.4 — patient upload detail screen. Lists low-confidence
// fields awaiting confirmation. The server prefetches the detail
// query so SSR can hydrate the client without a loading flash.
//
// P132 — gate at the page entry. The middleware refreshes sessions
// but does not block unauthenticated access; the tRPC server-side
// caller would throw UNAUTHORIZED at prefetch time without a session,
// surfacing as an SSR 500. Redirect to the register flow instead.
export default async function UploadDetailPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect(REGISTER_ROUTE);
  }
  const { uploadId } = await params;
  prefetch(trpc.uploads.getUploadDetail.queryOptions({ uploadId }));
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <HydrateClient>
        <UploadDetailClient uploadId={uploadId} />
      </HydrateClient>
    </main>
  );
}
