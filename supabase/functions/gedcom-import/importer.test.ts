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
  NotificationType,
  Row,
  TableName,
} from "./importer.ts";

const JOB_ID = "00000000-0000-4000-8000-00000000abcd";

interface FakeOptions {
  readonly gedcom?: string;
  readonly mode?: ImportJobRow["mode"];
}

/** In-memory {@link ImportGateway}. Tables are id-keyed, so an upsert of a
 * repeated id overwrites — the same idempotency the real `onConflict: id` gives. */
class FakeGateway implements ImportGateway {
  readonly tables = new Map<TableName, Map<string, Row>>();
  readonly notifications: { type: NotificationType; payload: unknown }[] = [];
  upsertCalls = 0;
  private readonly gedcom: string;
  private job: ImportJobRow;

  constructor(opts: FakeOptions = {}) {
    this.gedcom = opts.gedcom ?? GEDCOM_551;
    this.job = {
      id: JOB_ID,
      mode: opts.mode ?? "initial",
      status: "uploaded",
      storage_path: "imports/tree.ged",
      started_by: null,
      total_records: null,
      processed_records: 0,
      cursor: null,
      stats: { added: 0, updated: 0, skipped: 0, removed: 0, warnings: [] },
    };
  }

  loadJob(): Promise<ImportJobRow> {
    return Promise.resolve({ ...this.job });
  }

  downloadGedcom(): Promise<string> {
    return Promise.resolve(this.gedcom);
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
    gw.rows("place").filter((r) =>
      r.name === "Boston, Suffolk, Massachusetts, USA"
    )
      .length,
    1,
  );
});

Deno.test("a mid-import kill resumes from the cursor without duplicating rows", async () => {
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
});

Deno.test("a non-initial job fails with an import_failed notification", async () => {
  const gw = new FakeGateway({ mode: "replace_all" });

  const outcome = await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

  assertEquals(outcome.status, "failed");
  assertEquals(gw.currentJob.status, "failed");
  assertEquals(gw.notifications[0]?.type, "import_failed");
  assertEquals(gw.rows("person").length, 0);
});

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

Deno.test("dangling pointers and junk places do not fail the import", async () => {
  const gw = new FakeGateway({ gedcom: DANGLING });

  const outcome = await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

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
});

Deno.test("an empty tree still completes and notifies", async () => {
  const gw = new FakeGateway({ gedcom: GEDCOM_EMPTY });

  const outcome = await runImport({ jobId: JOB_ID, gateway: gw, ...NO_YIELD });

  assertEquals(outcome.status, "completed");
  assertEquals(outcome.totalRecords, 0);
  assertEquals(gw.notifications[0]?.type, "import_finished");
});
