import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveEditAccess } from "@/lib/auth/require-moderator";

import { NewPersonForbidden } from "./NewPersonForbidden";
import { NewPersonForm } from "./NewPersonForm";

export const metadata: Metadata = {
  title: "New person · Rootward",
};

/**
 * `/person/new` — create a person outside the GEDCOM importer (SPEC §8.1,
 * §8.3, issue #55), moderator+ only. The form only takes name and sex;
 * relationships are #56, everything else waits for the edit view this
 * redirects to.
 */
export default async function NewPersonPage() {
  const access = await resolveEditAccess();

  if (access.kind === "unauthenticated") {
    redirect("/login");
  }
  if (access.kind === "forbidden") {
    return <NewPersonForbidden />;
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">New person</h1>
        <p className="text-muted-foreground">
          A placeholder is fine — leave a field blank and fill it in later from
          the edit view.
        </p>
      </header>

      <NewPersonForm />
    </main>
  );
}
