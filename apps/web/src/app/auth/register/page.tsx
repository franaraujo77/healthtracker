import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <main className="container flex min-h-screen items-center justify-center py-16">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Criar conta</h1>
          <p className="text-muted-foreground text-sm">
            Comece o seu registro de saúde longitudinal.
          </p>
        </header>
        <RegisterForm />
      </div>
    </main>
  );
}
