/**
 * The `/import` flow as a pure state machine, separate from React so the
 * upload → poll → resume → result sequence unit-tests without a DOM or a live
 * Supabase stack. `useGedcomImport` wires this to real timers and the
 * `lib/db/import-jobs` queries.
 *
 * Resume (SPEC §7, decision 8): the `gedcom-import` engine self-reinvokes when
 * it hits its time budget, but a dropped self-reinvoke would strand the job. So
 * the client watches `processed_records`: when it stops advancing for
 * {@link STALL_MS} while the job is not terminal, {@link isStalled} tells the
 * hook to invoke the function again. The engine picks up from
 * `import_job.cursor`, so the extra call is a safe nudge, never a restart.
 */

import type { ImportJob } from "@/lib/db";

/** Poll `import_job` this often while a job runs. */
export const POLL_MS = 2_000;

/**
 * Re-invoke the function when `processed_records` has not advanced for this
 * long. Comfortably past a worst-case healthy resume — the engine's 20s budget
 * plus a cold start that re-downloads and re-parses the whole file — so a slow
 * but live self-reinvoke is never nudged.
 */
export const STALL_MS = 60_000;

// --- flow state --------------------------------------------------------

export type ImportFlowState =
  | { readonly status: "idle" }
  | { readonly status: "preparing"; readonly filename: string }
  | {
      readonly status: "running";
      readonly jobId: string;
      readonly filename: string;
      readonly job: ImportJob;
      /** `Date.now()` of the last `processed_records` increase. */
      readonly lastAdvanceAt: number;
    }
  | {
      readonly status: "completed";
      readonly jobId: string;
      readonly job: ImportJob;
    }
  | {
      readonly status: "failed";
      readonly jobId: string | null;
      readonly filename: string | null;
      readonly message: string;
    };

export type ImportFlowAction =
  | { readonly type: "submit"; readonly filename: string }
  | {
      readonly type: "started";
      readonly jobId: string;
      readonly filename: string;
      readonly job: ImportJob;
      readonly now: number;
    }
  | { readonly type: "polled"; readonly job: ImportJob; readonly now: number }
  | {
      readonly type: "error";
      readonly jobId: string | null;
      readonly message: string;
    }
  | { readonly type: "reset" };

export const initialImportFlow: ImportFlowState = { status: "idle" };

export function importFlowReducer(
  state: ImportFlowState,
  action: ImportFlowAction,
): ImportFlowState {
  switch (action.type) {
    case "submit":
      return { status: "preparing", filename: action.filename };

    case "started":
      return settle(action.jobId, action.filename, action.job, action.now, {
        lastProcessed: -1,
        lastAdvanceAt: action.now,
      });

    case "polled": {
      if (state.status !== "running") {
        return state;
      }
      return settle(state.jobId, state.filename, action.job, action.now, {
        lastProcessed: state.job.processedRecords,
        lastAdvanceAt: state.lastAdvanceAt,
      });
    }

    case "error":
      return {
        status: "failed",
        jobId: action.jobId,
        filename: filenameOf(state),
        message: action.message,
      };

    case "reset":
      return initialImportFlow;

    default:
      return assertNever(action);
  }
}

/**
 * Resolve a fresh job reading into the next flow state. The `switch` is
 * exhaustive over `import_status` — a new enum value fails to compile here
 * rather than silently polling forever.
 */
function settle(
  jobId: string,
  filename: string,
  job: ImportJob,
  now: number,
  prev: { lastProcessed: number; lastAdvanceAt: number },
): ImportFlowState {
  switch (job.status) {
    case "completed":
      return { status: "completed", jobId, job };

    case "failed":
    case "cancelled":
      return {
        status: "failed",
        jobId,
        filename,
        message: job.errorText ?? "The import failed.",
      };

    case "uploaded":
    case "parsing":
    case "importing": {
      const advanced = job.processedRecords > prev.lastProcessed;
      return {
        status: "running",
        jobId,
        filename,
        job,
        lastAdvanceAt: advanced ? now : prev.lastAdvanceAt,
      };
    }

    default:
      return assertNever(job.status);
  }
}

function filenameOf(state: ImportFlowState): string | null {
  switch (state.status) {
    case "preparing":
    case "running":
      return state.filename;
    case "failed":
      return state.filename;
    default:
      return null;
  }
}

// --- derived views ----------------------------------------------------

export interface ImportProgress {
  readonly processed: number;
  readonly total: number | null;
  /** 0..1 once the engine has counted records; null until then. */
  readonly ratio: number | null;
  readonly indeterminate: boolean;
}

export function progressOf(job: ImportJob): ImportProgress {
  const total =
    job.totalRecords !== null && job.totalRecords > 0 ? job.totalRecords : null;
  const ratio =
    total === null
      ? null
      : Math.min(1, Math.max(0, job.processedRecords / total));
  return {
    processed: job.processedRecords,
    total,
    ratio,
    indeterminate: total === null,
  };
}

/**
 * True when a running job's record count has been static past {@link STALL_MS} —
 * the signal for the hook to re-invoke `gedcom-import` and drive a resume.
 */
export function isStalled(
  state: ImportFlowState,
  now: number,
  stallMs: number = STALL_MS,
): boolean {
  return state.status === "running" && now - state.lastAdvanceAt >= stallMs;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled import flow case: ${JSON.stringify(value)}`);
}
