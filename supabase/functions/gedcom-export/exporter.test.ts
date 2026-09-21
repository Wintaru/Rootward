import { assert, assertEquals } from "@std/assert";

import {
  buildMediaFileIndex,
  matchMediaFile,
  readGedcom,
  readGedZip,
  readMediaEntries,
} from "../../../packages/gedcom/src/index.ts";
import { GEDCOM_551 } from "../../../packages/gedcom/src/fixtures.ts";
import {
  CHILD_RELATION_KEYWORD,
  EVENT_TYPES,
  FACT_TYPES,
  NAME_TYPE_KEYWORD,
} from "../../../packages/gedcom/src/mapping.ts";
import { sniffMimeType } from "../../../packages/media/src/index.ts";
import {
  CALENDARS,
  GENEALOGY_DATE_KINDS,
} from "../../../packages/shared/src/index.ts";

import { runImport } from "../gedcom-import/importer.ts";
import type {
  ImportGateway,
  ImportJobPatch,
  ImportJobRow,
  ImportSource,
  ReadyMediaFile,
  Row,
  TableName,
} from "../gedcom-import/importer.ts";
import type { MediaBytesPatch } from "../gedcom-import/media-attach.ts";

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
    stats: {
      added: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      warnings: [],
      claimedMediaPaths: [],
    },
  };
  /** Every object `writeMediaObject` was asked to write, path → bytes. */
  readonly writtenObjects = new Map<string, Uint8Array>();
  constructor(
    private readonly gedcom: string,
    /** Archive path → browser-processed bytes, for a GedZip import. */
    private readonly readyMedia: ReadonlyMap<string, ReadyMediaFile> =
      new Map(),
  ) {}
  loadJob(): Promise<ImportJobRow> {
    return Promise.resolve({ ...this.job });
  }
  downloadSource(): Promise<ImportSource> {
    return Promise.resolve({
      gedcomText: this.gedcom,
      mediaEntryNames: [...this.readyMedia.keys()],
      readReadyMedia: (paths: readonly string[]) =>
        Promise.resolve(
          new Map(
            paths.flatMap((path) => {
              const ready = this.readyMedia.get(path);
              return ready === undefined ? [] : [[path, ready] as const];
            }),
          ),
        ),
    });
  }
  writeMediaObject(path: string, bytes: Uint8Array): Promise<void> {
    this.writtenObjects.set(path, bytes);
    return Promise.resolve();
  }
  updateMediaBytes(mediaId: string, patch: MediaBytesPatch): Promise<void> {
    const media = this.tables.get("media")?.get(mediaId);
    if (media === undefined) {
      return Promise.reject(new Error(`updateMediaBytes: no row ${mediaId}`));
    }
    media.mime_type = patch.mimeType;
    media.size_bytes = patch.sizeBytes;
    media.storage_path_original = patch.storagePathOriginal;
    media.storage_path_thumb = patch.storagePathThumb;
    media.storage_path_display = patch.storagePathDisplay;
    return Promise.resolve();
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
  setDefaultRootPersonIfUnset(): Promise<void> {
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

/** The large generated demo tree (`scripts/demo-tree`), committed as text.
 * The GedZip next to it is a build product (`pnpm demo:build`) and may be
 * absent -- the test that needs it is skipped then, not failed. */
const DEMO_TREE_URL = new URL(
  "../../../docs/reference/rootward-demo/rootward-demo.ged",
  import.meta.url,
);
const DEMO_GEDZIP_URL = new URL(
  "../../../docs/reference/rootward-demo/rootward-demo.gdz",
  import.meta.url,
);

function fileExists(url: URL): boolean {
  try {
    Deno.statSync(url);
    return true;
  } catch {
    return false;
  }
}

/** Distinct values of `pick` over `items`, for "the seed covers X" checks. */
function distinct<T, V>(items: readonly T[], pick: (item: T) => V): Set<V> {
  return new Set(items.map(pick));
}

function assertCovers<V>(actual: Set<V>, expected: readonly V[], what: string) {
  const missing = expected.filter((v) => !actual.has(v));
  assertEquals(missing, [], `${what} missing from the demo tree`);
}

/** A multiset key per row so two imports can be compared row-for-row without
 * depending on generated ids or insertion order. */
function sortedKeys<T>(rows: readonly T[], key: (row: T) => string): string[] {
  return rows.map(key).sort();
}

/** Adapt the importer's id-keyed row maps to the export engine's shape. The
 * importer writes the same snake_case columns; only `created_at` is synthesised
 * (deterministic, so ordering is stable). */
function treeFromImport(gw: FakeImportGateway): TreeRows {
  let clock = 0;
  const stamp = (rows: Row[]): Row[] =>
    rows.map((row) => ({
      ...row,
      created_at: new Date(
        Date.UTC(2020, 0, 1) + (clock += 1000),
      ).toISOString(),
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
    repositories: stamp(
      gw.rows("repository"),
    ) as unknown as TreeRows["repositories"],
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

Deno.test(
  "exports a seeded tree to a valid 5.5.1 file that re-imports",
  async () => {
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
    assertEquals([family.partner1_xref, family.partner2_xref].sort(), [
      "@I1@",
      "@I2@",
    ]);
    assertEquals(family.children[0].person_xref, "@I3@");
  },
);

Deno.test(
  "the exported file survives a second import unchanged in shape",
  async () => {
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
  },
);

Deno.test("export is deterministic", async () => {
  const tree = await importToTree(GEDCOM_551);
  const a = new FakeExportGateway({ tree });
  const b = new FakeExportGateway({ tree });
  await runExport({ jobId: JOB_ID, gateway: a, now: FIXED_NOW });
  await runExport({ jobId: JOB_ID, gateway: b, now: FIXED_NOW });
  assertEquals(a.onlyUpload, b.onlyUpload);
});

Deno.test(
  "an app-created person with no gedcom_xref gets a synthesised xref",
  async () => {
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
          visibility: "everyone_approved",
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
  },
);

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

Deno.test(
  "the demo GEDCOM (docs/reference/demo-tree.ged) round-trips",
  async () => {
    // The shipped demo file (issue #38) — a multi-generation family with a
    // first-cousin marriage (pedigree collapse), sources, a media ref, and
    // varied date forms. Import it, export it, re-import: the record set must be
    // unchanged and the file must re-read without warnings.
    const demo = Deno.readTextFileSync(
      new URL("../../../docs/reference/demo-tree.ged", import.meta.url),
    );

    const first = await importToTree(demo);
    const gw = new FakeExportGateway({ tree: first });
    const outcome = await runExport({
      jobId: JOB_ID,
      gateway: gw,
      now: FIXED_NOW,
    });
    assertEquals(outcome.status, "completed");

    const reread = readGedcom(gw.onlyUpload);
    assertEquals(reread.warnings, []);
    assertEquals(reread.version, "5.5.1");

    const second = await importToTree(gw.onlyUpload);
    assertEquals(second.persons.length, first.persons.length);
    assertEquals(second.families.length, first.families.length);
    assertEquals(second.events.length, first.events.length);
    assertEquals(second.familyChildren.length, first.familyChildren.length);
    assertEquals(second.sources.length, first.sources.length);
    assertEquals(second.repositories.length, first.repositories.length);

    // 11 individuals, 5 families; the repeated ancestor (@I1@) still appears once.
    assertEquals(reread.persons.length, 11);
    assertEquals(reread.families.length, 5);
    assertEquals(
      reread.persons.filter((p) => p.gedcom_xref === "@I1@").length,
      1,
    );
  },
);

// --- the large demo tree (scripts/demo-tree) ------------------------

Deno.test(
  "the large demo tree covers every shape the product has to render",
  () => {
    // The generator's promise (its header comment): 500+ people, every
    // event / fact / name type the reader maps, every date kind and
    // calendar, every child relation, every family shape. A regeneration
    // that quietly drops one of these fails here, not in a demo.
    const parsed = readGedcom(Deno.readTextFileSync(DEMO_TREE_URL));
    assertEquals(parsed.warnings, []);
    assertEquals(parsed.version, "5.5.1");
    assert(parsed.persons.length >= 500, "at least 500 people");
    assert(parsed.families.length >= 150, "at least 150 families");

    const personEvents = parsed.persons.flatMap((p) => p.events);
    const familyEvents = parsed.families.flatMap((f) => f.events);
    const events = [...personEvents, ...familyEvents];
    const facts = parsed.persons.flatMap((p) => p.facts);
    const dates = [...events, ...facts, ...parsed.media]
      .map((e) => e.date)
      .filter((d) => d !== null);

    // Expected sets come from the reader's own mapping tables, so a tag the
    // reader learns to map is a tag the demo tree must carry.
    assertCovers(
      distinct(events, (e) => e.type),
      [...new Set(Object.values(EVENT_TYPES)), "other"],
      "event types",
    );
    assertCovers(
      distinct(facts, (f) => f.type),
      [...new Set(Object.values(FACT_TYPES)), "other"],
      "fact types",
    );
    assertCovers(
      distinct(
        parsed.persons.flatMap((p) => p.additional_names),
        (n) => n.type,
      ),
      // `other` is a Rootward-side value the reader never produces.
      Object.keys(NAME_TYPE_KEYWORD).filter((t) => t !== "other"),
      "name types",
    );
    assertCovers(
      distinct(dates, (d) => d.date_kind),
      GENEALOGY_DATE_KINDS.filter((k) => k !== "unknown"),
      "date kinds",
    );
    assertCovers(
      distinct(dates, (d) => d.date_calendar),
      CALENDARS.filter((c) => c !== "unknown"),
      "calendars",
    );
    assert(dates.some((d) => d.date_dual_year), "a 1749/50 dual-year date");
    assertCovers(
      distinct(parsed.persons, (p) => p.sex),
      ["male", "female", "other", "unknown"],
      "sexes",
    );
    assertCovers(
      distinct(
        parsed.families.flatMap((f) => f.children),
        (c) => c.relation_to_partner1,
      ),
      // `unknown` only comes from a value the reader cannot place.
      [
        null,
        ...Object.keys(CHILD_RELATION_KEYWORD).filter((r) => r !== "unknown"),
      ],
      "child relations",
    );
    assertCovers(
      distinct(parsed.families, (f) => f.relationship_type),
      ["married", "unknown"],
      "union types",
    );
    assert(
      parsed.families.some((f) => f.partner2_xref === null),
      "a single-parent family",
    );
    assert(
      parsed.families.some(
        (f) => f.partner1_role === f.partner2_role && f.partner1_role !== null,
      ),
      "a same-sex couple",
    );
    assert(parsed.sources.length >= 10, "at least ten sources");
    assert(parsed.repositories.length >= 5, "at least five repositories");
    assert(parsed.notes.length >= 1, "a shared NOTE record");

    // Every person is a complete profile: birth with a citation, a primary
    // photo, a note, and both reference ids.
    for (const p of parsed.persons) {
      const birth = p.events.find((e) => e.type === "birth");
      assert(birth !== undefined, `${p.gedcom_xref} has no birth`);
      assert(birth.citations.length > 0, `${p.gedcom_xref} birth uncited`);
      assert(
        p.media_links.some((m) => m.is_primary),
        `${p.gedcom_xref} has no primary photo`,
      );
      assert(p.notes.length > 0, `${p.gedcom_xref} has no note`);
      assert(p.user_reference_number !== null, `${p.gedcom_xref} no REFN`);
      assert(p.familysearch_id !== null, `${p.gedcom_xref} no _FSFTID`);
    }
    // Internal consistency: no event after 2026, nothing dated before the
    // person's birth, no marriage after a partner's death or before 16, no
    // biological child born before a parent was 14 or after they died. The
    // year comparisons carry one year of slack because an approximate form
    // (`BEF 1901`, `AFT 1946`, `BET 1899 AND 1901`) shifts the parsed year.
    const byXref = new Map(parsed.persons.map((p) => [p.gedcom_xref, p]));
    const yearOf = (p: (typeof parsed.persons)[number], type: string) =>
      p.events.find((e) => e.type === type)?.date?.date_year1 ?? null;
    for (const p of parsed.persons) {
      const born = yearOf(p, "birth");
      for (const e of p.events) {
        const y = e.date?.date_year1 ?? null;
        if (y === null) {
          continue;
        }
        assert(y <= 2026, `${p.gedcom_xref} ${e.type} in ${y}`);
        assert(
          born === null || y >= born - 1,
          `${p.gedcom_xref} ${e.type} ${y} before birth ${born}`,
        );
      }
    }
    for (const f of parsed.families) {
      const partners = [f.partner1_xref, f.partner2_xref]
        .filter((x): x is string => x !== null)
        .map((x) => byXref.get(x))
        .filter((p): p is (typeof parsed.persons)[number] => p !== undefined);
      const wed = f.events.find((e) => e.type === "marriage")?.date
        ?.date_year1;
      if (wed !== undefined && wed !== null) {
        for (const p of partners) {
          const born = yearOf(p, "birth");
          const died = yearOf(p, "death");
          assert(
            born === null || wed - born >= 16,
            `${f.gedcom_xref}: ${p.gedcom_xref} married at ${
              wed - (born ?? 0)
            }`,
          );
          assert(
            died === null || wed <= died + 1,
            `${f.gedcom_xref}: ${p.gedcom_xref} married ${wed} after death ${died}`,
          );
        }
      }
      for (const c of f.children) {
        if (c.relation_to_partner1 !== null) {
          continue; // adopted / step / foster / guardian / sealed
        }
        const child = byXref.get(c.person_xref);
        const childBorn = child === undefined ? null : yearOf(child, "birth");
        for (const p of partners) {
          const born = yearOf(p, "birth");
          const died = yearOf(p, "death");
          assert(
            childBorn === null || born === null || childBorn - born >= 14,
            `${f.gedcom_xref}: child ${c.person_xref} born ${childBorn} to ${p.gedcom_xref} born ${born}`,
          );
          assert(
            childBorn === null || died === null || childBorn <= died + 1,
            `${f.gedcom_xref}: child ${c.person_xref} born ${childBorn} after ${p.gedcom_xref} died ${died}`,
          );
        }
      }
    }
    // Every media record names a flat file the archive can carry.
    for (const m of parsed.media) {
      assert(
        m.original_filename !== null && !m.original_filename.includes("/"),
      );
      assert(m.title !== null, `${m.gedcom_xref} has no title`);
    }
  },
);

Deno.test(
  "the large demo tree round-trips through import and export",
  async () => {
    // Import → export → re-import: every table comes back with the same
    // rows (compared on their content, not their generated ids), the
    // primary-photo flag survives, and the exported file re-reads clean.
    const demo = Deno.readTextFileSync(DEMO_TREE_URL);
    const first = await importToTree(demo);
    const gw = new FakeExportGateway({ tree: first });
    const outcome = await runExport({
      jobId: JOB_ID,
      gateway: gw,
      now: FIXED_NOW,
    });
    assertEquals(outcome.status, "completed");

    const reread = readGedcom(gw.onlyUpload);
    assertEquals(reread.warnings, []);
    assertEquals(reread.persons.length, first.persons.length);

    const second = await importToTree(gw.onlyUpload);
    const tables: (keyof TreeRows)[] = [
      "persons",
      "personNames",
      "families",
      "familyChildren",
      "events",
      "facts",
      "notes",
      "citations",
      "mediaLinks",
      "sources",
      "repositories",
      "media",
      "places",
    ];
    for (const table of tables) {
      assertEquals(
        second[table].length,
        first[table].length,
        `${table}: row count changed on the round trip`,
      );
    }

    const personKey = (p: TreeRows["persons"][number]) =>
      [
        p.gedcom_xref,
        p.given_name,
        p.surname,
        p.name_prefix,
        p.name_suffix,
        p.nickname,
        p.sex,
        p.visibility,
        p.user_reference_number,
        p.familysearch_id,
        p.ancestral_file_number,
      ].join("|");
    assertEquals(
      sortedKeys(second.persons, personKey),
      sortedKeys(first.persons, personKey),
    );
    const eventKey = (e: TreeRows["events"][number]) =>
      [e.type, e.type_other, e.date_value_raw, e.value, e.age_text].join("|");
    assertEquals(
      sortedKeys(second.events, eventKey),
      sortedKeys(first.events, eventKey),
    );
    const factKey = (f: TreeRows["facts"][number]) =>
      [f.type, f.type_other, f.visibility, f.value, f.date_value_raw].join(
        "|",
      );
    assertEquals(
      sortedKeys(second.facts, factKey),
      sortedKeys(first.facts, factKey),
    );
    const mediaKey = (m: TreeRows["media"][number]) =>
      [m.gedcom_xref, m.original_filename, m.title, m.date_value_raw].join("|");
    assertEquals(
      sortedKeys(second.media, mediaKey),
      sortedKeys(first.media, mediaKey),
    );
    const primaries = (rows: TreeRows["mediaLinks"]) =>
      rows.filter((l) => l.is_primary).length;
    assertEquals(primaries(second.mediaLinks), primaries(first.mediaLinks));
    assertEquals(primaries(first.mediaLinks), first.persons.length);
  },
);

Deno.test({
  name: "the demo GedZip carries a real file for every media record",
  ignore: !fileExists(DEMO_GEDZIP_URL),
  fn: async () => {
    // The built archive (`pnpm demo:build`): the same GEDCOM text, plus one
    // archive entry per OBJE whose bytes are what the FORM says they are.
    // Then the import engine, fed the archive the way the browser feeds it,
    // attaches every one -- no "not found", no "rejected".
    const bytes = Deno.readFileSync(DEMO_GEDZIP_URL);
    const zip = readGedZip(bytes);
    assertEquals(zip.gedcomText, Deno.readTextFileSync(DEMO_TREE_URL));

    const parsed = readGedcom(zip.gedcomText);
    const index = buildMediaFileIndex(zip.mediaEntryNames);
    const claimed = new Set<string>();
    const entries = readMediaEntries(bytes, new Set(zip.mediaEntryNames));
    const ready = new Map<string, ReadyMediaFile>();
    for (const m of parsed.media) {
      const match = matchMediaFile(m.original_filename, index, claimed);
      assert(
        match !== null,
        `${m.gedcom_xref}: ${m.original_filename} not in archive`,
      );
      const fileBytes = entries.get(match.path);
      assert(fileBytes !== undefined);
      assert(m.mime_type !== null, `${m.gedcom_xref} has no FORM`);
      assertEquals(sniffMimeType(fileBytes), m.mime_type, match.path);
      ready.set(match.path, {
        status: "processed",
        mimeType: m.mime_type,
        originalBytes: fileBytes,
        derivatives: null,
        exif: { hasGps: false, gpsStripped: false, orientationApplied: null },
        warnings: [],
      });
    }
    assertEquals(ready.size, parsed.media.length);

    // The media phase yields after every three-item batch (issue #104) and
    // expects a self-reinvoke; loop the way the edge shell would.
    const gw = new FakeImportGateway(zip.gedcomText, ready);
    let outcome = await runImport({
      jobId: "11111111-0000-4000-8000-000000000001",
      gateway: gw,
      ...NO_YIELD,
    });
    for (let i = 0; i < 1000 && outcome.status === "importing"; i++) {
      outcome = await runImport({
        jobId: "11111111-0000-4000-8000-000000000001",
        gateway: gw,
        ...NO_YIELD,
      });
    }
    assertEquals(outcome.status, "completed");
    assertEquals(
      outcome.stats.warnings.filter((w) => w.startsWith("media ")),
      [],
    );
    const media = gw.rows("media");
    assertEquals(media.length, parsed.media.length);
    for (const row of media) {
      assert(
        typeof row.storage_path_original === "string",
        `${row.gedcom_xref} has no stored original`,
      );
    }
    assertEquals(gw.writtenObjects.size, parsed.media.length);
  },
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
