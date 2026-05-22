import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { UploadDetailClient } from "./upload-detail-client";

// Story 2.4 — patient upload detail screen. Lists low-confidence
// fields awaiting confirmation. The server prefetches the detail
// query so SSR can hydrate the client without a loading flash.
export default async function UploadDetailPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}) {
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
