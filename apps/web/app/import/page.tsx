import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveImportAccess } from "@/lib/auth/require-moderator";
import { getPersonCount, listExportJobs } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ExportJobList } from "./ExportJobList";
import { ExportPanel } from "./ExportPanel";
import { ImportForbidden } from "./ImportForbidden";
import { ImportWorkspace } from "./ImportWorkspace";

export const metadata: Metadata = {
  title: "Import / Export · Rootward",
};

/**
 * `/import` — Import / Export, moderator+ only (SPEC §8.1). Two sections: the
 * GEDCOM import flow (#16) and the GEDCOM export flow with its recent jobs
 * (#54). Reading the session makes this route dynamic; an unauthenticated
 * visitor is sent to `/login`.
 */
export default async function ImportPage() {
  const access = await resolveImportAccess();

  if (access.kind === "unauthenticated") {
    redirect("/login");
  }
  if (access.kind === "forbidden") {
    return <ImportForbidden />;
  }

  const supabase = await createSupabaseServerClient();
  const [exportJobs, personCount] = await Promise.all([
    listExportJobs(supabase),
    getPersonCount(supabase),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Import / Export
        </h1>
        <p className="text-muted-foreground">
          Load a GEDCOM file into the tree, or download the tree as one.
        </p>
      </header>

      <ImportWorkspace
        startedBy={access.userId}
        personCount={personCount}
        isAdmin={access.isAdmin}
      />
      <ExportPanel
        startedBy={access.userId}
        jobList={<ExportJobList jobs={exportJobs} />}
      />
    </main>
  );
}
