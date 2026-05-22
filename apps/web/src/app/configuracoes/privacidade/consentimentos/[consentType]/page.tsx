import { notFound } from "next/navigation";

import { isConsentScreenType } from "@healthtracker/validators";

import { ConsentimentosDetail } from "./consentimentos-detail";

export default async function ConsentimentoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ consentType: string }>;
  searchParams: Promise<{ version?: string; grantedAt?: string }>;
}) {
  const { consentType } = await params;
  if (!isConsentScreenType(consentType)) {
    notFound();
  }
  const { version, grantedAt } = await searchParams;

  return (
    <main className="container mx-auto max-w-2xl px-6 py-12">
      <ConsentimentosDetail
        consentType={consentType}
        version={version}
        grantedAt={grantedAt}
      />
    </main>
  );
}
