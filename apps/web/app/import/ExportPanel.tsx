"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";

import {
  exportDownloadFilename,
  MANUAL_EXPORT_TYPES,
  type ManualExportType,
} from "@/lib/db";
import type { ExportFlowState } from "@/lib/export/orchestrator";
import { useGedcomExport } from "@/lib/export/useGedcomExport";
import { Button } from "@/components/ui/button";

import { DownloadButton } from "./DownloadButton";
import { formatByteSize } from "./format";
import { IndeterminateBar, StatusCard } from "./StatusCard";

/**
 * The export half of `/import` (SPEC §8.1, #54, #124): a type picker
 * (`manual_gedcom` or `manual_full`) and one button that runs the export,
 * over the server-rendered `ExportJobList` the page passes in as `jobList`.
 * The flow calls `router.refresh()` when a job settles, so the list picks it
 * up without a second client query.
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
  const [type, setType] = useState<ManualExportType>("manual_gedcom");
  const onStart = useCallback(() => start(type), [start, type]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">Export</h2>
        <p className="text-muted-foreground text-sm">
          Download the whole tree as a GEDCOM 5.5.1 file — every person, family,
          event, source, and note — on its own, or with every photo and document
          in a GedZip.
        </p>
      </div>

      <ExportStage
        state={state}
        type={type}
        onTypeChange={setType}
        onStart={onStart}
        onReset={reset}
      />
      {jobList}
    </section>
  );
}

function ExportStage({
  state,
  type,
  onTypeChange,
  onStart,
  onReset,
}: {
  state: ExportFlowState;
  type: ManualExportType;
  onTypeChange: (type: ManualExportType) => void;
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              What to include
            </legend>
            {MANUAL_EXPORT_TYPES.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 text-sm"
              >
                <input
                  type="radio"
                  name="export-type"
                  value={option.value}
                  checked={type === option.value}
                  onChange={() => onTypeChange(option.value)}
                  className="mt-1"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <Button className="w-fit" type="button" onClick={onStart}>
            {type === "manual_gedcom"
              ? "Export GEDCOM"
              : "Export GEDCOM + media"}
          </Button>
        </div>
      );
    case "starting":
      return (
        <StatusCard title="Building the export">
          <IndeterminateBar
            label={
              type === "manual_full"
                ? "Reading the tree and packing every media file"
                : "Reading the tree and writing the file"
            }
          />
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
