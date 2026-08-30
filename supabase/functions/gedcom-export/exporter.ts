/**
 * The `gedcom-export` engine (SPEC §7, issue #15) — `manual_gedcom` mode only.
 *
 * Portable TypeScript: no Deno APIs, no database driver. The tree read, the file
 * upload, the signed URL, and the job row all go through {@link ExportGateway},
 * so the engine runs unchanged under the Deno edge runtime (`index.ts`) and the
 * test runner (`exporter.test.ts`).
 *
 * Unlike `gedcom-import` there is no cursor: the whole file is built in one
 * pass. `export_status` has no mid-run state (`pending → running →
 * completed/failed`), and an MVP self-hosted tree fits one edge invocation.
 *
 * The inverse direction — a stored row set back to a {@link GedcomReadResult} —
 * is the new work here. `writeGedcom` (issue #13) then serialises it. Cross-
 * record links are rebuilt as GEDCOM xref strings: a row keeps its imported
 * `gedcom_xref`, an app-created row (no xref) gets a synthesised one.
 */

import { normalizePlaceName, writeGedcom } from "@rootward/gedcom";
import type {
  GedcomReadResult,
  ParsedCitation,
  ParsedEvent,
  ParsedFact,
  ParsedFamily,
  ParsedFamilyChild,
  ParsedMedia,
  ParsedMediaLink,
  ParsedNote,
  ParsedPerson,
  ParsedPersonName,
  ParsedRepository,
  ParsedSource,
  RawGedcomNode,
} from "@rootward/gedcom";
import { CALENDARS, GENEALOGY_DATE_KINDS } from "@rootward/shared";
import type {
  Calendar,
  GenealogyDateFields,
  GenealogyDateKind,
} from "@rootward/shared";

// --- database row shapes ------------------------------------------------
// The subset of columns the gateway selects. snake_case mirrors the migrations.

interface DateColumns {
  readonly date_value_raw: string | null;
  readonly date_kind: string | null;
  readonly date_year1: number | null;
  readonly date_month1: number | null;
  readonly date_day1: number | null;
  readonly date_year2: number | null;
  readonly date_month2: number | null;
  readonly date_day2: number | null;
  readonly date_calendar: string | null;
  readonly date_dual_year: boolean | null;
  readonly date_phrase: string | null;
}

export interface PersonRow {
  readonly id: string;
  readonly gedcom_xref: string | null;
  readonly given_name: string | null;
  readonly surname: string | null;
  readonly name_prefix: string | null;
  readonly name_suffix: string | null;
  readonly nickname: string | null;
  readonly sex: string | null;
  readonly familysearch_id: string | null;
  readonly ancestral_file_number: string | null;
  readonly user_reference_number: string | null;
  readonly raw_gedcom: unknown;
  readonly created_at: string;
}

export interface PersonNameRow {
  readonly id: string;
  readonly person_id: string;
  readonly type: string | null;
  readonly given_name: string | null;
  readonly surname: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
  readonly sort_order: number | null;
  readonly raw_gedcom: unknown;
}

export interface FamilyRow {
  readonly id: string;
  readonly gedcom_xref: string | null;
  readonly partner1_id: string | null;
  readonly partner2_id: string | null;
  readonly partner1_role: string | null;
  readonly partner2_role: string | null;
  readonly relationship_type: string | null;
  readonly raw_gedcom: unknown;
  readonly created_at: string;
}

export interface FamilyChildRow {
  readonly id: string;
  readonly family_id: string;
  readonly person_id: string;
  readonly relation_to_partner1: string | null;
  readonly relation_to_partner2: string | null;
  readonly sort_order: number | null;
  readonly raw_gedcom: unknown;
}

export interface EventRow extends DateColumns {
  readonly id: string;
  readonly owner_type: string;
  readonly person_id: string | null;
  readonly family_id: string | null;
  readonly type: string;
  readonly type_other: string | null;
  readonly value: string | null;
  readonly age_text: string | null;
  readonly place_id: string | null;
  readonly sort_key: string | null;
  readonly raw_gedcom: unknown;
  readonly created_at: string;
}

export interface FactRow extends DateColumns {
  readonly id: string;
  readonly owner_type: string;
  readonly person_id: string | null;
  readonly family_id: string | null;
  readonly type: string;
  readonly type_other: string | null;
  readonly value: string | null;
  readonly place_id: string | null;
  readonly raw_gedcom: unknown;
  readonly created_at: string;
}

export interface NoteRow {
  readonly id: string;
  readonly owner_type: string;
  readonly owner_id: string;
  readonly text: string;
  readonly sort_order: number | null;
  readonly raw_gedcom: unknown;
}

export interface CitationRow extends DateColumns {
  readonly id: string;
  readonly source_id: string;
  readonly owner_type: string;
  readonly owner_id: string;
  readonly page: string | null;
  readonly data_text: string | null;
  readonly quality: number | null;
  readonly raw_gedcom: unknown;
}

export interface MediaLinkRow {
  readonly id: string;
  readonly media_id: string;
  readonly owner_type: string;
  readonly owner_id: string;
  readonly caption: string | null;
  readonly is_primary: boolean;
  readonly sort_order: number | null;
}

export interface SourceRow {
  readonly id: string;
  readonly gedcom_xref: string | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly publication_info: string | null;
  readonly repository_id: string | null;
  readonly source_text: string | null;
  readonly raw_gedcom: unknown;
  readonly created_at: string;
}

export interface RepositoryRow {
  readonly id: string;
  readonly gedcom_xref: string | null;
  readonly name: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly raw_gedcom: unknown;
  readonly created_at: string;
}

export interface MediaRow extends DateColumns {
  readonly id: string;
  readonly gedcom_xref: string | null;
  readonly original_filename: string | null;
  readonly mime_type: string | null;
  readonly title: string | null;
  readonly raw_gedcom: unknown;
  readonly created_at: string;
}

export interface PlaceRow {
  readonly id: string;
  readonly name: string;
  readonly normalized_name: string | null;
}

export interface TreeRows {
  readonly persons: readonly PersonRow[];
  readonly personNames: readonly PersonNameRow[];
  readonly families: readonly FamilyRow[];
  readonly familyChildren: readonly FamilyChildRow[];
  readonly events: readonly EventRow[];
  readonly facts: readonly FactRow[];
  readonly notes: readonly NoteRow[];
  readonly citations: readonly CitationRow[];
  readonly mediaLinks: readonly MediaLinkRow[];
  readonly sources: readonly SourceRow[];
  readonly repositories: readonly RepositoryRow[];
  readonly media: readonly MediaRow[];
  readonly places: readonly PlaceRow[];
}

// --- gateway ----------------------------------------------------------

export type ExportType = "manual_gedcom" | "manual_full" | "scheduled_full";

export type ExportStatus = "pending" | "running" | "completed" | "failed";

export interface ExportJobRow {
  readonly id: string;
  readonly type: ExportType;
  readonly status: ExportStatus;
  readonly storage_path: string | null;
  readonly started_by: string | null;
}

export interface ExportJobPatch {
  status?: ExportStatus;
  storage_path?: string;
  size_bytes?: number;
  error_text?: string;
  completed_at?: string;
}

export interface ExportGateway {
  loadJob(jobId: string): Promise<ExportJobRow>;
  /** Every genealogy table, each read in `id`-ordered pages of 1000. */
  fetchTree(): Promise<TreeRows>;
  /** Write the GEDCOM text to `<bucket>/<key>` (private bucket). */
  uploadGedcom(key: string, text: string): Promise<void>;
  /** A time-limited signed URL for the object just written. */
  signUrl(key: string, expiresInSeconds: number): Promise<string>;
  updateJob(jobId: string, patch: ExportJobPatch): Promise<void>;
}

// --- run -------------------------------------------------------------

/** Object key inside the `exports` bucket. */
export const BUCKET = "exports";
/** Signed-URL lifetime handed back to the caller. */
export const SIGNED_URL_TTL_SECONDS = 3600;

export interface RunExportDeps {
  readonly jobId: string;
  readonly gateway: ExportGateway;
  /** Wall clock, injected so a test gets a fixed transmission date. */
  readonly now: () => number;
}

export interface ExportCounts {
  readonly persons: number;
  readonly families: number;
  readonly sources: number;
  readonly repositories: number;
  readonly media: number;
}

export interface RunExportOutcome {
  readonly status: "completed" | "failed";
  readonly signedUrl: string | null;
  readonly storagePath: string | null;
  readonly sizeBytes: number;
  readonly counts: ExportCounts;
  readonly warnings: readonly string[];
}

const EMPTY_COUNTS: ExportCounts = {
  persons: 0,
  families: 0,
  sources: 0,
  repositories: 0,
  media: 0,
};

/**
 * Run a `manual_gedcom` export. Never throws for a job-level problem (wrong
 * type, an empty result, a failing write): those write `status = 'failed'` +
 * `error_text` and return `{ status: "failed" }`. It can still throw if the
 * gateway itself is unreachable — `index.ts` turns that into a 500.
 */
export async function runExport(
  deps: RunExportDeps,
): Promise<RunExportOutcome> {
  const { jobId, gateway } = deps;

  let job: ExportJobRow;
  try {
    job = await gateway.loadJob(jobId);
  } catch (err) {
    await fail(deps, `load export_job ${jobId}: ${describeError(err)}`);
    return failedOutcome();
  }

  if (job.type !== "manual_gedcom") {
    await fail(
      deps,
      `gedcom-export handles 'manual_gedcom' only, got '${job.type}'`,
    );
    return failedOutcome();
  }
  if (job.status === "completed") {
    return {
      status: "completed",
      signedUrl: null,
      storagePath: job.storage_path,
      sizeBytes: 0,
      counts: EMPTY_COUNTS,
      warnings: [],
    };
  }

  try {
    return await build(deps);
  } catch (err) {
    await fail(deps, describeError(err));
    return failedOutcome();
  }
}

async function build(deps: RunExportDeps): Promise<RunExportOutcome> {
  const { jobId, gateway, now } = deps;

  await gateway.updateJob(jobId, { status: "running" });

  const rows = await gateway.fetchTree();
  const { result, warnings } = buildResult(rows, new Date(now()));
  const text = writeGedcom(result, { version: "5.5.1" });
  const sizeBytes = new TextEncoder().encode(text).length;

  const key = `${jobId}.ged`;
  await gateway.uploadGedcom(key, text);
  const signedUrl = await gateway.signUrl(key, SIGNED_URL_TTL_SECONDS);

  await gateway.updateJob(jobId, {
    status: "completed",
    storage_path: `${BUCKET}/${key}`,
    size_bytes: sizeBytes,
    completed_at: new Date(now()).toISOString(),
  });

  return {
    status: "completed",
    signedUrl,
    storagePath: `${BUCKET}/${key}`,
    sizeBytes,
    counts: {
      persons: result.persons.length,
      families: result.families.length,
      sources: result.sources.length,
      repositories: result.repositories.length,
      media: result.media.length,
    },
    warnings,
  };
}

async function fail(deps: RunExportDeps, message: string): Promise<void> {
  // Postgres error text can echo row values; keep it short.
  try {
    await deps.gateway.updateJob(deps.jobId, {
      status: "failed",
      error_text: message.slice(0, 500),
    });
  } catch {
    // The gateway is the thing that is down — index.ts still returns a 500.
  }
}

function failedOutcome(): RunExportOutcome {
  return {
    status: "failed",
    signedUrl: null,
    storagePath: null,
    sizeBytes: 0,
    counts: EMPTY_COUNTS,
    warnings: [],
  };
}

// --- row set → GedcomReadResult ------------------------------------

const POINTER_RE = /^@[^@\s]+@$/;

/** Allocates GEDCOM xref strings: keeps a valid stored one, else `@<prefix><n>@`
 * past every xref already claimed (across all record types — a GEDCOM xref is
 * unique file-wide). */
class XrefPool {
  private readonly used = new Set<string>();
  /** Per-prefix high-water mark, so `assign` does not rescan from 1 each call. */
  private readonly next = new Map<string, number>();

  reserve(xrefs: Iterable<string | null>): void {
    for (const xref of xrefs) {
      if (xref !== null && POINTER_RE.test(xref)) {
        this.used.add(xref);
      }
    }
  }

  assign(existing: string | null, prefix: string): string {
    if (existing !== null && POINTER_RE.test(existing)) {
      return existing;
    }
    let n = this.next.get(prefix) ?? 1;
    let candidate = `@${prefix}${String(n)}@`;
    while (this.used.has(candidate)) {
      n += 1;
      candidate = `@${prefix}${String(n)}@`;
    }
    this.used.add(candidate);
    this.next.set(prefix, n + 1);
    return candidate;
  }
}

class Warnings {
  private readonly list: string[] = [];

  add(message: string): void {
    if (this.list.length < 200) {
      this.list.push(message);
    }
  }

  all(): string[] {
    return [...this.list];
  }
}

interface BuildOutput {
  readonly result: GedcomReadResult;
  readonly warnings: string[];
}

export function buildResult(rows: TreeRows, transmission: Date): BuildOutput {
  const warnings = new Warnings();

  const persons = sortByCreated(rows.persons);
  const families = sortByCreated(rows.families);
  const sources = sortByCreated(rows.sources);
  const repositories = sortByCreated(rows.repositories);
  const media = sortByCreated(rows.media);

  const pool = new XrefPool();
  pool.reserve(persons.map((r) => r.gedcom_xref));
  pool.reserve(families.map((r) => r.gedcom_xref));
  pool.reserve(sources.map((r) => r.gedcom_xref));
  pool.reserve(repositories.map((r) => r.gedcom_xref));
  pool.reserve(media.map((r) => r.gedcom_xref));

  const personXref = new Map<string, string>();
  for (const row of persons) {
    personXref.set(row.id, pool.assign(row.gedcom_xref, "I"));
  }
  const familyXref = new Map<string, string>();
  for (const row of families) {
    familyXref.set(row.id, pool.assign(row.gedcom_xref, "F"));
  }
  const sourceXref = new Map<string, string>();
  for (const row of sources) {
    sourceXref.set(row.id, pool.assign(row.gedcom_xref, "S"));
  }
  const repositoryXref = new Map<string, string>();
  for (const row of repositories) {
    repositoryXref.set(row.id, pool.assign(row.gedcom_xref, "R"));
  }
  const mediaXref = new Map<string, string>();
  for (const row of media) {
    mediaXref.set(row.id, pool.assign(row.gedcom_xref, "O"));
  }

  const placeName = new Map<string, string>();
  for (const row of rows.places) {
    placeName.set(row.id, row.name);
  }

  const links = new AttachmentIndex(
    rows,
    { sourceXref, mediaXref, placeName },
    warnings,
  );

  const namesByPerson = groupBy(rows.personNames, (r) => r.person_id);
  const eventsByOwner = indexDatedRecords(rows.events);
  const factsByOwner = indexDatedRecords(rows.facts);
  const childrenByFamily = groupBy(rows.familyChildren, (r) => r.family_id);

  const parsedPersons: ParsedPerson[] = persons.map((row) =>
    buildPerson(
      row,
      personXref.get(row.id) ?? "",
      namesByPerson.get(row.id) ?? [],
      (eventsByOwner.person.get(row.id) ?? []).map((e) => buildEvent(e, links)),
      (factsByOwner.person.get(row.id) ?? []).map((f) => buildFact(f, links)),
      links,
    )
  );

  const parsedFamilies: ParsedFamily[] = families.map((row) =>
    buildFamily(
      row,
      familyXref.get(row.id) ?? "",
      { personXref },
      childrenByFamily.get(row.id) ?? [],
      (eventsByOwner.family.get(row.id) ?? []).map((e) => buildEvent(e, links)),
      factsByOwner.family.get(row.id) ?? [],
      links,
      warnings,
    )
  );

  const parsedSources: ParsedSource[] = sources.map((row) => ({
    gedcom_xref: sourceXref.get(row.id) ?? "",
    title: row.title,
    author: row.author,
    publication_info: row.publication_info,
    repository_xref: row.repository_id !== null
      ? (repositoryXref.get(row.repository_id) ?? null)
      : null,
    source_text: row.source_text,
    raw_gedcom: asRawNodes(row.raw_gedcom),
  }));

  const parsedRepositories: ParsedRepository[] = repositories.map((row) => ({
    gedcom_xref: repositoryXref.get(row.id) ?? "",
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    raw_gedcom: asRawNodes(row.raw_gedcom),
  }));

  const parsedMedia: ParsedMedia[] = media.map((row) => ({
    gedcom_xref: mediaXref.get(row.id) ?? "",
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    title: row.title,
    date: dateFields(row),
    raw_gedcom: asRawNodes(row.raw_gedcom),
  }));

  const result: GedcomReadResult = {
    version: "5.5.1",
    header: synthHeader(transmission),
    submitters: [],
    persons: parsedPersons,
    families: parsedFamilies,
    sources: parsedSources,
    repositories: parsedRepositories,
    media: parsedMedia,
    notes: [],
    places: rows.places.map((row) => ({
      name: row.name,
      normalized_name: row.normalized_name ?? normalizePlaceName(row.name),
    })),
    warnings: [],
  };

  return { result, warnings: warnings.all() };
}

// --- attachments (notes / citations / media links) ----------------

interface LinkMaps {
  readonly sourceXref: ReadonlyMap<string, string>;
  readonly mediaXref: ReadonlyMap<string, string>;
  readonly placeName: ReadonlyMap<string, string>;
}

/** Notes, citations, and media links grouped by their `owner_id`. Imported
 * attachments only ever own to person / family / event / fact (the importer
 * writes no other owner type); anything else is dropped with a warning. */
class AttachmentIndex {
  private readonly notes: ReadonlyMap<string, NoteRow[]>;
  private readonly citations: ReadonlyMap<string, CitationRow[]>;
  private readonly mediaLinks: ReadonlyMap<string, MediaLinkRow[]>;

  constructor(
    rows: TreeRows,
    private readonly maps: LinkMaps,
    private readonly warnings: Warnings,
  ) {
    const OWNED = new Set(["person", "family", "event", "fact"]);
    const keep =
      (kind: string) =>
      <T extends { owner_type: string; owner_id: string }>(row: T): boolean => {
        if (OWNED.has(row.owner_type)) {
          return true;
        }
        // The reader/importer never build these owner types, so this only fires
        // for an app-created attachment on a source / media / name row. GEDCOM
        // 5.5.1 could carry it, but writeGedcom places it on person/family/event/
        // fact only — dropped, not a round-trip regression. See DECISIONS.md.
        this.warnings.add(
          `${kind} on ${row.owner_type} ${row.owner_id} dropped — unsupported owner`,
        );
        return false;
      };
    this.notes = groupBy(rows.notes.filter(keep("note")), (r) => r.owner_id);
    this.citations = groupBy(
      rows.citations.filter(keep("citation")),
      (r) => r.owner_id,
    );
    this.mediaLinks = groupBy(
      rows.mediaLinks.filter(keep("media link")),
      (r) => r.owner_id,
    );
  }

  place(placeId: string | null): string | null {
    if (placeId === null) {
      return null;
    }
    return this.maps.placeName.get(placeId) ?? null;
  }

  notesFor(ownerId: string): ParsedNote[] {
    return sortBySortOrder(this.notes.get(ownerId) ?? []).map((row) => ({
      gedcom_xref: null,
      text: row.text,
      note_xref: null,
      raw_gedcom: asRawNodes(row.raw_gedcom),
    }));
  }

  citationsFor(ownerId: string): ParsedCitation[] {
    return (this.citations.get(ownerId) ?? []).map((row) => ({
      source_xref: this.maps.sourceXref.get(row.source_id) ?? null,
      page: row.page,
      data_text: row.data_text,
      date: dateFields(row),
      quality: row.quality,
      notes: [],
      raw_gedcom: asRawNodes(row.raw_gedcom),
    }));
  }

  mediaLinksFor(ownerId: string): ParsedMediaLink[] {
    return sortBySortOrder(this.mediaLinks.get(ownerId) ?? []).map((row) => ({
      media_xref: this.maps.mediaXref.get(row.media_id) ?? null,
      file_path: null,
      title: null,
      caption: row.caption,
      is_primary: row.is_primary,
      raw_gedcom: [],
    }));
  }
}

// --- record builders ---------------------------------------------

function buildPerson(
  row: PersonRow,
  xref: string,
  nameRows: readonly PersonNameRow[],
  events: readonly ParsedEvent[],
  facts: readonly ParsedFact[],
  links: AttachmentIndex,
): ParsedPerson {
  const { primaryNameRaw, rest } = splitPrimaryName(asRawNodes(row.raw_gedcom));

  const additionalNames: ParsedPersonName[] = sortBySortOrder(nameRows).map(
    (name, index): ParsedPersonName => ({
      type: nameType(name.type),
      given_name: name.given_name,
      surname: name.surname,
      prefix: name.prefix,
      suffix: name.suffix,
      nickname: name.nickname,
      sort_order: index,
      raw_gedcom: asRawNodes(name.raw_gedcom),
    }),
  );

  return {
    gedcom_xref: xref,
    given_name: row.given_name,
    surname: row.surname,
    name_prefix: row.name_prefix,
    name_suffix: row.name_suffix,
    nickname: row.nickname,
    primary_name_raw_gedcom: primaryNameRaw,
    sex: sex(row.sex),
    familysearch_id: row.familysearch_id,
    ancestral_file_number: row.ancestral_file_number,
    user_reference_number: row.user_reference_number,
    additional_names: additionalNames,
    events,
    facts,
    notes: links.notesFor(row.id),
    citations: links.citationsFor(row.id),
    media_links: links.mediaLinksFor(row.id),
    raw_gedcom: rest,
  };
}

function buildFamily(
  row: FamilyRow,
  xref: string,
  maps: { personXref: ReadonlyMap<string, string> },
  childRows: readonly FamilyChildRow[],
  events: readonly ParsedEvent[],
  factRows: readonly FactRow[],
  links: AttachmentIndex,
  warnings: Warnings,
): ParsedFamily {
  for (const _fact of factRows) {
    warnings.add(
      `family ${xref}: family-owned fact dropped — GEDCOM has no family attribute in the Rootward model`,
    );
  }

  // `person_xref` can miss when a person row was added or removed between the
  // (non-transactional) per-table reads — skip the child rather than emit a
  // bare `1 CHIL` with no pointer, the same way the importer drops a dangling
  // pointer. `partner*_id` that does not resolve falls back to a null pointer
  // (writeGedcom emits a bare `HUSB` / `WIFE` tag, which is valid).
  const children: ParsedFamilyChild[] = [];
  for (const child of sortBySortOrder(childRows)) {
    const childXref = maps.personXref.get(child.person_id);
    if (childXref === undefined) {
      warnings.add(
        `family ${xref}: child ${child.person_id} skipped — no matching person row`,
      );
      continue;
    }
    children.push({
      person_xref: childXref,
      relation_to_partner1: childRelation(child.relation_to_partner1),
      relation_to_partner2: childRelation(child.relation_to_partner2),
      sort_order: children.length,
      raw_gedcom: asRawNodes(child.raw_gedcom),
    });
  }

  const partnerXref = (partnerId: string | null): string | null => {
    if (partnerId === null) {
      return null;
    }
    const resolved = maps.personXref.get(partnerId);
    if (resolved === undefined) {
      warnings.add(
        `family ${xref}: partner ${partnerId} not found — emitted without a pointer`,
      );
      return null;
    }
    return resolved;
  };

  return {
    gedcom_xref: xref,
    partner1_xref: partnerXref(row.partner1_id),
    partner2_xref: partnerXref(row.partner2_id),
    partner1_role: partnerRole(row.partner1_role),
    partner2_role: partnerRole(row.partner2_role),
    relationship_type: unionType(row.relationship_type),
    children,
    events,
    notes: links.notesFor(row.id),
    citations: links.citationsFor(row.id),
    media_links: links.mediaLinksFor(row.id),
    raw_gedcom: asRawNodes(row.raw_gedcom),
  };
}

function buildEvent(row: EventRow, links: AttachmentIndex): ParsedEvent {
  return {
    type: eventType(row.type),
    type_other: row.type_other,
    date: dateFields(row),
    place_name: links.place(row.place_id),
    value: row.value,
    age_text: row.age_text,
    notes: links.notesFor(row.id),
    citations: links.citationsFor(row.id),
    media_links: links.mediaLinksFor(row.id),
    raw_gedcom: asRawNodes(row.raw_gedcom),
  };
}

function buildFact(row: FactRow, links: AttachmentIndex): ParsedFact {
  return {
    type: factType(row.type),
    type_other: row.type_other,
    date: dateFields(row),
    place_name: links.place(row.place_id),
    value: row.value,
    notes: links.notesFor(row.id),
    citations: links.citationsFor(row.id),
    media_links: links.mediaLinksFor(row.id),
    raw_gedcom: asRawNodes(row.raw_gedcom),
  };
}

// --- header --------------------------------------------------------

/** A minimal valid 5.5.1 `HEAD`. The importer keeps no header, so an export is
 * always a from-scratch transmission. */
function synthHeader(transmission: Date): RawGedcomNode[] {
  return [
    {
      tag: "SOUR",
      value: "Rootward",
      children: [{ tag: "NAME", value: "Rootward" }],
    },
    { tag: "DATE", value: gedcomDate(transmission) },
    {
      tag: "GEDC",
      children: [
        { tag: "VERS", value: "5.5.1" },
        { tag: "FORM", value: "LINEAGE-LINKED" },
      ],
    },
    { tag: "CHAR", value: "UTF-8" },
  ];
}

const GEDCOM_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/** GEDCOM `DAY MON YEAR`, always UTC. */
function gedcomDate(date: Date): string {
  const day = date.getUTCDate();
  const month = GEDCOM_MONTHS[date.getUTCMonth()] ?? "JAN";
  return `${String(day)} ${month} ${String(date.getUTCFullYear())}`;
}

// --- small helpers ------------------------------------------------

interface Created {
  readonly created_at: string;
  readonly id: string;
}

function sortByCreated<T extends Created>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.created_at < b.created_at
      ? -1
      : a.created_at > b.created_at
      ? 1
      : a.id < b.id
      ? -1
      : a.id > b.id
      ? 1
      : 0
  );
}

interface SortOrdered {
  readonly sort_order: number | null;
  readonly id: string;
}

function sortBySortOrder<T extends SortOrdered>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) {
      return ao - bo;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k) ?? [];
    bucket.push(row);
    out.set(k, bucket);
  }
  return out;
}

interface DatedOwnerIndex<T> {
  readonly person: Map<string, T[]>;
  readonly family: Map<string, T[]>;
}

/** Events (or facts) split by owner, ordered by `event.sort_key` (the DB's own
 * timeline — undated rows sort last, matching the trigger's `undated → null`),
 * then `created_at`, then `id`. Facts carry no `sort_key`, so they fall to
 * `created_at`. */
function indexDatedRecords<
  T extends Created & {
    owner_type: string;
    person_id: string | null;
    family_id: string | null;
    sort_key?: string | null;
  },
>(rows: readonly T[]): DatedOwnerIndex<T> {
  const ordered = [...rows].sort((a, b) => {
    // Dated rows first (in timestamp order), then undated, then a stable
    // created_at / id tiebreak.
    const aDated = a.sort_key !== null && a.sort_key !== undefined;
    const bDated = b.sort_key !== null && b.sort_key !== undefined;
    if (aDated !== bDated) {
      return aDated ? -1 : 1;
    }
    if (aDated && bDated && a.sort_key !== b.sort_key) {
      return (a.sort_key ?? "") < (b.sort_key ?? "") ? -1 : 1;
    }
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const person = new Map<string, T[]>();
  const family = new Map<string, T[]>();
  for (const row of ordered) {
    if (row.owner_type === "person" && row.person_id !== null) {
      push(person, row.person_id, row);
    } else if (row.owner_type === "family" && row.family_id !== null) {
      push(family, row.family_id, row);
    }
  }
  return { person, family };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key) ?? [];
  bucket.push(value);
  map.set(key, bucket);
}

/** Pull the synthetic top-level `NAME` node the importer may have added for the
 * primary name's sub-tags back out of `raw_gedcom` (PROGRESS "Next action"). */
function splitPrimaryName(raw: readonly RawGedcomNode[]): {
  primaryNameRaw: RawGedcomNode[];
  rest: RawGedcomNode[];
} {
  const index = raw.findIndex((node) => node.tag === "NAME");
  if (index === -1) {
    return { primaryNameRaw: [], rest: [...raw] };
  }
  const node = raw[index];
  return {
    primaryNameRaw: [...(node?.children ?? [])],
    rest: [...raw.slice(0, index), ...raw.slice(index + 1)],
  };
}

/** Trust the stored jsonb but guard the shape — it is data Rootward wrote. */
function asRawNodes(value: unknown): RawGedcomNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: RawGedcomNode[] = [];
  for (const entry of value) {
    const node = asRawNode(entry);
    if (node !== null) {
      out.push(node);
    }
  }
  return out;
}

function asRawNode(value: unknown): RawGedcomNode | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.tag !== "string") {
    return null;
  }
  const node: {
    tag: string;
    xref?: string;
    value?: string;
    pointer?: string;
    children?: RawGedcomNode[];
  } = { tag: record.tag };
  if (typeof record.xref === "string") {
    node.xref = record.xref;
  }
  if (typeof record.value === "string") {
    node.value = record.value;
  }
  if (typeof record.pointer === "string") {
    node.pointer = record.pointer;
  }
  if (Array.isArray(record.children)) {
    node.children = asRawNodes(record.children);
  }
  return node;
}

function dateFields(row: DateColumns): GenealogyDateFields | null {
  const raw = row.date_value_raw;
  if (raw === null || raw.trim() === "") {
    return null;
  }
  return {
    date_value_raw: raw,
    date_kind: dateKind(row.date_kind),
    date_year1: row.date_year1,
    date_month1: row.date_month1,
    date_day1: row.date_day1,
    date_year2: row.date_year2,
    date_month2: row.date_month2,
    date_day2: row.date_day2,
    date_calendar: calendar(row.date_calendar),
    date_dual_year: row.date_dual_year ?? false,
    date_phrase: row.date_phrase,
  };
}

// --- enum narrowing ---------------------------------------------
// The DB columns are already the enum strings; these guards keep the compiler
// honest and give a total value for a NULL or a hand-edited bad row. Date kinds
// and calendars reuse the `@rootward/shared` unions (single source with the
// migrations); the gedcom `schema_parity.test.ts` guard covers the rest.

const DATE_KINDS: ReadonlySet<string> = new Set(GENEALOGY_DATE_KINDS);

function dateKind(value: string | null): GenealogyDateKind {
  return value !== null && DATE_KINDS.has(value)
    ? (value as GenealogyDateKind)
    : "unknown";
}

const CALENDAR_VALUES: ReadonlySet<string> = new Set(CALENDARS);

function calendar(value: string | null): Calendar {
  return value !== null && CALENDAR_VALUES.has(value)
    ? (value as Calendar)
    : "gregorian";
}

// `person.sex`, `person_name.type`, `family.partner*_role`,
// `family.relationship_type`, `family_child.relation_to_partner*`, `event.type`,
// and `fact.type` are all Postgres enum columns — the value is already a member
// of the matching `@rootward/gedcom` union. `gedcom-import/schema_parity.test.ts`
// asserts every one of those seven unions still covers its migration enum, so a
// bare cast here is safe and keeps this file from hand-copying the sets a fourth
// time (DECISIONS.md single-source rule). A nullable column that the parsed
// shape wants non-null gets a default first.
function sex(value: string | null): ParsedPerson["sex"] {
  return (value ?? "unknown") as ParsedPerson["sex"];
}

function nameType(value: string | null): ParsedPersonName["type"] {
  return (value ?? "also_known_as") as ParsedPersonName["type"];
}

function partnerRole(value: string | null): ParsedFamily["partner1_role"] {
  return value as ParsedFamily["partner1_role"];
}

function unionType(value: string | null): ParsedFamily["relationship_type"] {
  return (value ?? "unknown") as ParsedFamily["relationship_type"];
}

function childRelation(
  value: string | null,
): ParsedFamilyChild["relation_to_partner1"] {
  return value as ParsedFamilyChild["relation_to_partner1"];
}

function eventType(value: string): ParsedEvent["type"] {
  return value as ParsedEvent["type"];
}

function factType(value: string): ParsedFact["type"] {
  return value as ParsedFact["type"];
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
