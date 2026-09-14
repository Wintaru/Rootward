import { assert, assertEquals } from "@std/assert";

import {
  GEDCOM_551,
  GEDCOM_EMPTY,
} from "../../../packages/gedcom/src/fixtures.ts";

import { runImport } from "./importer.ts";
import type {
  ImportGateway,
  ImportJobPatch,
  ImportJobRow,
  ImportSource,
  NotificationType,
  ReadyMediaFile,
  Row,
  TableName,
} from "./importer.ts";
import type { MediaBytesPatch } from "./media-attach.ts";

const JOB_ID = "00000000-0000-4000-8000-00000000abcd";

interface FakeOptions {
  readonly gedcom?: string;
  readonly mode?: ImportJobRow["mode"];
  /** A root the admin already chose; the import must not move it. */
  readonly defaultRootPersonId?: string;
  /** Report the job as `completed` on the finish guard's re-read, as if an
   * overlapping invocation finished first. */
  readonly completedBeforeGuard?: boolean;
  /** A GedZip's already-processed media (issue #104 pt. 2 -- the browser
   * runs the real validate/EXIF-strip/derivative pipeline before upload, so
   * the engine only ever sees the result, never raw bytes); empty for a
   * plain `.ged` upload, which is what every pre-existing test exercises. */
  readonly readyMedia?: ReadonlyMap<string, ReadyMediaFile>;
  /** Make every `writeMediaObject` call reject, to exercise a mid-attach I/O
   * failure. */
  readonly failWriteMediaObject?: boolean;
}

/** In-memory {@link ImportGateway}. Tables are id-keyed, so an upsert of a
 * repeated id overwrites — the same idempotency the real `onConflict: id` gives. */
class FakeGateway implements ImportGateway {
  readonly tables = new Map<TableName, Map<string, Row>>();
  readonly notifications: { type: NotificationType; payload: unknown }[] = [];
  upsertCalls = 0;
  loadJobCalls = 0;
  defaultRootPersonId: string | null;
  /** Every id the engine asked to set, in order — the engine's contract is
   * "always ask on finish; the gateway decides", so a preset root still sees
   * one call. */
  readonly rootWrites: string[] = [];
  /** Every object `writeMediaObject` was asked to write, path → bytes. */
  readonly writtenObjects = new Map<string, Uint8Array>();
  /** Every `readReadyMedia` call's requested paths, in order — proof the
   * engine asks for one batch's worth of archive entries at a time instead
   * of the whole archive (issue #104). */
  readonly readReadyMediaCalls: (readonly string[])[] = [];
  readonly mediaUpdates: { mediaId: string; patch: MediaBytesPatch }[] = [];
  private readonly gedcom: string;
  private readonly completedBeforeGuard: boolean;
  private readonly readyMedia: ReadonlyMap<string, ReadyMediaFile>;
  private readonly failWriteMediaObject: boolean;
  private job: ImportJobRow;

  constructor(opts: FakeOptions = {}) {
    this.gedcom = opts.gedcom ?? GEDCOM_551;
    this.defaultRootPersonId = opts.defaultRootPersonId ?? null;
    this.completedBeforeGuard = opts.completedBeforeGuard ?? false;
    this.readyMedia = opts.readyMedia ?? new Map();
    this.failWriteMediaObject = opts.failWriteMediaObject ?? false;
    this.job = {
      id: JOB_ID,
      mode: opts.mode ?? "initial",
      status: "uploaded",
      storage_path: "imports/tree.ged",
      started_by: null,
      total_records: null,
      processed_records: 0,
      cursor: null,
      stats: {
        added: 0,
        updated: 0,
        skipped: 0,
        removed: 0,
        warnings: [],
        claimedMediaPaths: [],
      },
    };
  }

  loadJob(): Promise<ImportJobRow> {
    this.loadJobCalls += 1;
    // The second read per invocation is the finish guard (`ingest` re-reads
    // the job before claiming completion).
    if (this.completedBeforeGuard && this.loadJobCalls === 2) {
      return Promise.resolve({ ...this.job, status: "completed" });
    }
    return Promise.resolve({ ...this.job });
  }

  downloadSource(): Promise<ImportSource> {
    return Promise.resolve({
      gedcomText: this.gedcom,
      mediaEntryNames: [...this.readyMedia.keys()],
      readReadyMedia: (paths: readonly string[]) => {
        this.readReadyMediaCalls.push(paths);
        return Promise.resolve(
          new Map(
            paths.flatMap((path) => {
              const ready = this.readyMedia.get(path);
              return ready === undefined ? [] : [[path, ready] as const];
            }),
          ),
        );
      },
    });
  }

  writeMediaObject(path: string, bytes: Uint8Array): Promise<void> {
    if (this.failWriteMediaObject) {
      return Promise.reject(new Error("simulated storage write failure"));
    }
    this.writtenObjects.set(path, bytes);
    return Promise.resolve();
  }

  /** Mirrors the real gateway's `update ... where id = mediaId`: merges into
   * whichever `media` row `buildMedia` already upserted this batch, so a
   * test can assert on the row's final state via {@link rows}. */
  updateMediaBytes(mediaId: string, patch: MediaBytesPatch): Promise<void> {
    this.mediaUpdates.push({ mediaId, patch });
    const store = this.tables.get("media");
    const row = store?.get(mediaId);
    if (store !== undefined && row !== undefined) {
      store.set(mediaId, {
        ...row,
        mime_type: patch.mimeType,
        size_bytes: patch.sizeBytes,
        storage_path_original: patch.storagePathOriginal,
        storage_path_thumb: patch.storagePathThumb,
        storage_path_display: patch.storagePathDisplay,
        exif: patch.exif,
      });
    }
    return Promise.resolve();
  }

  upsertRows(table: TableName, rows: readonly Row[]): Promise<void> {
    this.upsertCalls += 1;
    const store = this.tables.get(table) ?? new Map<string, Row>();
    for (const row of rows) {
      store.set(row.id, row);
    }
    this.tables.set(table, store);
    return Promise.resolve();
  }

  updateJob(_jobId: string, patch: ImportJobPatch): Promise<void> {
    this.job = { ...this.job, ...patch } as ImportJobRow;
    return Promise.resolve();
  }

  createNotification(
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.notifications.push({ type, payload });
    return Promise.resolve();
  }

  setDefaultRootPersonIfUnset(personId: string): Promise<void> {
    this.rootWrites.push(personId);
    this.defaultRootPersonId ??= personId;
    return Promise.resolve();
  }

  rows(table: TableName): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  ids(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [table, store] of this.tables) {
      out[table] = [...store.keys()].sort();
    }
    return out;
  }

  get currentJob(): ImportJobRow {
    return this.job;
  }
}

const NO_YIELD = {
  now: () => Date.now(),
  budgetMs: Number.MAX_SAFE_INTEGER,
  batchSize: 500,
  reinvoke: () => Promise.resolve(),
};

/** A media-attach batch reinvokes unconditionally regardless of `budgetMs`
 * (issue #101 -- one real photo's decode/encode work can trip the edge
 * runtime's own CPU/memory ceiling well inside the wall-clock budget), so a
 * GedZip test needs to keep calling `runImport` until it actually finishes,
 * the same way a real client re-polls, rather than assuming one call
 * completes the job the way every non-media test can. */
async function runToCompletion(
  gw: FakeGateway,
  reinvoke: () => Promise<void> = NO_YIELD.reinvoke,
): Promise<Awaited<ReturnType<typeof runImport>>> {
  for (let i = 0; i < 1000; i++) {
    const outcome = await runImport({
      jobId: JOB_ID,
      gateway: gw,
      ...NO_YIELD,
      reinvoke,
    });
    if (outcome.status !== "importing") {
      return outcome;
    }
  }
  throw new Error("runToCompletion: did not finish within 1000 invocations");
}

Deno.test("initial import runs to completion and notifies", async () => {
  const gw = new FakeGateway();

  const outcome = await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

  assertEquals(outcome.status, "completed");
  assertEquals(gw.currentJob.status, "completed");
  assert(gw.currentJob.completed_at !== undefined);
  assert(outcome.totalRecords > 0);
  assertEquals(outcome.processedRecords, outcome.totalRecords);
  assert(gw.currentJob.stats.added > 0, "stats.added should be recorded");

  assertEquals(gw.notifications.length, 1);
  assertEquals(gw.notifications[0].type, "import_finished");
  assertEquals(
    (gw.notifications[0].payload as { import_job_id: string }).import_job_id,
    JOB_ID,
  );
});

Deno.test("every created record keeps its gedcom_xref", async () => {
  const gw = new FakeGateway();
  await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

  const xrefs = (table: TableName) =>
    gw
      .rows(table)
      .map((r) => r.gedcom_xref)
      .filter((x): x is string => typeof x === "string")
      .sort();

  assertEquals(xrefs("person"), ["@I1@", "@I2@", "@I3@"]);
  assertEquals(xrefs("family"), ["@F1@"]);
  assertEquals(xrefs("source"), ["@S1@"]);
  assertEquals(xrefs("repository"), ["@R1@"]);
  assertEquals(xrefs("media"), ["@O1@"]);
});

Deno.test("places are deduplicated on the normalized name", async () => {
  const gw = new FakeGateway();
  await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

  const names = gw.rows("place").map((r) => r.normalized_name);
  assertEquals(new Set(names).size, names.length);
  // I1/I2 events + the marriage all sit in Boston -> one row, not four.
  assertEquals(
    gw
      .rows("place")
      .filter((r) => r.name === "Boston, Suffolk, Massachusetts, USA").length,
    1,
  );
});

Deno.test(
  "a mid-import kill resumes from the cursor without duplicating rows",
  async () => {
    const single = new FakeGateway();
    await runImport({ jobId: JOB_ID, gateway: single, ...NO_YIELD });

    const resumed = new FakeGateway();
    let ticks = 0;
    const clock = () => (ticks += 1_000);
    let invocations = 0;
    let status = "importing";
    while (status === "importing" && invocations < 500) {
      invocations += 1;
      const outcome = await runImport({
        jobId: JOB_ID,
        gateway: resumed,
        now: clock,
        budgetMs: 0, // yield after every batch
        batchSize: 1,
        reinvoke: () => Promise.resolve(),
      });
      status = outcome.status;
    }

    assertEquals(status, "completed");
    assert(invocations > 3, `expected several invocations, got ${invocations}`);
    // Same rows, same ids — the deterministic uuidv5 ids make every replay an
    // overwrite, so the piecemeal run lands exactly where the one-shot run did.
    assertEquals(resumed.ids(), single.ids());
    assertEquals(
      resumed.currentJob.processed_records,
      single.currentJob.processed_records,
    );
    assertEquals(resumed.notifications.length, 1);
  },
);

Deno.test(
  "a non-initial job fails with an import_failed notification",
  async () => {
    const gw = new FakeGateway({ mode: "replace_all" });

    const outcome = await runImport({
      jobId: JOB_ID,
      gateway: gw,
      ...NO_YIELD,
    });

    assertEquals(outcome.status, "failed");
    assertEquals(gw.currentJob.status, "failed");
    assertEquals(gw.notifications[0]?.type, "import_failed");
    assertEquals(gw.rows("person").length, 0);
  },
);

const DANGLING = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Ann /Lee/
1 BIRT
2 PLAC ,
1 SOUR @S404@
2 PAGE 5
1 OBJE @O404@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I999@
1 CHIL @I998@
0 TRLR
`;

Deno.test(
  "dangling pointers and junk places do not fail the import",
  async () => {
    const gw = new FakeGateway({ gedcom: DANGLING });

    const outcome = await runImport({
      jobId: JOB_ID,
      gateway: gw,
      ...NO_YIELD,
    });

    assertEquals(outcome.status, "completed");
    // The one real person landed; the missing wife/child/source/object did not
    // become orphan rows, and the junk PLAC produced no place.
    assertEquals(gw.rows("person").length, 1);
    assertEquals(gw.rows("place").length, 0);
    assertEquals(gw.rows("family_child").length, 0);
    const family = gw.rows("family")[0];
    assertEquals(family.partner2_id, null);
    const birth = gw.rows("event")[0];
    assertEquals(birth.place_id, null);
    // A synthesised source keeps the citation; the media link keeps a stub media.
    assertEquals(gw.rows("citation").length, 1);
    assertEquals(gw.rows("media_link").length, 1);
    assert(outcome.stats.warnings.length >= 3, "missing refs should be warned");
  },
);

Deno.test("an empty tree still completes and notifies", async () => {
  const gw = new FakeGateway({ gedcom: GEDCOM_EMPTY });

  const outcome = await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

  assertEquals(outcome.status, "completed");
  assertEquals(outcome.totalRecords, 0);
  assertEquals(gw.notifications[0]?.type, "import_finished");
  // Nobody to point the tree at — the engine never asks (#51).
  assertEquals(gw.rootWrites, []);
  assertEquals(gw.defaultRootPersonId, null);
});

Deno.test(
  "completion sets an unset default root to the first INDI (#51)",
  async () => {
    const gw = new FakeGateway();

    await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

    const first = gw.rows("person").find((r) => r.gedcom_xref === "@I1@");
    assert(first !== undefined, "@I1@ should have been imported");
    assertEquals(gw.rootWrites, [first.id]);
    assertEquals(gw.defaultRootPersonId, first.id);
  },
);

Deno.test(
  "a preset default root is still offered once — the gateway keeps it (#51)",
  async () => {
    const chosen = "11111111-1111-4111-8111-111111111111";
    const gw = new FakeGateway({ defaultRootPersonId: chosen });

    await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

    // The engine's contract is "always ask on finish"; the conditional write in
    // the gateway (`… IS NULL`) is what leaves an admin's choice alone.
    const first = gw.rows("person").find((r) => r.gedcom_xref === "@I1@");
    assertEquals(gw.rootWrites, [first?.id]);
    assertEquals(gw.defaultRootPersonId, chosen);
  },
);

Deno.test(
  "a finish that lost the race to an overlapping invocation sets nothing (#51)",
  async () => {
    const gw = new FakeGateway({ completedBeforeGuard: true });

    const outcome = await runImport({
      jobId: JOB_ID,
      gateway: gw,
      ...NO_YIELD,
    });

    // The finish guard saw `completed` and skipped the whole block: no root
    // write, no second notification.
    assertEquals(outcome.status, "completed");
    assertEquals(gw.rootWrites, []);
    assertEquals(gw.notifications.length, 0);
  },
);

// --- GedZip media attach (issue #101, reworked #104 pt. 2) ----------

/** A browser-processed photo with no derivatives -- the "stored original
 * only" outcome `processMediaBytes` reports for a MIME with no codec, or
 * (as here) simply what a test does not care to exercise further. */
function processedJpeg(bytes: Uint8Array): ReadyMediaFile {
  return {
    status: "processed",
    mimeType: "image/jpeg",
    originalBytes: bytes,
    derivatives: null,
    exif: { hasGps: false, gpsStripped: false },
    warnings: [],
  };
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

Deno.test(
  "GedZip: a matched archive file is attached to its media row",
  async () => {
    const gw = new FakeGateway({
      readyMedia: new Map([
        ["media/john-smith-portrait.jpg", processedJpeg(JPEG_BYTES)],
      ]),
    });

    const outcome = await runToCompletion(gw);

    assertEquals(outcome.status, "completed");
    const media = gw.rows("media").find((r) => r.gedcom_xref === "@O1@");
    assert(media !== undefined, "@O1@ should have a media row");
    assertEquals(media.mime_type, "image/jpeg");
    assertEquals(media.storage_path_original, `${media.id}/original.jpg`);
    assertEquals(gw.writtenObjects.get(`${media.id}/original.jpg`), JPEG_BYTES);
    assertEquals(
      outcome.stats.warnings.some(
        (w) => w.includes("not found") || w.includes("rejected"),
      ),
      false,
    );
  },
);

Deno.test(
  "GedZip: an unmatched FILE value stays reference-only and warns",
  async () => {
    const gw = new FakeGateway({
      readyMedia: new Map([
        ["media/someone-else.jpg", processedJpeg(JPEG_BYTES)],
      ]),
    });

    const outcome = await runToCompletion(gw);

    assertEquals(outcome.status, "completed");
    assertEquals(gw.mediaUpdates.length, 0);
    assertEquals(gw.writtenObjects.size, 0);
    assert(
      outcome.stats.warnings.some(
        (w) =>
          w.includes("@O1@") && w.includes("not found in the uploaded archive"),
      ),
    );
  },
);

Deno.test(
  "GedZip: a matched file the browser rejected for size stays reference-only and warns",
  async () => {
    const gw = new FakeGateway({
      readyMedia: new Map([
        ["john-smith-portrait.jpg", {
          status: "rejected",
          rejectReason: "size",
        }],
      ]),
    });

    const outcome = await runToCompletion(gw);

    assertEquals(outcome.status, "completed");
    assertEquals(gw.mediaUpdates.length, 0);
    assert(
      outcome.stats.warnings.some(
        (w) => w.includes("@O1@") && w.includes("rejected (size)"),
      ),
    );
  },
);

Deno.test(
  "a plain .ged import (no archive) never asks for ready media",
  async () => {
    const gw = new FakeGateway();

    await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

    assertEquals(gw.readReadyMediaCalls.length, 0);
    assertEquals(gw.writtenObjects.size, 0);
  },
);

/** Two people, two `OBJE` records with the same basename in unrelated local
 * directories — the default-camera-filename collision a multi-contributor
 * archive produces. Only one may legitimately claim the single matching
 * archive file. */
const GEDCOM_BASENAME_COLLISION = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Jane /Doe/
1 OBJE @O1@
0 @I2@ INDI
1 NAME Bob /Doe/
1 OBJE @O2@
0 @O1@ OBJE
1 FILE C:\\Users\\Jane\\Pictures\\photo.jpg
0 @O2@ OBJE
1 FILE C:\\Users\\Bob\\Pictures\\photo.jpg
0 TRLR
`;

Deno.test(
  "GedZip: a basename match is granted to only one of two colliding records",
  async () => {
    const gw = new FakeGateway({
      gedcom: GEDCOM_BASENAME_COLLISION,
      readyMedia: new Map([["media/photo.jpg", processedJpeg(JPEG_BYTES)]]),
    });

    const outcome = await runToCompletion(gw);

    assertEquals(outcome.status, "completed");
    assertEquals(gw.mediaUpdates.length, 1);
    const media = gw.rows("media");
    const attached = media.filter((r) => r.storage_path_original !== undefined);
    assertEquals(attached.length, 1);
    assert(
      outcome.stats.warnings.some(
        (w) =>
          w.includes("@O2@") && w.includes("not found in the uploaded archive"),
      ),
      "the second record should warn instead of silently reusing the match",
    );
  },
);

Deno.test(
  "GedZip: a mid-attach storage failure warns instead of failing the import",
  async () => {
    const gw = new FakeGateway({
      readyMedia: new Map([
        ["media/john-smith-portrait.jpg", processedJpeg(JPEG_BYTES)],
      ]),
      failWriteMediaObject: true,
    });

    const outcome = await runToCompletion(gw);

    assertEquals(outcome.status, "completed");
    assertEquals(gw.mediaUpdates.length, 0);
    assert(
      outcome.stats.warnings.some(
        (w) => w.includes("@O1@") && w.includes("could not be attached"),
      ),
    );
  },
);

/** Seven people, seven `OBJE` records, seven distinct archive files -- not a
 * multiple of `MEDIA_ATTACH_BATCH_SIZE` (3), so the batch that finishes the
 * phase (a partial batch of 1) is unambiguously the last one: exactly 2
 * reinvokes are necessary (after the first two full batches), and the third,
 * final batch continues into the next phase in the same invocation instead
 * of forcing a pointless extra one. */
const PHOTO_COUNT = 7;
const GEDCOM_MANY_PHOTOS = [
  "0 HEAD",
  "1 GEDC",
  "2 VERS 5.5.1",
  ...Array.from({ length: PHOTO_COUNT }, (_, i) =>
    [
      `0 @I${String(i)}@ INDI`,
      `1 NAME Person ${String(i)} /Doe/`,
      `1 OBJE @O${String(i)}@`,
    ].join("\n")),
  ...Array.from(
    { length: PHOTO_COUNT },
    (_, i) => `0 @O${String(i)}@ OBJE\n1 FILE photo-${String(i)}.jpg`,
  ),
  "0 TRLR",
  "",
].join("\n");

Deno.test(
  "GedZip: media attach reinvokes per small batch instead of all at once",
  async () => {
    const readyMedia = new Map(
      Array.from({ length: PHOTO_COUNT }, (_, i) => [
        `photo-${String(i)}.jpg`,
        processedJpeg(JPEG_BYTES),
      ]),
    );
    const gw = new FakeGateway({ gedcom: GEDCOM_MANY_PHOTOS, readyMedia });
    let reinvokes = 0;

    const outcome = await runToCompletion(gw, () => {
      reinvokes += 1;
      return Promise.resolve();
    });

    assertEquals(outcome.status, "completed");
    assertEquals(gw.mediaUpdates.length, PHOTO_COUNT);
    // 7 photos at 3 per batch is three media-phase batches (3, 3, 1); the
    // first two each force a reinvoke (real work remains), the last does not
    // (the phase is finished) -- proof the whole archive is chunked across
    // invocations rather than decoded/encoded all at once, and proof the
    // engine does not force a wasted extra round trip once it is done.
    assertEquals(
      reinvokes,
      2,
      `expected exactly 2 reinvokes for ${
        String(PHOTO_COUNT)
      } photos at batch size 3, got ${String(reinvokes)}`,
    );
  },
);

Deno.test(
  "GedZip: each media batch asks for only that batch's archive entries, not the whole archive",
  async () => {
    const readyMedia = new Map(
      Array.from({ length: PHOTO_COUNT }, (_, i) => [
        `photo-${String(i)}.jpg`,
        processedJpeg(JPEG_BYTES),
      ]),
    );
    const gw = new FakeGateway({ gedcom: GEDCOM_MANY_PHOTOS, readyMedia });

    const outcome = await runToCompletion(gw, () => Promise.resolve());

    assertEquals(outcome.status, "completed");
    // 7 photos at batch size 3 is three `readReadyMedia` calls (3, 3, 1) --
    // proof each call fetches only this batch's few entries, never all 7 at
    // once (the bug that OOM'd the worker on a real, many-photo archive).
    assertEquals(
      gw.readReadyMediaCalls.map((paths) => paths.length),
      [3, 3, 1],
    );
    for (const paths of gw.readReadyMediaCalls) {
      assert(
        paths.length <= 3,
        `a single readReadyMedia call asked for ${
          String(paths.length)
        } archive entries, more than one batch's worth`,
      );
    }
  },
);
