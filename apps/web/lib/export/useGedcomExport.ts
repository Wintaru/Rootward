"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import {
  createExportJob,
  type ExportJob,
  getExportJob,
  invokeGedcomExport,
  markExportJobFailed,
} from "@/lib/db";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  exportFlowReducer,
  initialExportFlow,
  NEVER_STARTED_MESSAGE,
  POLL_MS,
  settle,
  settlePoll,
  type ExportFlowState,
  type Settlement,
} from "./orchestrator";

export interface UseGedcomExport {
  readonly state: ExportFlowState;
  /** Start a `manual_gedcom` export. Ignored while one is in flight. */
  readonly start: () => void;
  /** Return to the idle state so another export can start. */
  readonly reset: () => void;
}

/**
 * Owns the export half of `/import`: insert the `export_job` row, invoke
 * `gedcom-export`, and read the row back (SPEC §7, decision 29). The download
 * itself is `DownloadButton`'s job — it signs the file on click, the same way
 * the past-jobs list does. Rendering stays in the component; this hook is the
 * container.
 *
 * @param startedBy `account.id` of the signed-in moderator — recorded on the
 *   job row.
 * @param onSettled called once the job reaches a terminal state, so the
 *   caller can refresh the past-jobs list.
 */
export function useGedcomExport(
  startedBy: string,
  onSettled?: () => void,
): UseGedcomExport {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, dispatch] = useReducer(exportFlowReducer, initialExportFlow);

  // One export at a time; cleared when the flow reaches a terminal state.
  const inFlight = useRef(false);
  // Kept fresh without re-creating `start` / the poll effect on every render.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const settled = useCallback(() => {
    inFlight.current = false;
    onSettledRef.current?.();
  }, []);

  const fail = useCallback(
    (jobId: string, message: string) => {
      dispatch({ type: "error", jobId, message });
      settled();
    },
    [settled],
  );

  /** Act on a settlement. Returns whether the flow is now terminal. */
  const apply = useCallback(
    async (
      jobId: string,
      job: ExportJob,
      settlement: Settlement,
    ): Promise<boolean> => {
      switch (settlement.kind) {
        case "wait":
          return false;
        case "failed":
          if (settlement.source === "invoke") {
            // The engine never ran, so nothing else will mark the row. Best
            // effort: the message is shown either way, and a row that stays
            // "Queued" is the only cost of this write failing.
            try {
              await markExportJobFailed(supabase, jobId, settlement.message);
            } catch (error: unknown) {
              console.warn(`export_job ${jobId} left pending:`, error);
            }
          }
          fail(jobId, settlement.message);
          return true;
        case "completed":
          dispatch({ type: "finished", jobId, job });
          settled();
          return true;
        default:
          return assertNever(settlement);
      }
    },
    [fail, settled, supabase],
  );

  const start = useCallback(() => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    const jobId = crypto.randomUUID();
    dispatch({ type: "submit", jobId });

    void (async () => {
      try {
        await createExportJob(supabase, { id: jobId, startedBy });
      } catch (error: unknown) {
        fail(jobId, messageOf(error));
        return;
      }

      // The call settles either way; the row says what actually happened.
      const invoke = await invokeGedcomExport(supabase, jobId);

      let job: ExportJob;
      try {
        job = await getExportJob(supabase, jobId);
      } catch (error: unknown) {
        fail(jobId, invoke.ok ? messageOf(error) : invoke.message);
        return;
      }

      const terminal = await apply(jobId, job, settle(job, invoke));
      if (!terminal) {
        dispatch({
          type: "wait",
          jobId,
          dropped: invoke.ok ? NEVER_STARTED_MESSAGE : invoke.message,
        });
      }
    })();
  }, [apply, fail, startedBy, supabase]);

  const reset = useCallback(() => {
    inFlight.current = false;
    dispatch({ type: "reset" });
  }, []);

  // Poll only while a dropped call left the row non-terminal. Each `polled`
  // dispatch re-runs this effect, so a waiting job schedules the next read and
  // a terminal one stops here.
  useEffect(() => {
    if (state.status !== "polling") {
      return;
    }
    const polling = state;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      let job: ExportJob;
      try {
        job = await getExportJob(supabase, polling.jobId);
      } catch {
        if (!cancelled) {
          dispatch({ type: "polled" }); // a blip costs one poll, not the job
        }
        return;
      }
      if (cancelled) {
        return;
      }
      const terminal = await apply(
        polling.jobId,
        job,
        settlePoll(polling, job),
      );
      if (!terminal) {
        dispatch({ type: "polled" });
      }
    };

    const handle = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [apply, state, supabase]);

  return { state, start, reset };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled settlement: ${JSON.stringify(value)}`);
}
