/**
 * The export half of `/import` as a pure state machine, separate from React so
 * the start → settle → poll → download sequence unit-tests without a DOM or a
 * live Supabase stack. `useGedcomExport` wires this to real timers and the
 * `lib/db/export-jobs` queries.
 *
 * Unlike the import flow there is no progress and no cursor: `gedcom-export`
 * builds the whole file in one call and answers when it is done (SPEC §7).
 * The row, not the response body, is the source of truth — after the call
 * settles the hook reads `export_job` once and {@link settle} decides what
 * that reading means. Polling is only the fallback for a call that dropped
 * while the function may still have been working.
 */

import type { ExportJob, InvokeOutcome } from "@/lib/db";

/** Poll `export_job` this often while waiting on a dropped call. */
export const POLL_MS = 2_000;

/** A row still `pending` after this many polls was never picked up — the
 * dropped call never reached the function. 10 s at {@link POLL_MS}: the shell's
 * own pre-engine work (two auth round trips) takes well under a second. */
export const PENDING_GRACE_POLLS = 5;

/** Give up on a `running` row after this many polls (2 minutes at
 * {@link POLL_MS}). The function may still finish, so the row is left alone and
 * stays visible in the past-jobs list. */
export const MAX_POLLS = 60;

export const GAVE_UP_MESSAGE =
  "The export did not finish. Check the list below in a minute, or try again.";

export const NEVER_STARTED_MESSAGE =
  "The export service did not pick up the job. Try again.";

// --- flow state --------------------------------------------------------

export type ExportFlowState =
  | { readonly status: "idle" }
  /** Row inserted, function call in flight. */
  | { readonly status: "starting"; readonly jobId: string }
  /** The call dropped without a terminal row — watch the row. */
  | {
      readonly status: "polling";
      readonly jobId: string;
      readonly polls: number;
      /** Why the call dropped, shown if the row never leaves `pending`. */
      readonly dropped: string;
    }
  | {
      readonly status: "completed";
      readonly jobId: string;
      readonly job: ExportJob;
    }
  | {
      readonly status: "failed";
      readonly jobId: string | null;
      readonly message: string;
    };

export type PollingState = Extract<ExportFlowState, { status: "polling" }>;

export type ExportFlowAction =
  | { readonly type: "submit"; readonly jobId: string }
  | { readonly type: "wait"; readonly jobId: string; readonly dropped: string }
  | { readonly type: "polled" }
  | {
      readonly type: "finished";
      readonly jobId: string;
      readonly job: ExportJob;
    }
  | {
      readonly type: "error";
      readonly jobId: string | null;
      readonly message: string;
    }
  | { readonly type: "reset" };

export const initialExportFlow: ExportFlowState = { status: "idle" };

export function exportFlowReducer(
  state: ExportFlowState,
  action: ExportFlowAction,
): ExportFlowState {
  switch (action.type) {
    case "submit":
      return { status: "starting", jobId: action.jobId };

    case "wait":
      return {
        status: "polling",
        jobId: action.jobId,
        polls: 0,
        dropped: action.dropped,
      };

    case "polled":
      return state.status === "polling"
        ? { ...state, polls: state.polls + 1 }
        : state;

    case "finished":
      return { status: "completed", jobId: action.jobId, job: action.job };

    case "error":
      return { status: "failed", jobId: action.jobId, message: action.message };

    case "reset":
      return initialExportFlow;

    default:
      return assertNever(action);
  }
}

// --- settling a row reading -------------------------------------------

export type Settlement =
  | { readonly kind: "completed" }
  | {
      readonly kind: "failed";
      /**
       * Who owns the failure. `row`: the row already says so, or it is a live
       * `running` row the flow is giving up on — leave it alone. `invoke`: the
       * engine never ran, so the client records the failure on the row.
       */
      readonly source: "row" | "invoke";
      readonly message: string;
    }
  /** Not terminal yet — keep watching the row. */
  | { readonly kind: "wait" };

/**
 * What a fresh `export_job` reading means for the flow, right after the call
 * settled. The `switch` is exhaustive over `export_status` — a new enum value
 * fails to compile here rather than silently polling forever.
 *
 * @param invoke how the call ended. A refusal with the row still `pending`
 *   means the shell answered before the engine ran (401 / 403 / 400), so that
 *   message is the only explanation there is and the function will not touch
 *   the row again. A transport failure says nothing about the function: it
 *   may be mid-build, so the row decides — wait.
 */
export function settle(job: ExportJob, invoke: InvokeOutcome): Settlement {
  switch (job.status) {
    case "completed":
      return { kind: "completed" };

    case "failed":
      return {
        kind: "failed",
        source: "row",
        message: job.errorText ?? "The export failed.",
      };

    case "pending":
      return !invoke.ok && invoke.kind === "refused"
        ? { kind: "failed", source: "invoke", message: invoke.message }
        : { kind: "wait" };

    case "running":
      return { kind: "wait" };

    default:
      return assertNever(job.status);
  }
}

/**
 * {@link settle} for a poll tick, plus the two ways waiting ends: a row still
 * `pending` past {@link PENDING_GRACE_POLLS} was never picked up (the client
 * records the dropped call's reason), and a `running` row past
 * {@link MAX_POLLS} is abandoned without touching it.
 */
export function settlePoll(state: PollingState, job: ExportJob): Settlement {
  const base = settle(job, { ok: true });
  if (base.kind !== "wait") {
    return base;
  }
  if (job.status === "pending" && state.polls >= PENDING_GRACE_POLLS) {
    return { kind: "failed", source: "invoke", message: state.dropped };
  }
  if (state.polls >= MAX_POLLS) {
    return { kind: "failed", source: "row", message: GAVE_UP_MESSAGE };
  }
  return base;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled export flow case: ${JSON.stringify(value)}`);
}
