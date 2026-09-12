import { describe, expect, it } from "vitest";

import type { ExportJob, InvokeOutcome } from "@/lib/db";

import {
  exportFlowReducer,
  GAVE_UP_MESSAGE,
  initialExportFlow,
  MAX_POLLS,
  PENDING_GRACE_POLLS,
  settle,
  settlePoll,
  type ExportFlowState,
  type PollingState,
} from "./orchestrator";

const JOB_ID = "11111111-1111-1111-1111-111111111111";

const OK: InvokeOutcome = { ok: true };
const REFUSED: InvokeOutcome = {
  ok: false,
  kind: "refused",
  message: "moderator access required",
};
const DROPPED: InvokeOutcome = {
  ok: false,
  kind: "transport",
  message: "fetch failed",
};

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: JOB_ID,
    type: "manual_gedcom",
    status: "running",
    storagePath: null,
    sizeBytes: null,
    errorText: null,
    createdAt: "2026-09-12T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function polling(polls: number): PollingState {
  return { status: "polling", jobId: JOB_ID, polls, dropped: "fetch failed" };
}

describe("settle", () => {
  it("completes on a completed row", () => {
    expect(settle(job({ status: "completed" }), OK)).toEqual({
      kind: "completed",
    });
  });

  it("fails with the row's own error text, owned by the row", () => {
    expect(
      settle(job({ status: "failed", errorText: "tree is empty" }), REFUSED),
    ).toEqual({ kind: "failed", source: "row", message: "tree is empty" });
  });

  it("fails with a fallback message when the row has no error text", () => {
    expect(settle(job({ status: "failed" }), OK)).toEqual({
      kind: "failed",
      source: "row",
      message: "The export failed.",
    });
  });

  it("waits on a running row whatever the call said", () => {
    expect(settle(job({ status: "running" }), DROPPED)).toEqual({
      kind: "wait",
    });
    expect(settle(job({ status: "running" }), REFUSED)).toEqual({
      kind: "wait",
    });
  });

  it("surfaces a refusal when the row never left pending — the client owns it", () => {
    expect(settle(job({ status: "pending" }), REFUSED)).toEqual({
      kind: "failed",
      source: "invoke",
      message: "moderator access required",
    });
  });

  it("waits on a pending row after a transport failure — the function may still be working", () => {
    expect(settle(job({ status: "pending" }), DROPPED)).toEqual({
      kind: "wait",
    });
    expect(settle(job({ status: "pending" }), OK)).toEqual({ kind: "wait" });
  });
});

describe("settlePoll", () => {
  it("passes a terminal row straight through", () => {
    expect(settlePoll(polling(0), job({ status: "completed" }))).toEqual({
      kind: "completed",
    });
  });

  it("keeps waiting on a pending row inside the grace window", () => {
    expect(
      settlePoll(polling(PENDING_GRACE_POLLS - 1), job({ status: "pending" })),
    ).toEqual({ kind: "wait" });
  });

  it("gives the dropped call's reason once a pending row outlives the grace window", () => {
    expect(
      settlePoll(polling(PENDING_GRACE_POLLS), job({ status: "pending" })),
    ).toEqual({ kind: "failed", source: "invoke", message: "fetch failed" });
  });

  it("keeps waiting on a running row past the pending grace window", () => {
    expect(
      settlePoll(polling(PENDING_GRACE_POLLS), job({ status: "running" })),
    ).toEqual({ kind: "wait" });
  });

  it("abandons a running row at the poll budget without owning it", () => {
    expect(settlePoll(polling(MAX_POLLS), job({ status: "running" }))).toEqual({
      kind: "failed",
      source: "row",
      message: GAVE_UP_MESSAGE,
    });
  });
});

describe("exportFlowReducer", () => {
  it("walks idle → starting → polling → completed", () => {
    let state = exportFlowReducer(initialExportFlow, {
      type: "submit",
      jobId: JOB_ID,
    });
    expect(state).toEqual({ status: "starting", jobId: JOB_ID });

    state = exportFlowReducer(state, {
      type: "wait",
      jobId: JOB_ID,
      dropped: "fetch failed",
    });
    expect(state).toEqual(polling(0));

    state = exportFlowReducer(state, { type: "polled" });
    expect(state).toEqual(polling(1));

    const done = job({ status: "completed" });
    state = exportFlowReducer(state, {
      type: "finished",
      jobId: JOB_ID,
      job: done,
    });
    expect(state).toEqual({ status: "completed", jobId: JOB_ID, job: done });
  });

  it("ignores a stray poll outside the polling state", () => {
    const starting: ExportFlowState = { status: "starting", jobId: JOB_ID };
    expect(exportFlowReducer(starting, { type: "polled" })).toBe(starting);
  });

  it("records an error with the job id when one exists", () => {
    const state = exportFlowReducer(
      { status: "starting", jobId: JOB_ID },
      { type: "error", jobId: JOB_ID, message: "boom" },
    );
    expect(state).toEqual({ status: "failed", jobId: JOB_ID, message: "boom" });
  });

  it("resets to idle from any state", () => {
    expect(
      exportFlowReducer(
        { status: "failed", jobId: null, message: "boom" },
        { type: "reset" },
      ),
    ).toEqual(initialExportFlow);
  });
});
