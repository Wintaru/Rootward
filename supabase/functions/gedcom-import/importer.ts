/**
 * The `gedcom-import` engine (SPEC §7, issue #14) — `initial` mode only.
 *
 * Portable TypeScript: no Deno APIs, no database driver. Storage reads, table
 * writes, the job row, and the finish notification all go through
 * {@link ImportGateway}, so the engine runs unchanged under the Deno edge
 * runtime (`index.ts`) and under the test runner (`importer.test.ts`).
 *
 * Resumability (decision 8): every row id is `uuidv5(<stable key>, jobId)`, so
 * re-running a batch after a timeout upserts the same rows rather than
 * duplicating them. The only state carried across invocations is
 * `import_job.cursor` — `{ phase, offset }` — plus `processed_records`.
 */

import { normalizePlaceName, readGedcom } from "@rootward/gedcom";
import type {
  GedcomReadResult,
  ParsedCitation,
  ParsedFamily,
  ParsedMediaLink,
  ParsedNote,
  ParsedPerson,
} from "@rootward/gedcom";
import type { GenealogyDateFields } from "@rootward/shared";

import { uuidv5 } from "./uuid.ts";

// --- gateway --------------------------------------------------------------

/** A row destined for a `public` table. Always carries a deterministic `id`. */
export type Row = Record<string, unknown> & { id: string };

export type TableName =
  | "place"
  | "repository"
  | "source"
  | "media"
  | "person"
  | "person_name"
  | "family"
  | "family_child"
  | "event"
  | "fact"
  | "note"
  | "citation"
  | "media_link";

export type ImportMode = "initial" | "replace_all" | "match_update";

export type ImportStatus =
  | "uploaded"
  | "parsing"
  | "importing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ImportJobRow {
  readonly id: string;
  readonly mode: ImportMode;
  readonly status: ImportStatus;
  readonly storage_path: string | null;
  readonly started_by: string | null;
  readonly total_records: number | null;
  readonly processed_records: number;
  readonly cursor: Cursor | null;
  readonly stats: ImportStats;
  readonly completed_at?: string | null;
}

export interface ImportJobPatch {
  status?: ImportStatus;
  total_records?: number;
  processed_records?: number;
  cursor?: Cursor | null;
  stats?: ImportStats;
  error_text?: string;
  completed_at?: string;
}

export type NotificationType = "import_finished" | "import_failed";

export interface ImportGateway {
  loadJob(jobId: string): Promise<ImportJobRow>;
  /** Fetch the uploaded GEDCOM text from the private bucket. */
  downloadGedcom(storagePath: string): Promise<string>;
  /** Upsert on the primary key (`id`). Idempotent by construction. */
  upsertRows(table: TableName, rows: readonly Row[]): Promise<void>;
  updateJob(jobId: string, patch: ImportJobPatch): Promise<void>;
  createNotification(
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

// --- cursor and stats ----------------------------------------------------

export type Phase =
  | "places"
  | "repositories"
  | "sources"
  | "shared_notes"
  | "media"
  | "persons"
  | "families"
  | "done";

const PHASE_ORDER: readonly Phase[] = [
  "places",
  "repositories",
  "sources",
  "shared_notes",
  "media",
  "persons",
  "families",
  "done",
];

export interface Cursor {
  readonly phase: Phase;
  readonly offset: number;
}

export interface ImportStats {
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  warnings: string[];
}

function emptyStats(): ImportStats {
  return { added: 0, updated: 0, skipped: 0, removed: 0, warnings: [] };
}

// --- run ---------------------------------------------------------------

export interface RunImportDeps {
  readonly jobId: string;
  readonly gateway: ImportGateway;
  /** Wall clock, injected so a test can drive the time budget. */
  readonly now: () => number;
  /** Persist the cursor and yield once this many ms have elapsed. */
  readonly budgetMs: number;
  /** Top-level records per checkpoint. */
  readonly batchSize: number;
  /** Called when the engine yields before finishing (self-reinvoke). */
  readonly reinvoke?: () => Promise<void>;
}

export interface RunImportOutcome {
  readonly status: "completed" | "importing" | "failed";
  readonly processedRecords: number;
  readonly totalRecords: number;
  readonly stats: ImportStats;
}

/**
 * Run (or resume) an import. Safe to call repeatedly for the same job: each
 * call picks up from `import_job.cursor` and every write is an upsert.
 *
 * Never throws for an import-level problem (bad mode, parse error, a failing
 * table write): those write `status = 'failed'` + an `import_failed`
 * notification and return `{ status: "failed" }`. It can still throw if the
 * gateway itself is unreachable — `index.ts` turns that into a 500.
 */
export async function runImport(
  deps: RunImportDeps,
): Promise<RunImportOutcome> {
  const { jobId, gateway } = deps;

  let job: ImportJobRow;
  try {
    job = await gateway.loadJob(jobId);
  } catch (err) {
    await fail(deps, null, `load import_job ${jobId}: ${describeError(err)}`);
    return {
      status: "failed",
      processedRecords: 0,
      totalRecords: 0,
      stats: emptyStats(),
    };
  }

  if (job.mode !== "initial") {
    return fail(
      deps,
      job,
      `gedcom-import handles 'initial' mode only, got '${job.mode}'`,
    );
  }
  if (job.status === "completed" || job.status === "cancelled") {
    return {
      status: job.status === "completed" ? "completed" : "failed",
      processedRecords: job.processed_records,
      totalRecords: job.total_records ?? job.processed_records,
      stats: job.stats ?? emptyStats(),
    };
  }
  if (job.storage_path === null || job.storage_path === "") {
    return fail(deps, job, "import_job.storage_path is empty");
  }

  try {
    return await ingest(deps, job);
  } catch (err) {
    return fail(deps, job, describeError(err));
  }
}

async function ingest(
  deps: RunImportDeps,
  job: ImportJobRow,
): Promise<RunImportOutcome> {
  const { jobId, gateway, now, budgetMs } = deps;
  const startedAt = now();

  const text = await gateway.downloadGedcom(job.storage_path as string);
  const parsed = readGedcom(text);

  const stats: ImportStats = {
    ...emptyStats(),
    ...(job.stats ?? {}),
    warnings: [...(job.stats?.warnings ?? []), ...parsed.warnings].slice(
      0,
      200,
    ),
  };

  const total = countRecords(parsed);
  let processed = job.processed_records;
  let cursor: Cursor = job.cursor ?? { phase: "places", offset: 0 };

  if (job.total_records !== total || job.status !== "importing") {
    await gateway.updateJob(jobId, {
      status: "importing",
      total_records: total,
      processed_records: processed,
      cursor,
      stats,
    });
  }

  const noteText = sharedNoteText(parsed);
  const index = buildIndex(parsed);

  while (cursor.phase !== "done") {
    const items = phaseItems(parsed, cursor.phase);

    while (cursor.offset < items.length) {
      const slice = items.slice(cursor.offset, cursor.offset + deps.batchSize);
      const byTable = new Map<TableName, Row[]>();
      for (const item of slice) {
        await buildRows(byTable, {
          jobId,
          phase: cursor.phase,
          item,
          parsed,
          noteText,
          index,
          startedBy: job.started_by,
          stats,
        });
      }
      await flush(gateway, byTable);

      cursor = { phase: cursor.phase, offset: cursor.offset + slice.length };
      processed += slice.length;
      stats.added += countAdded(byTable);
      await gateway.updateJob(jobId, {
        status: "importing",
        processed_records: processed,
        cursor,
        stats,
      });

      if (now() - startedAt > budgetMs && cursor.phase !== "done") {
        await deps.reinvoke?.();
        return {
          status: "importing",
          processedRecords: processed,
          totalRecords: total,
          stats,
        };
      }
    }

    cursor = { phase: nextPhase(cursor.phase), offset: 0 };
  }

  // Guard the finish notification against a second overlapping invocation
  // (a slow self-reinvoke): claim completion only if the job is not already
  // marked done.
  const current = await gateway.loadJob(jobId);
  if (current.status !== "completed") {
    await gateway.updateJob(jobId, {
      status: "completed",
      processed_records: processed,
      cursor,
      stats,
      completed_at: new Date(now()).toISOString(),
    });
    await gateway.createNotification("import_finished", {
      import_job_id: jobId,
      message: `Imported ${String(processed)} records`,
    });
  }

  return {
    status: "completed",
    processedRecords: processed,
    totalRecords: total,
    stats,
  };
}

async function fail(
  deps: RunImportDeps,
  job: ImportJobRow | null,
  message: string,
): Promise<RunImportOutcome> {
  // Postgres error text can echo row values; keep it out of the moderator queue.
  const trimmed = message.slice(0, 500);
  try {
    await deps.gateway.updateJob(deps.jobId, {
      status: "failed",
      error_text: trimmed,
    });
    await deps.gateway.createNotification("import_failed", {
      import_job_id: deps.jobId,
      message: trimmed,
    });
  } catch {
    // The gateway is the thing that is down — index.ts still returns a 500.
  }
  return {
    status: "failed",
    processedRecords: job?.processed_records ?? 0,
    totalRecords: job?.total_records ?? 0,
    stats: job?.stats ?? emptyStats(),
  };
}

// --- phases ------------------------------------------------------------

function nextPhase(phase: Phase): Phase {
  const i = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[i + 1] ?? "done";
}

function phaseItems(
  parsed: GedcomReadResult,
  phase: Phase,
): readonly unknown[] {
  switch (phase) {
    case "places":
      return parsed.places;
    case "repositories":
      return parsed.repositories;
    case "sources":
      return parsed.sources;
    case "shared_notes":
      return parsed.notes.filter((n) => n.gedcom_xref !== null);
    case "media":
      return parsed.media;
    case "persons":
      return parsed.persons;
    case "families":
      return parsed.families;
    case "done":
      return [];
  }
}

function countRecords(parsed: GedcomReadResult): number {
  return (
    parsed.places.length +
    parsed.repositories.length +
    parsed.sources.length +
    parsed.notes.filter((n) => n.gedcom_xref !== null).length +
    parsed.media.length +
    parsed.persons.length +
    parsed.families.length
  );
}

// --- row building ----------------------------------------------------

interface BuildContext {
  readonly jobId: string;
  readonly phase: Phase;
  readonly item: unknown;
  readonly parsed: GedcomReadResult;
  readonly noteText: ReadonlyMap<string, string>;
  readonly index: RecordIndex;
  readonly startedBy: string | null;
  readonly stats: ImportStats;
}

/** The xrefs the file actually defines, per record type — a pointer to
 * anything not in here dangles, so the importer drops the reference with a
 * warning instead of writing an id that fails the foreign key. */
interface RecordIndex {
  readonly persons: ReadonlySet<string>;
  readonly sources: ReadonlySet<string>;
  readonly media: ReadonlySet<string>;
  readonly repositories: ReadonlySet<string>;
}

function buildIndex(parsed: GedcomReadResult): RecordIndex {
  return {
    persons: new Set(parsed.persons.map((p) => p.gedcom_xref)),
    sources: new Set(parsed.sources.map((s) => s.gedcom_xref)),
    media: new Set(parsed.media.map((m) => m.gedcom_xref)),
    repositories: new Set(parsed.repositories.map((r) => r.gedcom_xref)),
  };
}

function warn(ctx: BuildContext, message: string): void {
  if (ctx.stats.warnings.length < 200) {
    ctx.stats.warnings.push(message);
  }
}

function buildRows(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
): Promise<void> {
  switch (ctx.phase) {
    case "places":
      return buildPlace(byTable, ctx);
    case "repositories":
      return buildRepository(byTable, ctx);
    case "sources":
      return buildSource(byTable, ctx);
    case "media":
      return buildMedia(byTable, ctx);
    case "persons":
      return buildPerson(byTable, ctx);
    case "families":
      return buildFamily(byTable, ctx);
    // Shared NOTE records are materialised when a record references them
    // (see buildAttachments); nothing to write for these phases directly.
    case "shared_notes":
    case "done":
      return Promise.resolve();
  }
}

function push(
  byTable: Map<TableName, Row[]>,
  table: TableName,
  row: Row,
): void {
  const rows = byTable.get(table) ?? [];
  rows.push(row);
  byTable.set(table, rows);
}

function id(jobId: string, key: string): Promise<string> {
  return uuidv5(key, jobId);
}

// place ----------------------------------------------------------------

async function buildPlace(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
): Promise<void> {
  const p = ctx.item as GedcomReadResult["places"][number];
  push(byTable, "place", {
    id: await placeId(ctx.jobId, p.name),
    name: p.name,
    normalized_name: p.normalized_name,
  });
}

function placeId(jobId: string, name: string): Promise<string> {
  return id(jobId, `place|${normalizePlaceName(name)}`);
}

// repository / source -------------------------------------------------

async function buildRepository(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
): Promise<void> {
  const r = ctx.item as GedcomReadResult["repositories"][number];
  push(byTable, "repository", {
    id: await id(ctx.jobId, r.gedcom_xref),
    gedcom_xref: r.gedcom_xref,
    name: r.name,
    address: r.address,
    phone: r.phone,
    email: r.email,
    website: r.website,
    raw_gedcom: r.raw_gedcom,
  });
}

async function buildSource(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
): Promise<void> {
  const s = ctx.item as GedcomReadResult["sources"][number];
  push(byTable, "source", {
    id: await id(ctx.jobId, s.gedcom_xref),
    gedcom_xref: s.gedcom_xref,
    title: s.title,
    author: s.author,
    publication_info: s.publication_info,
    repository_id: await resolveRef(
      ctx,
      s.repository_xref,
      ctx.index.repositories,
      `source ${s.gedcom_xref}: repository ${
        String(s.repository_xref)
      } not found`,
    ),
    source_text: s.source_text,
    raw_gedcom: s.raw_gedcom,
  });
}

// media --------------------------------------------------------------

async function buildMedia(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
): Promise<void> {
  const m = ctx.item as GedcomReadResult["media"][number];
  push(byTable, "media", {
    id: await id(ctx.jobId, m.gedcom_xref),
    gedcom_xref: m.gedcom_xref,
    original_filename: m.original_filename,
    mime_type: m.mime_type,
    title: m.title,
    ...dateCols(m.date),
    raw_gedcom: m.raw_gedcom,
  });
}

// person -------------------------------------------------------------

async function buildPerson(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
): Promise<void> {
  const person = ctx.item as ParsedPerson;
  const personId = await id(ctx.jobId, person.gedcom_xref);
  const xref = person.gedcom_xref;

  const raw = [...person.raw_gedcom];
  if (person.primary_name_raw_gedcom.length > 0) {
    // #15 (export) pulls a top-level NAME node back out to re-emit under the
    // primary NAME line; `person_name` is additional names only (SPEC §4.2).
    raw.push({ tag: "NAME", children: person.primary_name_raw_gedcom });
  }

  push(byTable, "person", {
    id: personId,
    gedcom_xref: xref,
    given_name: person.given_name,
    surname: person.surname,
    name_prefix: person.name_prefix,
    name_suffix: person.name_suffix,
    nickname: person.nickname,
    sex: person.sex,
    familysearch_id: person.familysearch_id,
    ancestral_file_number: person.ancestral_file_number,
    user_reference_number: person.user_reference_number,
    raw_gedcom: raw,
    created_by: ctx.startedBy,
    updated_by: ctx.startedBy,
  });

  for (const [i, name] of person.additional_names.entries()) {
    push(byTable, "person_name", {
      id: await id(ctx.jobId, `${xref}|name|${String(i)}`),
      person_id: personId,
      type: name.type,
      given_name: name.given_name,
      surname: name.surname,
      prefix: name.prefix,
      suffix: name.suffix,
      nickname: name.nickname,
      sort_order: name.sort_order,
      raw_gedcom: name.raw_gedcom,
    });
  }

  for (const [i, ev] of person.events.entries()) {
    const eventId = await id(ctx.jobId, `${xref}|event|${String(i)}`);
    push(byTable, "event", {
      id: eventId,
      owner_type: "person",
      person_id: personId,
      family_id: null,
      type: ev.type,
      type_other: ev.type_other,
      ...dateCols(ev.date),
      place_id: await maybePlaceId(ctx, ev.place_name),
      value: ev.value,
      age_text: ev.age_text,
      raw_gedcom: ev.raw_gedcom,
      created_by: ctx.startedBy,
      updated_by: ctx.startedBy,
    });
    await buildAttachments(byTable, ctx, {
      ownerType: "event",
      ownerId: eventId,
      keyPrefix: `${xref}|event|${String(i)}`,
      notes: ev.notes,
      citations: ev.citations,
      mediaLinks: ev.media_links,
    });
  }

  for (const [i, ft] of person.facts.entries()) {
    const factId = await id(ctx.jobId, `${xref}|fact|${String(i)}`);
    push(byTable, "fact", {
      id: factId,
      owner_type: "person",
      person_id: personId,
      family_id: null,
      type: ft.type,
      type_other: ft.type_other,
      value: ft.value,
      ...dateCols(ft.date),
      place_id: await maybePlaceId(ctx, ft.place_name),
      raw_gedcom: ft.raw_gedcom,
      created_by: ctx.startedBy,
      updated_by: ctx.startedBy,
    });
    await buildAttachments(byTable, ctx, {
      ownerType: "fact",
      ownerId: factId,
      keyPrefix: `${xref}|fact|${String(i)}`,
      notes: ft.notes,
      citations: ft.citations,
      mediaLinks: ft.media_links,
    });
  }

  await buildAttachments(byTable, ctx, {
    ownerType: "person",
    ownerId: personId,
    keyPrefix: xref,
    notes: person.notes,
    citations: person.citations,
    mediaLinks: person.media_links,
  });
}

// family -----------------------------------------------------------

async function buildFamily(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
): Promise<void> {
  const family = ctx.item as ParsedFamily;
  const familyId = await id(ctx.jobId, family.gedcom_xref);
  const xref = family.gedcom_xref;

  push(byTable, "family", {
    id: familyId,
    gedcom_xref: xref,
    partner1_id: await maybePersonId(
      ctx,
      family.partner1_xref,
      `family ${xref}: partner ${
        String(family.partner1_xref)
      } has no INDI record`,
    ),
    partner2_id: await maybePersonId(
      ctx,
      family.partner2_xref,
      `family ${xref}: partner ${
        String(family.partner2_xref)
      } has no INDI record`,
    ),
    partner1_role: family.partner1_role,
    partner2_role: family.partner2_role,
    relationship_type: family.relationship_type,
    raw_gedcom: family.raw_gedcom,
  });

  for (const child of family.children) {
    const childPersonId = await maybePersonId(
      ctx,
      child.person_xref,
      `family ${xref}: child ${String(child.person_xref)} has no INDI record`,
    );
    if (childPersonId === null) {
      continue;
    }
    push(byTable, "family_child", {
      id: await id(ctx.jobId, `${xref}|child|${child.person_xref}`),
      family_id: familyId,
      person_id: childPersonId,
      relation_to_partner1: child.relation_to_partner1,
      relation_to_partner2: child.relation_to_partner2,
      sort_order: child.sort_order,
      raw_gedcom: child.raw_gedcom,
    });
  }

  for (const [i, ev] of family.events.entries()) {
    const eventId = await id(ctx.jobId, `${xref}|event|${String(i)}`);
    push(byTable, "event", {
      id: eventId,
      owner_type: "family",
      person_id: null,
      family_id: familyId,
      type: ev.type,
      type_other: ev.type_other,
      ...dateCols(ev.date),
      place_id: await maybePlaceId(ctx, ev.place_name),
      value: ev.value,
      age_text: ev.age_text,
      raw_gedcom: ev.raw_gedcom,
      created_by: ctx.startedBy,
      updated_by: ctx.startedBy,
    });
    await buildAttachments(byTable, ctx, {
      ownerType: "event",
      ownerId: eventId,
      keyPrefix: `${xref}|event|${String(i)}`,
      notes: ev.notes,
      citations: ev.citations,
      mediaLinks: ev.media_links,
    });
  }

  await buildAttachments(byTable, ctx, {
    ownerType: "family",
    ownerId: familyId,
    keyPrefix: xref,
    notes: family.notes,
    citations: family.citations,
    mediaLinks: family.media_links,
  });
}

// notes / citations / media links ---------------------------------

interface AttachmentSpec {
  readonly ownerType: string;
  readonly ownerId: string;
  readonly keyPrefix: string;
  readonly notes: readonly ParsedNote[];
  readonly citations: readonly ParsedCitation[];
  readonly mediaLinks: readonly ParsedMediaLink[];
}

async function buildAttachments(
  byTable: Map<TableName, Row[]>,
  ctx: BuildContext,
  spec: AttachmentSpec,
): Promise<void> {
  for (const [j, note] of spec.notes.entries()) {
    const shared = note.note_xref;
    // A shared NOTE (`@N1@`) is inlined per owner: `note.gedcom_xref` is unique
    // (SPEC §4.5), so one row per xref would keep only the last referrer's link.
    // Every owner keeps its note; the `@N1@` provenance is dropped (re-export
    // re-emits it as an inline NOTE). #15 revisits if a shared record matters.
    const text = shared !== null
      ? (ctx.noteText.get(shared) ?? note.text)
      : note.text;
    if (text === null || text === "") {
      continue;
    }
    if (shared !== null) {
      warn(
        ctx,
        `note ${shared} inlined onto ${spec.ownerType} ${spec.ownerId}`,
      );
    }
    push(byTable, "note", {
      id: await id(ctx.jobId, `${spec.keyPrefix}|note|${String(j)}`),
      gedcom_xref: null,
      owner_type: spec.ownerType,
      owner_id: spec.ownerId,
      text,
      sort_order: j,
      raw_gedcom: note.raw_gedcom,
    });
  }

  for (const [j, cite] of spec.citations.entries()) {
    const known = cite.source_xref !== null &&
      ctx.index.sources.has(cite.source_xref);
    let sourceId: string;
    if (known) {
      sourceId = await id(ctx.jobId, cite.source_xref as string);
    } else {
      // Inline SOUR, or a pointer to a SOUR the file never defines:
      // synthesise a minimal source so the citation survives the FK.
      if (cite.source_xref !== null) {
        warn(
          ctx,
          `citation on ${spec.ownerType} ${spec.ownerId}: source ${cite.source_xref} not found`,
        );
      }
      sourceId = await id(ctx.jobId, `${spec.keyPrefix}|cite-src|${String(j)}`);
      push(byTable, "source", {
        id: sourceId,
        gedcom_xref: null,
        title: cite.data_text,
        author: null,
        publication_info: null,
        repository_id: null,
        source_text: cite.data_text,
        raw_gedcom: cite.raw_gedcom,
      });
    }
    push(byTable, "citation", {
      id: await id(ctx.jobId, `${spec.keyPrefix}|cite|${String(j)}`),
      source_id: sourceId,
      owner_type: spec.ownerType,
      owner_id: spec.ownerId,
      page: cite.page,
      data_text: cite.data_text,
      ...dateCols(cite.date),
      quality: cite.quality,
      raw_gedcom: cite.raw_gedcom,
    });
  }

  let primaryTaken = false;
  for (const [j, link] of spec.mediaLinks.entries()) {
    let mediaId: string;
    if (link.media_xref !== null && ctx.index.media.has(link.media_xref)) {
      mediaId = await id(ctx.jobId, link.media_xref);
    } else if (link.file_path !== null || link.media_xref !== null) {
      // Inline OBJE, or a pointer to an OBJE the file never defines: synthesise
      // a minimal media row so the link survives the FK.
      if (link.media_xref !== null) {
        warn(
          ctx,
          `media link on ${spec.ownerType} ${spec.ownerId}: object ${link.media_xref} not found`,
        );
      }
      mediaId = await id(
        ctx.jobId,
        `${spec.keyPrefix}|inline-media|${String(j)}`,
      );
      push(byTable, "media", {
        id: mediaId,
        gedcom_xref: null,
        original_filename: link.file_path,
        mime_type: null,
        title: link.title,
        ...dateCols(null),
        raw_gedcom: link.raw_gedcom,
      });
    } else {
      continue;
    }
    const isPrimary = link.is_primary && !primaryTaken;
    if (isPrimary) {
      primaryTaken = true;
    }
    push(byTable, "media_link", {
      id: await id(ctx.jobId, `${spec.keyPrefix}|media-link|${String(j)}`),
      media_id: mediaId,
      owner_type: spec.ownerType,
      owner_id: spec.ownerId,
      is_primary: isPrimary,
      sort_order: j,
      caption: link.caption,
    });
  }
}

/** Shared `NOTE` record text, keyed by xref, for reference resolution. */
function sharedNoteText(parsed: GedcomReadResult): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const note of parsed.notes) {
    if (note.gedcom_xref !== null && note.text !== null) {
      map.set(note.gedcom_xref, note.text);
    }
  }
  return map;
}

// --- flush -------------------------------------------------------

/** FK-safe write order for the tables a single batch can touch. */
const FLUSH_ORDER: readonly TableName[] = [
  "place",
  "repository",
  "source",
  "media",
  "person",
  "person_name",
  "family",
  "family_child",
  "event",
  "fact",
  "note",
  "citation",
  "media_link",
];

async function flush(
  gateway: ImportGateway,
  byTable: Map<TableName, Row[]>,
): Promise<void> {
  for (const table of FLUSH_ORDER) {
    const rows = byTable.get(table);
    if (rows !== undefined && rows.length > 0) {
      await gateway.upsertRows(table, dedupeById(rows));
    }
  }
}

/** Last write wins for a repeated id within one batch (e.g. a shared note). */
function dedupeById(rows: readonly Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return [...map.values()];
}

function countAdded(byTable: Map<TableName, Row[]>): number {
  let n = 0;
  for (const rows of byTable.values()) {
    n += rows.length;
  }
  return n;
}

// --- helpers ---------------------------------------------------

/** A place id for an event/fact, or null when the value normalises to nothing
 * (`readGedcom` also skips those, so no `place` row exists to point at). */
function maybePlaceId(
  ctx: BuildContext,
  name: string | null,
): Promise<string | null> {
  if (name === null || normalizePlaceName(name) === "") {
    return Promise.resolve(null);
  }
  return placeId(ctx.jobId, name);
}

/** A person id, or null (with a warning) when the xref does not resolve to a
 * parsed INDI — a dangling `HUSB` / `WIFE` / `CHIL` pointer. */
function maybePersonId(
  ctx: BuildContext,
  xref: string | null,
  context: string,
): Promise<string | null> {
  return resolveRef(ctx, xref, ctx.index.persons, context);
}

/** Resolve an xref to its deterministic id when the file defines that record,
 * else null plus one `stats.warnings` entry. Keeps a stray pointer from
 * failing the whole import on a foreign key. */
function resolveRef(
  ctx: BuildContext,
  xref: string | null,
  known: ReadonlySet<string>,
  context: string,
): Promise<string | null> {
  if (xref === null || xref === "") {
    return Promise.resolve(null);
  }
  if (!known.has(xref)) {
    warn(ctx, context);
    return Promise.resolve(null);
  }
  return id(ctx.jobId, xref);
}

function dateCols(d: GenealogyDateFields | null): Record<string, unknown> {
  if (d === null) {
    return {
      date_value_raw: null,
      date_kind: null,
      date_year1: null,
      date_month1: null,
      date_day1: null,
      date_year2: null,
      date_month2: null,
      date_day2: null,
      date_calendar: "gregorian",
      date_dual_year: null,
      date_phrase: null,
    };
  }
  return {
    date_value_raw: d.date_value_raw,
    date_kind: d.date_kind,
    date_year1: d.date_year1,
    date_month1: d.date_month1,
    date_day1: d.date_day1,
    date_year2: d.date_year2,
    date_month2: d.date_month2,
    date_day2: d.date_day2,
    date_calendar: d.date_calendar,
    date_dual_year: d.date_dual_year,
    date_phrase: d.date_phrase,
  };
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
