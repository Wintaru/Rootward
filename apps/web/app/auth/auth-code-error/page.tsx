import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign-in problem · Rootward",
};

/**
 * Shown when `/auth/callback` cannot complete — an expired or reused magic
 * link, a cancelled Google consent, or a failed admin bootstrap. The fix is
 * always the same: request a fresh link.
 */
export default function AuthCodeErrorPage() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">
        That sign-in link did not work
      </h1>
      <p className="text-muted-foreground">
        It may have expired or already been used. Request a new one and try
        again.
      </p>
      <Link
        href="/login"
        className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2 text-sm font-medium"
      >
        Back to sign in
      </Link>
    </main>
  );
}
