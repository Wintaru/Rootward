"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import {
  createImportJob,
  getImportJob,
  type ImportJob,
  invokeGedcomImport,
  uploadGedcomFile,
} from "@/lib/db";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  importFlowReducer,
  initialImportFlow,
  isStalled,
  POLL_MS,
  type ImportFlowState,
} from "./orchestrator";

/** Consecutive poll failures tolerated before the flow gives up. A blip must
 * not strand a job that is still resuming server-side. */
const MAX_POLL_FAILURES = 3;

export interface UseGedcomImport {
  readonly state: ImportFlowState;
  /** Kick off an import for the chosen file. Ignored while one is in flight. */
  readonly start: (file: File) => void;
  /** Return to the idle state so another file can be imported. */
  readonly reset: () => void;
}

/**
 * Owns the `/import` flow: create the job, upload the file, invoke
 * `gedcom-import`, then poll `import_job` until it finishes — re-invoking the
 * function whenever progress stalls so a timed-out run still completes
 * (SPEC §7, decision 8). Rendering stays in the component; this hook is the
 * container.
 *
 * @param startedBy `account.id` of the signed-in moderator — recorded on the
 *   job and propagated to `created_by` / `updated_by` on every imported row.
 */
export function useGedcomImport(startedBy: string): UseGedcomImport {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, dispatch] = useReducer(importFlowReducer, initialImportFlow);

  // Guards: one run at a time, one nudge per stall window, and a run of
  // transient poll failures before surfacing an error.
  const inFlight = useRef(false);
  const nudgedFor = useRef<number | null>(null);
  const pollFailures = useRef(0);

  const start = useCallback(
    (file: File) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      nudgedFor.current = null;
      pollFailures.current = 0;
      dispatch({ type: "submit", filename: file.name });

      void (async () => {
        const jobId = crypto.randomUUID();
        try {
          await createImportJob(supabase, {
            id: jobId,
            filename: file.name,
            startedBy,
          });
          await uploadGedcomFile(supabase, jobId, file);
          await invokeGedcomImport(supabase, jobId);
          const job = await getImportJob(supabase, jobId);
          dispatch({
            type: "started",
            jobId,
            filename: file.name,
            job,
            now: Date.now(),
          });
        } catch (error: unknown) {
          dispatch({
            type: "error",
            jobId,
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          inFlight.current = false;
        }
      })();
    },
    [supabase, startedBy],
  );

  const reset = useCallback(() => {
    inFlight.current = false;
    nudgedFor.current = null;
    pollFailures.current = 0;
    dispatch({ type: "reset" });
  }, []);

  // Poll while a job runs; nudge the function if progress stalls. Each `polled`
  // dispatch re-runs this effect, so a running job schedules the next read and a
  // terminal one stops here.
  useEffect(() => {
    if (state.status !== "running") {
      return;
    }
    const jobId = state.jobId;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      let job: ImportJob;
      try {
        job = await getImportJob(supabase, jobId);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        pollFailures.current += 1;
        if (pollFailures.current >= MAX_POLL_FAILURES) {
          dispatch({
            type: "error",
            jobId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return; // otherwise let the next tick retry
      }
      if (cancelled) {
        return;
      }
      pollFailures.current = 0;

      const now = Date.now();
      const action = { type: "polled", job, now } as const;
      const next = importFlowReducer(state, action);
      dispatch(action);

      if (
        next.status === "running" &&
        isStalled(next, now) &&
        nudgedFor.current !== next.lastAdvanceAt
      ) {
        nudgedFor.current = next.lastAdvanceAt;
        try {
          await invokeGedcomImport(supabase, jobId);
        } catch {
          // A failed nudge is not fatal — clear the marker so the next stalled
          // tick tries again.
          nudgedFor.current = null;
        }
      }
    };

    const handle = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [supabase, state]);

  return { state, start, reset };
}
