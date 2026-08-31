import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveImportAccess } from "@/lib/auth/require-moderator";

import { ImportForbidden } from "./ImportForbidden";
import { ImportWorkspace } from "./ImportWorkspace";

export const metadata: Metadata = {
  title: "Import GEDCOM · Rootward",
};

/**
 * `/import` — moderator+ only (SPEC §8.1). Reading the session makes this route
 * dynamic. Full auth (`/login`, session middleware) is issue #17; an
 * unauthenticated visitor is sent to `/login` regardless.
 */
export default async function ImportPage() {
  const access = await resolveImportAccess();

  if (access.kind === "unauthenticated") {
    redirect("/login");
  }
  if (access.kind === "forbidden") {
    return <ImportForbidden />;
  }
  return <ImportWorkspace startedBy={access.userId} />;
}
