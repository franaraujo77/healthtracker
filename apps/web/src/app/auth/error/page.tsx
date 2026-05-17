import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">
        Sign-in link expired or invalid
      </h1>
      <p className="text-muted-foreground max-w-sm text-center text-sm">
        The link you clicked may have already been used or has expired. Please
        request a new sign-in link.
      </p>
      <Link
        href="/"
        className="text-primary text-sm underline underline-offset-4"
      >
        Return to home
      </Link>
    </main>
  );
}
