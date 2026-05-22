import { ConsentFlow } from "./consent-flow";

export default function ConsentPage() {
  return (
    <main className="container flex min-h-screen items-center justify-center py-16">
      <div className="w-full max-w-lg">
        <ConsentFlow />
      </div>
    </main>
  );
}
