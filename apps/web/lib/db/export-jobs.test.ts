import { describe, expect, it } from "vitest";

import {
  exportDownloadFilename,
  exportObjectKey,
  type ExportJob,
  isDownloadable,
} from "./export-jobs";

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "manual_gedcom",
    status: "completed",
    storagePath: "exports/11111111-1111-1111-1111-111111111111.ged",
    sizeBytes: 1234,
    errorText: null,
    createdAt: "2026-09-11T23:59:00.000Z",
    completedAt: "2026-09-12T10:00:05.000Z",
    ...overrides,
  };
}

describe("exportObjectKey", () => {
  it("strips the bucket prefix from storage_path", () => {
    expect(exportObjectKey(job())).toBe(
      "11111111-1111-1111-1111-111111111111.ged",
    );
  });

  it("is null without a path, an empty key, or a path outside the bucket", () => {
    expect(exportObjectKey(job({ storagePath: null }))).toBeNull();
    expect(exportObjectKey(job({ storagePath: "exports/" }))).toBeNull();
    expect(exportObjectKey(job({ storagePath: "imports/x.ged" }))).toBeNull();
  });
});

describe("isDownloadable", () => {
  it("needs a completed status and a signable path", () => {
    expect(isDownloadable(job())).toBe(true);
    expect(isDownloadable(job({ status: "running" }))).toBe(false);
    expect(isDownloadable(job({ storagePath: null }))).toBe(false);
  });
});

describe("exportDownloadFilename", () => {
  it("dates the file from completed_at", () => {
    expect(exportDownloadFilename(job())).toBe("rootward-2026-09-12.ged");
    expect(
      exportDownloadFilename(
        job({
          type: "manual_full",
          storagePath: "exports/11111111-1111-1111-1111-111111111111.gdz",
        }),
      ),
    ).toBe("rootward-2026-09-12.gdz");
  });

  it("falls back to created_at", () => {
    expect(exportDownloadFilename(job({ completedAt: null }))).toBe(
      "rootward-2026-09-11.ged",
    );
  });
});
