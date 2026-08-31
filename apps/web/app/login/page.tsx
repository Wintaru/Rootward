import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentAccount } from "@/lib/auth/current-account";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · Rootward",
};

/**
 * `/login` — the only route reachable without a session (SPEC §8.1,
 * decision 35). A visitor who already has one is sent to `/`, which routes them
 * to the tree or onboarding.
 */
export default async function LoginPage() {
  const current = await getCurrentAccount();
  if (current !== null) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-24">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Rootward</h1>
        <p className="text-muted-foreground text-sm">
          Sign in to browse the family tree.
        </p>
      </header>
      <LoginForm />
    </main>
  );
}
