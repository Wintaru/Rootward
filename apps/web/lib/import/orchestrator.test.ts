import { describe, expect, it } from "vitest";

import type { ImportJob, ImportStats } from "@/lib/db";

import {
  importFlowReducer,
  initialImportFlow,
  isStalled,
  progressOf,
  STALL_MS,
  type ImportFlowState,
} from "./orchestrator";

const NO_STATS: ImportStats = {
  added: 0,
  updated: 0,
  skipped: 0,
  removed: 0,
  warnings: [],
};

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "importing",
    mode: "initial",
    filename: "tree.ged",
    processedRecords: 0,
    totalRecords: 100,
    stats: NO_STATS,
    errorText: null,
    ...overrides,
  };
}

function running(
  overrides: Partial<ImportJob>,
  lastAdvanceAt: number,
): ImportFlowState {
  return {
    status: "running",
    jobId: job().id,
    filename: "tree.ged",
    job: job(overrides),
    lastAdvanceAt,
  };
}

describe("settle (via the reducer) covers every import_status", () => {
  it.each([
    ["uploaded", "running"],
    ["parsing", "running"],
    ["importing", "running"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["cancelled", "failed"],
  ] as const)("%s -> flow %s", (status, expected) => {
    const next = importFlowReducer(running({ processedRecords: 5 }, 1_000), {
      type: "polled",
      job: job({ status, processedRecords: 5 }),
      now: 2_000,
    });
    expect(next.status).toBe(expected);
  });
});

describe("progressOf", () => {
  it("is indeterminate until the engine has counted records", () => {
    expect(progressOf(job({ totalRecords: null }))).toMatchObject({
      ratio: null,
      indeterminate: true,
    });
    expect(progressOf(job({ totalRecords: 0 }))).toMatchObject({
      ratio: null,
      indeterminate: true,
    });
  });

  it("reports a clamped ratio once a total is known", () => {
    expect(
      progressOf(job({ totalRecords: 200, processedRecords: 50 })).ratio,
    ).toBe(0.25);
    expect(
      progressOf(job({ totalRecords: 100, processedRecords: 250 })).ratio,
    ).toBe(1);
  });
});

describe("importFlowReducer", () => {
  it("moves to preparing on submit", () => {
    expect(
      importFlowReducer(initialImportFlow, {
        type: "submit",
        filename: "tree.ged",
      }),
    ).toEqual({ status: "preparing", filename: "tree.ged" });
  });

  it("starts running and stamps lastAdvanceAt", () => {
    const next = importFlowReducer(
      { status: "preparing", filename: "tree.ged" },
      {
        type: "started",
        jobId: job().id,
        filename: "tree.ged",
        job: job(),
        now: 1_000,
      },
    );
    expect(next).toMatchObject({ status: "running", lastAdvanceAt: 1_000 });
  });

  it("goes straight to completed when the first read is already done", () => {
    const done = job({ status: "completed", processedRecords: 100 });
    const next = importFlowReducer(
      { status: "preparing", filename: "tree.ged" },
      {
        type: "started",
        jobId: done.id,
        filename: "tree.ged",
        job: done,
        now: 1_000,
      },
    );
    expect(next).toMatchObject({ status: "completed", job: done });
  });

  it("advances lastAdvanceAt only when processed_records grows", () => {
    const start = running({ processedRecords: 10 }, 1_000);

    const grew = importFlowReducer(start, {
      type: "polled",
      job: job({ processedRecords: 40 }),
      now: 5_000,
    });
    expect(grew).toMatchObject({ status: "running", lastAdvanceAt: 5_000 });

    const flat = importFlowReducer(start, {
      type: "polled",
      job: job({ processedRecords: 10 }),
      now: 5_000,
    });
    expect(flat).toMatchObject({ status: "running", lastAdvanceAt: 1_000 });
  });

  it("fails with the job's error text", () => {
    const next = importFlowReducer(running({ processedRecords: 10 }, 1_000), {
      type: "polled",
      job: job({ status: "failed", errorText: "bad GEDCOM line 5" }),
      now: 5_000,
    });
    expect(next).toEqual({
      status: "failed",
      jobId: job().id,
      filename: "tree.ged",
      message: "bad GEDCOM line 5",
    });
  });

  it("ignores a poll that arrives after the flow left running", () => {
    const completed: ImportFlowState = {
      status: "completed",
      jobId: job().id,
      job: job({ status: "completed" }),
    };
    expect(
      importFlowReducer(completed, { type: "polled", job: job(), now: 9_000 }),
    ).toBe(completed);
  });

  it("resets to idle", () => {
    expect(importFlowReducer(running({}, 1_000), { type: "reset" })).toEqual(
      initialImportFlow,
    );
  });
});

describe("isStalled", () => {
  it("is false before the stall window and true after", () => {
    const state = running({ processedRecords: 30 }, 3_000);
    expect(isStalled(state, 3_000 + STALL_MS - 1)).toBe(false);
    expect(isStalled(state, 3_000 + STALL_MS)).toBe(true);
  });

  it("is never true off the running state", () => {
    expect(isStalled(initialImportFlow, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("full flow: a timed-out import still finishes via re-poll", () => {
  it("detects the stall, then completes after the resume nudge", () => {
    let state = importFlowReducer(initialImportFlow, {
      type: "submit",
      filename: "big.ged",
    });
    state = importFlowReducer(state, {
      type: "started",
      jobId: job().id,
      filename: "big.ged",
      job: job({ totalRecords: 100, processedRecords: 0 }),
      now: 1_000,
    });
    expect(state.status).toBe("running");

    // First batch lands.
    state = importFlowReducer(state, {
      type: "polled",
      job: job({ processedRecords: 40 }),
      now: 3_000,
    });
    expect(isStalled(state, 3_000)).toBe(false);

    // The function times out and its self-reinvoke is lost: no progress for a
    // full stall window. The hook would re-invoke `gedcom-import` here.
    state = importFlowReducer(state, {
      type: "polled",
      job: job({ processedRecords: 40 }),
      now: 3_000 + STALL_MS,
    });
    expect(isStalled(state, 3_000 + STALL_MS)).toBe(true);

    // The nudged run resumes from the cursor and pushes to completion.
    state = importFlowReducer(state, {
      type: "polled",
      job: job({ processedRecords: 80 }),
      now: 3_000 + STALL_MS + 2_000,
    });
    expect(isStalled(state, 3_000 + STALL_MS + 2_000)).toBe(false);

    state = importFlowReducer(state, {
      type: "polled",
      job: job({
        status: "completed",
        processedRecords: 100,
        stats: { added: 100, updated: 0, skipped: 0, removed: 0, warnings: [] },
      }),
      now: 3_000 + STALL_MS + 4_000,
    });

    expect(state).toMatchObject({
      status: "completed",
      job: { stats: { added: 100 } },
    });
  });
});
