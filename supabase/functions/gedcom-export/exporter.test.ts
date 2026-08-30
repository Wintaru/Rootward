import { assert, assertEquals } from "@std/assert";

import { readGedcom } from "../../../packages/gedcom/src/index.ts";
import { GEDCOM_551 } from "../../../packages/gedcom/src/fixtures.ts";

import { runImport } from "../gedcom-import/importer.ts";
import type {
  ImportGateway,
  ImportJobPatch,
  ImportJobRow,
  Row,
  TableName,
} from "../gedcom-import/importer.ts";

import { runExport } from "./exporter.ts";
import type {
  ExportGateway,
  ExportJobPatch,
  ExportJobRow,
  TreeRows,
} from "./exporter.ts";

const JOB_ID = "00000000-0000-4000-8000-0000000000ff";

// --- fake import gateway (borrowed shape from gedcom-import's test) -----

class FakeImportGateway implements ImportGateway {
  readonly tables = new Map<TableName, Map<string, Row>>();
  private job: ImportJobRow = {
    id: "11111111-0000-4000-8000-000000000001",
    mode: "initial",
    status: "uploaded",
    storage_path: "imports/tree.ged",
    started_by: null,
    total_records: null,
    processed_records: 0,
    cursor: null,
    stats: { added: 0, updated: 0, skipped: 0, removed: 0, warnings: [] },
  };
  constructor(private readonly gedcom: string) {}
  loadJob(): Promise<ImportJobRow> {
    return Promise.resolve({ ...this.job });
  }
  downloadGedcom(): Promise<string> {
    return Promise.resolve(this.gedcom);
  }
  upsertRows(table: TableName, rows: readonly Row[]): Promise<void> {
    const store = this.tables.get(table) ?? new Map<string, Row>();
    for (const row of rows) {
      store.set(row.id, row);
    }
    this.tables.set(table, store);
    return Promise.resolve();
  }
  updateJob(_id: string, patch: ImportJobPatch): Promise<void> {
    this.job = { ...this.job, ...patch } as ImportJobRow;
    return Promise.resolve();
  }
  createNotification(): Promise<void> {
    return Promise.resolve();
  }
  rows(table: TableName): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }
}

const NO_YIELD = {
  now: () => Date.now(),
  budgetMs: Number.MAX_SAFE_INTEGER,
  batchSize: 500,
  reinvoke: () => Promise.resolve(),
};

/** Import a GEDCOM string and return the written rows as an export `TreeRows`. */
async function importToTree(gedcom: string): Promise<TreeRows> {
  const gw = new FakeImportGateway(gedcom);
  await runImport({
    jobId: "11111111-0000-4000-8000-000000000001",
    gateway: gw,
    ...NO_YIELD,
  });
  return treeFromImport(gw);
}

/** Adapt the importer's id-keyed row maps to the export engine's shape. The
 * importer writes the same snake_case columns; only `created_at` is synthesised
 * (deterministic, so ordering is stable). */
function treeFromImport(gw: FakeImportGateway): TreeRows {
  let clock = 0;
  const stamp = (rows: Row[]): Row[] =>
    rows.map((row) => ({
      ...row,
      created_at: new Date(Date.UTC(2020, 0, 1) + (clock += 1000))
        .toISOString(),
    }));

  return {
    persons: stamp(gw.rows("person")) as unknown as TreeRows["persons"],
    personNames: gw.rows("person_name") as unknown as TreeRows["personNames"],
    families: stamp(gw.rows("family")) as unknown as TreeRows["families"],
    familyChildren: gw.rows(
      "family_child",
    ) as unknown as TreeRows["familyChildren"],
    events: stamp(gw.rows("event")) as unknown as TreeRows["events"],
    facts: stamp(gw.rows("fact")) as unknown as TreeRows["facts"],
    notes: gw.rows("note") as unknown as TreeRows["notes"],
    citations: gw.rows("citation") as unknown as TreeRows["citations"],
    mediaLinks: gw.rows("media_link") as unknown as TreeRows["mediaLinks"],
    sources: stamp(gw.rows("source")) as unknown as TreeRows["sources"],
    repositories: stamp(gw.rows("repository")) as unknown as TreeRows[
      "repositories"
    ],
    media: stamp(gw.rows("media")) as unknown as TreeRows["media"],
    places: gw.rows("place") as unknown as TreeRows["places"],
  };
}

const EMPTY_TREE: TreeRows = {
  persons: [],
  personNames: [],
  families: [],
  familyChildren: [],
  events: [],
  facts: [],
  notes: [],
  citations: [],
  mediaLinks: [],
  sources: [],
  repositories: [],
  media: [],
  places: [],
};

// --- fake export gateway ---------------------------------------------

interface FakeExportOptions {
  readonly tree?: TreeRows;
  readonly type?: ExportJobRow["type"];
}

class FakeExportGateway implements ExportGateway {
  readonly uploads = new Map<string, string>();
  readonly patches: ExportJobPatch[] = [];
  private job: ExportJobRow;
  private readonly tree: TreeRows;

  constructor(opts: FakeExportOptions = {}) {
    this.tree = opts.tree ?? EMPTY_TREE;
    this.job = {
      id: JOB_ID,
      type: opts.type ?? "manual_gedcom",
      status: "pending",
      storage_path: null,
      started_by: null,
    };
  }
  loadJob(): Promise<ExportJobRow> {
    return Promise.resolve({ ...this.job });
  }
  fetchTree(): Promise<TreeRows> {
    return Promise.resolve(this.tree);
  }
  uploadGedcom(key: string, text: string): Promise<void> {
    this.uploads.set(key, text);
    return Promise.resolve();
  }
  signUrl(key: string, ttl: number): Promise<string> {
    return Promise.resolve(`https://signed.example/${key}?ttl=${ttl}`);
  }
  updateJob(_id: string, patch: ExportJobPatch): Promise<void> {
    this.patches.push(patch);
    this.job = { ...this.job, ...patch } as ExportJobRow;
    return Promise.resolve();
  }
  get currentJob(): ExportJobRow {
    return this.job;
  }
  get onlyUpload(): string {
    const values = [...this.uploads.values()];
    assertEquals(values.length, 1);
    return values[0];
  }
}

const FIXED_NOW = () => Date.UTC(2026, 5, 15, 12, 0, 0);

// --- tests ----------------------------------------------------------

Deno.test("exports a seeded tree to a valid 5.5.1 file that re-imports", async () => {
  const tree = await importToTree(GEDCOM_551);
  const gw = new FakeExportGateway({ tree });

  const outcome = await runExport({
    jobId: JOB_ID,
    gateway: gw,
    now: FIXED_NOW,
  });

  assertEquals(outcome.status, "completed");
  assert(outcome.signedUrl !== null);
  assertEquals(outcome.storagePath, `exports/${JOB_ID}.ged`);
  assert(outcome.sizeBytes > 0);
  assertEquals(gw.currentJob.status, "completed");

  const reread = readGedcom(gw.onlyUpload);
  assertEquals(reread.warnings, []);
  assertEquals(reread.version, "5.5.1");
  assertEquals(reread.persons.length, 3);
  assertEquals(reread.families.length, 1);
  assertEquals(reread.sources.length, 1);
  assertEquals(reread.repositories.length, 1);
  assertEquals(reread.media.length, 1);

  // The HEAD block declares 5.5.1.
  const gedc = reread.header.find((n) => n.tag === "GEDC");
  const vers = gedc?.children?.find((n) => n.tag === "VERS");
  assertEquals(vers?.value, "5.5.1");

  const john = reread.persons.find((p) => p.gedcom_xref === "@I1@");
  assert(john !== undefined);
  assertEquals(john.given_name, "John Fitzgerald");
  assertEquals(john.surname, "Smith");
  assertEquals(john.nickname, "Jack");
  assertEquals(john.additional_names.length, 1);
  assertEquals(john.additional_names[0].surname, "Smyth");
  const birth = john.events.find((e) => e.type === "birth");
  assertEquals(birth?.date?.date_value_raw, "12 MAR 1820");
  assertEquals(birth?.place_name, "Boston, Suffolk, Massachusetts, USA");

  const family = reread.families[0];
  assertEquals(
    [family.partner1_xref, family.partner2_xref].sort(),
    ["@I1@", "@I2@"],
  );
  assertEquals(family.children[0].person_xref, "@I3@");
});

Deno.test("the exported file survives a second import unchanged in shape", async () => {
  const first = await importToTree(GEDCOM_551);
  const gw = new FakeExportGateway({ tree: first });
  await runExport({ jobId: JOB_ID, gateway: gw, now: FIXED_NOW });

  const second = await importToTree(gw.onlyUpload);

  assertEquals(second.persons.length, first.persons.length);
  assertEquals(second.families.length, first.families.length);
  assertEquals(second.events.length, first.events.length);
  assertEquals(second.familyChildren.length, first.familyChildren.length);
  assertEquals(second.sources.length, first.sources.length);
  assertEquals(second.repositories.length, first.repositories.length);
});

Deno.test("export is deterministic", async () => {
  const tree = await importToTree(GEDCOM_551);
  const a = new FakeExportGateway({ tree });
  const b = new FakeExportGateway({ tree });
  await runExport({ jobId: JOB_ID, gateway: a, now: FIXED_NOW });
  await runExport({ jobId: JOB_ID, gateway: b, now: FIXED_NOW });
  assertEquals(a.onlyUpload, b.onlyUpload);
});

Deno.test("an app-created person with no gedcom_xref gets a synthesised xref", async () => {
  const tree: TreeRows = {
    ...EMPTY_TREE,
    persons: [
      {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        gedcom_xref: null,
        given_name: "Grace",
        surname: "Hopper",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "female",
        familysearch_id: null,
        ancestral_file_number: null,
        user_reference_number: null,
        raw_gedcom: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
  };
  const gw = new FakeExportGateway({ tree });
  const outcome = await runExport({
    jobId: JOB_ID,
    gateway: gw,
    now: FIXED_NOW,
  });

  assertEquals(outcome.status, "completed");
  const reread = readGedcom(gw.onlyUpload);
  assertEquals(reread.warnings, []);
  assertEquals(reread.persons.length, 1);
  assertEquals(reread.persons[0].gedcom_xref, "@I1@");
  assertEquals(reread.persons[0].surname, "Hopper");
});

Deno.test("an empty tree still produces a valid file", async () => {
  const gw = new FakeExportGateway();
  const outcome = await runExport({
    jobId: JOB_ID,
    gateway: gw,
    now: FIXED_NOW,
  });

  assertEquals(outcome.status, "completed");
  assertEquals(outcome.counts.persons, 0);
  const reread = readGedcom(gw.onlyUpload);
  assertEquals(reread.warnings, []);
  assertEquals(reread.persons.length, 0);
});

Deno.test("a non-manual_gedcom job fails without writing a file", async () => {
  const gw = new FakeExportGateway({ type: "manual_full" });
  const outcome = await runExport({
    jobId: JOB_ID,
    gateway: gw,
    now: FIXED_NOW,
  });

  assertEquals(outcome.status, "failed");
  assertEquals(gw.currentJob.status, "failed");
  assert(
    gw.patches.some((p) => typeof p.error_text === "string"),
    "error_text should be recorded",
  );
  assertEquals(gw.uploads.size, 0);
});
