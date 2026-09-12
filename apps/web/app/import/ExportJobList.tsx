import { type ExportJob, type ExportStatus, isDownloadable } from "@/lib/db";

import { DownloadButton } from "./DownloadButton";
import { formatByteSize } from "./format";

/**
 * The recent `export_job` rows, newest first. A server component, so the
 * timestamps render once with the server's locale (the same shape as
 * `/moderation`'s `PendingInvitations`) and never mismatch on hydration. The
 * page passes it into `ExportPanel` as a slot; `router.refresh()` from the
 * export flow re-renders it.
 */
export function ExportJobList({ jobs }: { jobs: readonly ExportJob[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Recent exports</h3>
      {jobs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No exports yet.</p>
      ) : (
        <ul className="divide-border border-border divide-y rounded-lg border">
          {jobs.map((job) => (
            <ExportJobRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ExportJobRow({ job }: { job: ExportJob }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <span className="tabular-nums">{formatTimestamp(job.createdAt)}</span>
      <span className="text-muted-foreground">{STATUS_LABEL[job.status]}</span>
      {job.sizeBytes !== null && (
        <span className="text-muted-foreground tabular-nums">
          {formatByteSize(job.sizeBytes)}
        </span>
      )}
      {isDownloadable(job) && (
        <span className="ml-auto">
          <DownloadButton job={job} />
        </span>
      )}
      {job.status === "failed" && job.errorText !== null && (
        <span className="text-destructive basis-full">{job.errorText}</span>
      )}
    </li>
  );
}

const STATUS_LABEL: Record<ExportStatus, string> = {
  pending: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
