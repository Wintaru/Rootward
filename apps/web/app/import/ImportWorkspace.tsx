"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";

import type { ImportJob, ImportStats } from "@/lib/db";
import { progressOf, type ImportFlowState } from "@/lib/import/orchestrator";
import { useGedcomImport } from "@/lib/import/useGedcomImport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";

import { DeterminateBar, IndeterminateBar, StatusCard } from "./StatusCard";

/** Matches the storage bucket's `file_size_limit` (supabase/config.toml) --
 * a GedZip (issue #101) needs real headroom beyond a text-only GEDCOM. */
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** The import half of `/import` (SPEC §8.1, §7, issue #60). The page owns the
 * `<main>` and the `h1`; this is one `h2` section beside `ExportPanel`.
 *
 * `personCount` blocks the file picker with a clear notice on a non-empty
 * tree instead of letting a second import run and fail on the
 * `person_gedcom_xref_uidx` unique index (decision 33: only the first import
 * is a straightforward load — a later one needs **Wipe tree** first). It is a
 * server-rendered snapshot, so a completed import calls `router.refresh()`
 * once to pick up the tree's new population before the notice can apply to
 * the *next* "Import another file" click.
 */
export function ImportWorkspace({
  startedBy,
  personCount,
  isAdmin,
}: {
  startedBy: string;
  personCount: number;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { state, start, reset } = useGedcomImport(startedBy);

  useEffect(() => {
    if (state.status === "completed") {
      router.refresh();
    }
  }, [state.status, router]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">Import</h2>
        <p className="text-muted-foreground text-sm">
          Upload a GEDCOM file to load its people, families, sources, and notes
          into the tree — or a zip bundling the GEDCOM with its photos (a
          &ldquo;GedZip&rdquo;) to bring those in too. Large files import in the
          background — you can watch the progress here.
        </p>
      </div>

      {state.status === "idle" && personCount > 0 ? (
        <NonEmptyTreeNotice personCount={personCount} isAdmin={isAdmin} />
      ) : (
        <ImportStage state={state} onStart={start} onReset={reset} />
      )}
    </section>
  );
}

function NonEmptyTreeNotice({
  personCount,
  isAdmin,
}: {
  personCount: number;
  isAdmin: boolean;
}) {
  return (
    <StatusCard title="This tree already has data">
      <p className="text-sm">
        This tree already has {personCount.toLocaleString()}{" "}
        {personCount === 1 ? "person" : "people"}.{" "}
        {isAdmin
          ? "Wipe the tree first"
          : "Ask an admin to wipe the tree first"}
        , or wait for match-and-update (#44).
      </p>
      {isAdmin && (
        <Link
          href="/settings"
          className={buttonVariants({ variant: "outline", className: "w-fit" })}
        >
          Go to Settings to wipe the tree
        </Link>
      )}
    </StatusCard>
  );
}

function ImportStage({
  state,
  onStart,
  onReset,
}: {
  state: ImportFlowState;
  onStart: (file: File) => void;
  onReset: () => void;
}) {
  switch (state.status) {
    case "idle":
      return <FilePicker onStart={onStart} />;
    case "preparing":
      return (
        <StatusCard title={`Preparing ${state.filename}`}>
          <IndeterminateBar label="Uploading the file and starting the import" />
        </StatusCard>
      );
    case "running":
      return <RunningCard job={state.job} filename={state.filename} />;
    case "completed":
      return <CompletedCard job={state.job} onReset={onReset} />;
    case "failed":
      return (
        <FailedCard
          message={state.message}
          filename={state.filename}
          onReset={onReset}
        />
      );
    default:
      return assertNever(state);
  }
}

function FilePicker({ onStart }: { onStart: (file: File) => void }) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (file === null) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }
    setError(null);
    onStart(file);
  };

  return (
    <form
      className="border-border flex flex-col gap-4 rounded-lg border p-6"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          GEDCOM file
        </label>
        <Input
          id={inputId}
          type="file"
          accept=".ged,.gedcom,.zip,.gdz,text/plain,application/zip"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
        <p className="text-muted-foreground text-xs">
          Exported from Ancestry, MacFamilyTree, Gramps, or any tool that writes
          GEDCOM 5.5.1 or 7.0. A GedZip&apos;s photos are matched to their
          people automatically; anything it misses can still be added by hand
          afterward.
        </p>
      </div>
      {error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <Button className="w-fit" type="submit" disabled={file === null}>
        Start import
      </Button>
    </form>
  );
}

function RunningCard({ job, filename }: { job: ImportJob; filename: string }) {
  const progress = progressOf(job);

  return (
    <StatusCard title={`Importing ${filename}`}>
      {progress.indeterminate ? (
        <IndeterminateBar label="Reading the file" />
      ) : (
        <DeterminateBar
          ratio={progress.ratio ?? 0}
          label={`${progress.processed.toLocaleString()} of ${(progress.total ?? 0).toLocaleString()} records`}
        />
      )}
      <p className="text-muted-foreground text-xs">
        Keep this page open. If the importer pauses, it resumes automatically.
      </p>
    </StatusCard>
  );
}

function CompletedCard({
  job,
  onReset,
}: {
  job: ImportJob;
  onReset: () => void;
}) {
  return (
    <StatusCard title="Import complete">
      <StatsGrid stats={job.stats} />
      <WarningList warnings={job.stats.warnings} />
      <Button
        className="w-fit"
        variant="outline"
        type="button"
        onClick={onReset}
      >
        Import another file
      </Button>
    </StatusCard>
  );
}

function FailedCard({
  message,
  filename,
  onReset,
}: {
  message: string;
  filename: string | null;
  onReset: () => void;
}) {
  return (
    <StatusCard title="Import failed">
      <p className="text-destructive text-sm" role="alert">
        {filename === null ? message : `${filename}: ${message}`}
      </p>
      <Button
        className="w-fit"
        variant="outline"
        type="button"
        onClick={onReset}
      >
        Try again
      </Button>
    </StatusCard>
  );
}

// --- result pieces ---------------------------------------------------------

function StatsGrid({ stats }: { stats: ImportStats }) {
  const rows: ReadonlyArray<readonly [string, number]> = [
    ["Added", stats.added],
    ["Updated", stats.updated],
    ["Skipped", stats.skipped],
    ["Removed", stats.removed],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="border-border flex flex-col gap-1 rounded-md border p-3"
        >
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function WarningList({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">
        {warnings.length.toLocaleString()} warning
        {warnings.length === 1 ? "" : "s"}
      </summary>
      <ul className="text-muted-foreground mt-2 list-disc pl-5">
        {warnings.map((warning, index) => (
          <li key={index}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled import flow state: ${JSON.stringify(value)}`);
}
