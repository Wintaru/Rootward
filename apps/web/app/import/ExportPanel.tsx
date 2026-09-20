"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback } from "react";

import { exportDownloadFilename } from "@/lib/db";
import type { ExportFlowState } from "@/lib/export/orchestrator";
import { useGedcomExport } from "@/lib/export/useGedcomExport";
import { Button } from "@/components/ui/button";

import { DownloadButton } from "./DownloadButton";
import { formatByteSize } from "./format";
import { IndeterminateBar, StatusCard } from "./StatusCard";

/**
 * The export half of `/import` (SPEC §8.1, #54): one button that runs a
 * `manual_gedcom` export, over the server-rendered `ExportJobList` the page
 * passes in as `jobList`. The flow calls `router.refresh()` when a job
 * settles, so the list picks it up without a second client query.
 */
export function ExportPanel({
  startedBy,
  jobList,
}: {
  startedBy: string;
  jobList: ReactNode;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const { state, start, reset } = useGedcomExport(startedBy, refresh);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">Export</h2>
        <p className="text-muted-foreground text-sm">
          Download the whole tree as a GEDCOM 5.5.1 file — every person, family,
          event, source, and note. Media files are not included.
        </p>
      </div>

      <ExportStage state={state} onStart={start} onReset={reset} />
      {jobList}
    </section>
  );
}

function ExportStage({
  state,
  onStart,
  onReset,
}: {
  state: ExportFlowState;
  onStart: () => void;
  onReset: () => void;
}) {
  switch (state.status) {
    case "idle":
      return (
        <div className="border-border flex flex-col gap-4 rounded-lg border p-6">
          <p className="text-sm">
            The file is built from the current tree, so it always reflects the
            latest edits.
          </p>
          <Button className="w-fit" type="button" onClick={onStart}>
            Export GEDCOM
          </Button>
        </div>
      );
    case "starting":
      return (
        <StatusCard title="Building the export">
          <IndeterminateBar label="Reading the tree and writing the file" />
        </StatusCard>
      );
    case "polling":
      return (
        <StatusCard title="Still working">
          <IndeterminateBar label="Waiting for the export to finish" />
          <p className="text-muted-foreground text-xs">
            The connection dropped before the export answered. This page checks
            the job until it settles.
          </p>
        </StatusCard>
      );
    case "completed":
      return (
        <StatusCard title="Export ready">
          <p className="text-muted-foreground text-sm">
            {exportDownloadFilename(state.job)}
            {state.job.sizeBytes !== null &&
              ` · ${formatByteSize(state.job.sizeBytes)}`}
          </p>
          <div className="flex flex-wrap gap-3">
            <DownloadButton job={state.job} variant="primary" />
            <Button
              className="w-fit"
              variant="outline"
              type="button"
              onClick={onReset}
            >
              Export again
            </Button>
          </div>
        </StatusCard>
      );
    case "failed":
      return (
        <StatusCard title="Export failed">
          <p className="text-destructive text-sm" role="alert">
            {state.message}
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
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled export flow state: ${JSON.stringify(value)}`);
}
