"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import type { ImportJob, ImportStats } from "@/lib/db";
import { progressOf, type ImportFlowState } from "@/lib/import/orchestrator";
import { useGedcomImport } from "@/lib/import/useGedcomImport";

/** Matches the storage bucket's default `file_size_limit` (supabase/config.toml). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function ImportWorkspace({ startedBy }: { startedBy: string }) {
  const { state, start, reset } = useGedcomImport(startedBy);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Import GEDCOM</h1>
        <p className="text-muted-foreground">
          Upload a GEDCOM file to load its people, families, sources, and notes
          into the tree. Large files import in the background — you can watch
          the progress here.
        </p>
      </header>

      <ImportStage state={state} onStart={start} onReset={reset} />
    </main>
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
        <input
          id={inputId}
          type="file"
          accept=".ged,.gedcom,text/plain"
          className="text-sm"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
        <p className="text-muted-foreground text-xs">
          Exported from Ancestry, MacFamilyTree, Gramps, or any tool that writes
          GEDCOM 5.5.1 or 7.0.
        </p>
      </div>
      {error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={file === null}
        className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        Start import
      </button>
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
      <button
        type="button"
        onClick={onReset}
        className="border-border w-fit rounded-md border px-4 py-2 text-sm font-medium"
      >
        Import another file
      </button>
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
      <button
        type="button"
        onClick={onReset}
        className="border-border w-fit rounded-md border px-4 py-2 text-sm font-medium"
      >
        Try again
      </button>
    </StatusCard>
  );
}

// --- shared pieces ---------------------------------------------------------

function StatusCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border flex flex-col gap-4 rounded-lg border p-6">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function DeterminateBar({ ratio, label }: { ratio: number; label: string }) {
  const percent = Math.round(ratio * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

function IndeterminateBar({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-label={label}
      >
        <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
      </div>
      <span className="text-muted-foreground text-xs">{label}…</span>
    </div>
  );
}

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
