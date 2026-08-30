/**
 * GEDCOM → Rootward reader (SPEC §6). Supports GEDCOM 5.5.1 and 7.0.
 *
 * `readGedcom` never throws. Malformed lines and unmapped level-0 records are
 * collected in `result.warnings`. Every sub-tag the model does not represent is
 * kept verbatim on the parent record's `raw_gedcom`, and the `HEAD` block and
 * any `SUBM` / `SUBN` records are kept on `result.header` / `result.submitters`,
 * so an import loses nothing the writer (#13) needs for a stable round trip
 * (decision 4).
 *
 * Pure TypeScript — no Node or Deno built-ins (decision 8). Dates are parsed by
 * `parseGenealogyDate` from `@rootward/shared`; this module does not re-implement
 * date handling.
 */

import { parseGenealogyDate } from "@rootward/shared";
import type { GenealogyDateFields } from "@rootward/shared";

import {
  EVENT_TYPES,
  FACT_TYPES,
  mapChildRelation,
  mapNameType,
  mapSex,
  unionType,
} from "./mapping";
import {
  buildForest,
  child,
  childValue,
  children,
  nodeToRaw,
  rawChildrenOnly,
  tokenizeGedcom,
  unhandledChildren,
} from "./nodes";
import type { GedcomNode, RawGedcomNode } from "./nodes";
import type {
  EventType,
  FactType,
  GedcomReadResult,
  GedcomVersion,
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
  ParsedPlace,
  ParsedRepository,
  ParsedSource,
  PartnerRole,
} from "./types";

const EVENT_TAGS: readonly string[] = Object.keys(EVENT_TYPES);
const FACT_TAGS: readonly string[] = Object.keys(FACT_TYPES);

/** Distinct place strings, deduped on their normalized form, first-seen order. */
class PlaceCollector {
  private readonly seen = new Map<string, ParsedPlace>();

  add(name: string): void {
    const normalized = normalizePlaceName(name);
    if (normalized === "" || this.seen.has(normalized)) {
      return;
    }
    this.seen.set(normalized, { name, normalized_name: normalized });
  }

  list(): ParsedPlace[] {
    return [...this.seen.values()];
  }
}

/** Lowercase, collapse punctuation and runs of whitespace, trim (SPEC §4.2). */
function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Push a children-only raw copy of `node` when it carries extra sub-tags. */
function keepExtraChildren(
  raw: RawGedcomNode[],
  node: GedcomNode | undefined,
): void {
  if (node !== undefined && node.children.length > 0) {
    raw.push(rawChildrenOnly(node));
  }
}

// --- shared sub-tags -------------------------------------------------------

/** An inline `NOTE` value, or a pointer to a shared `NOTE` record. */
function readNote(node: GedcomNode): ParsedNote {
  return {
    gedcom_xref: null,
    text: node.pointer !== null ? null : trimOrNull(node.value),
    note_xref: node.pointer,
    raw_gedcom: node.children.map(nodeToRaw),
  };
}

/** A `SOUR` reference: a pointer with `PAGE` / `QUAY` / `DATA`, or inline text. */
function readCitation(node: GedcomNode): ParsedCitation {
  const raw: RawGedcomNode[] = [];
  const notes: ParsedNote[] = [];
  let page: string | null = null;
  let quality: number | null = null;
  let dataText: string | null = null;
  let date: GenealogyDateFields | null = null;

  for (const sub of node.children) {
    switch (sub.tag) {
      case "PAGE":
        if (page === null) {
          page = trimOrNull(sub.value);
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "QUAY": {
        const parsed = Number.parseInt(sub.value ?? "", 10);
        if (quality === null && parsed >= 0 && parsed <= 3) {
          quality = parsed;
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      }
      case "DATA": {
        const dataTextNode = child(sub, "TEXT");
        if (dataText === null) {
          dataText = trimOrNull(dataTextNode?.value);
        }
        const dataDate = child(sub, "DATE");
        if (date === null && dataDate?.value != null) {
          date = parseGenealogyDate(dataDate.value);
        }
        raw.push(...unhandledChildren(sub, ["TEXT", "DATE"]));
        keepExtraChildren(raw, dataDate);
        break;
      }
      case "TEXT":
        if (dataText === null) {
          dataText = trimOrNull(sub.value);
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "DATE":
        if (date === null && sub.value != null) {
          date = parseGenealogyDate(sub.value);
          keepExtraChildren(raw, sub);
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "NOTE":
        notes.push(readNote(sub));
        break;
      default:
        raw.push(nodeToRaw(sub));
    }
  }

  const inlineText = node.pointer === null ? trimOrNull(node.value) : null;
  return {
    source_xref: node.pointer,
    page,
    data_text: dataText ?? inlineText,
    date,
    quality,
    notes,
    raw_gedcom: raw,
  };
}

/** An `OBJE` reference: a pointer, or an inline `FILE` / `TITL` block. */
function readMediaLink(node: GedcomNode): ParsedMediaLink {
  const raw: RawGedcomNode[] = [];
  let filePath: string | null = null;
  let title: string | null = null;
  let isPrimary = false;

  for (const sub of node.children) {
    switch (sub.tag) {
      case "FILE":
        if (filePath === null) {
          filePath = trimOrNull(sub.value);
          title = title ?? childValue(sub, "TITL");
          raw.push(...unhandledChildren(sub, ["TITL"]));
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "TITL":
        title = trimOrNull(sub.value);
        break;
      case "_PRIM":
      case "_PRIMARY":
        if ((sub.value ?? "").trim().toUpperCase() === "Y") {
          isPrimary = true;
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      default:
        raw.push(nodeToRaw(sub));
    }
  }

  return {
    media_xref: node.pointer,
    file_path: filePath,
    title,
    caption: null,
    is_primary: isPrimary,
    raw_gedcom: raw,
  };
}

interface DatedParts {
  readonly date: GenealogyDateFields | null;
  readonly place_name: string | null;
  readonly type_value: string | null;
  readonly age_text: string | null;
  readonly notes: ParsedNote[];
  readonly citations: ParsedCitation[];
  readonly media_links: ParsedMediaLink[];
  readonly raw_gedcom: RawGedcomNode[];
}

/** Read the sub-tags common to `event` and `fact`; the rest go to `raw`. */
function readDatedParts(node: GedcomNode, places: PlaceCollector): DatedParts {
  const raw: RawGedcomNode[] = [];
  const notes: ParsedNote[] = [];
  const citations: ParsedCitation[] = [];
  const mediaLinks: ParsedMediaLink[] = [];
  let date: GenealogyDateFields | null = null;
  let placeName: string | null = null;
  let typeValue: string | null = null;
  let ageText: string | null = null;

  for (const sub of node.children) {
    switch (sub.tag) {
      case "DATE":
        if (date === null && sub.value != null) {
          date = parseGenealogyDate(sub.value);
          keepExtraChildren(raw, sub);
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "PLAC":
        if (placeName === null) {
          placeName = trimOrNull(sub.value);
          if (placeName !== null) {
            places.add(placeName);
          }
          keepExtraChildren(raw, sub);
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "TYPE":
        if (typeValue === null) {
          typeValue = trimOrNull(sub.value);
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "AGE":
        if (ageText === null) {
          ageText = trimOrNull(sub.value);
        } else {
          raw.push(nodeToRaw(sub));
        }
        break;
      case "NOTE":
        notes.push(readNote(sub));
        break;
      case "SOUR":
        citations.push(readCitation(sub));
        break;
      case "OBJE":
        mediaLinks.push(readMediaLink(sub));
        break;
      default:
        raw.push(nodeToRaw(sub));
    }
  }

  return {
    date,
    place_name: placeName,
    type_value: typeValue,
    age_text: ageText,
    notes,
    citations,
    media_links: mediaLinks,
    raw_gedcom: raw,
  };
}

function readEvent(node: GedcomNode, places: PlaceCollector): ParsedEvent {
  const parts = readDatedParts(node, places);
  const mapped: EventType | undefined = EVENT_TYPES[node.tag];
  const type: EventType = mapped ?? "other";
  const typeOther =
    type === "other"
      ? (parts.type_value ?? (node.tag === "EVEN" ? null : node.tag))
      : null;

  return {
    type,
    type_other: typeOther,
    date: parts.date,
    place_name: parts.place_name,
    value: trimOrNull(node.value),
    age_text: parts.age_text,
    notes: parts.notes,
    citations: parts.citations,
    media_links: parts.media_links,
    raw_gedcom: parts.raw_gedcom,
  };
}

function readFact(node: GedcomNode, places: PlaceCollector): ParsedFact {
  const parts = readDatedParts(node, places);
  const mapped: FactType | undefined = FACT_TYPES[node.tag];
  const type: FactType = mapped ?? "other";
  const typeOther =
    type === "other"
      ? (parts.type_value ?? (node.tag === "FACT" ? null : node.tag))
      : null;

  return {
    type,
    type_other: typeOther,
    date: parts.date,
    place_name: parts.place_name,
    value: trimOrNull(node.value),
    notes: parts.notes,
    citations: parts.citations,
    media_links: parts.media_links,
    raw_gedcom: parts.raw_gedcom,
  };
}

// --- names ---------------------------------------------------------------

interface NameParts {
  readonly given_name: string | null;
  readonly surname: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
  readonly raw_gedcom: RawGedcomNode[];
}

const NAME_SLASHES_RE = /^([^/]*)\/([^/]*)\/(.*)$/;
const NAME_HANDLED = new Set(["GIVN", "SURN", "NPFX", "NSFX", "NICK", "SPFX"]);

/** Parse a `NAME` node: the `given /surname/ suffix` value plus its sub-tags. */
function parseNameNode(node: GedcomNode): NameParts {
  let given: string | null = null;
  let surname: string | null = null;
  let suffix: string | null = null;

  const value = node.value ?? "";
  const slashes = NAME_SLASHES_RE.exec(value);
  if (slashes !== null) {
    given = trimOrNull(slashes[1] ?? null);
    surname = trimOrNull(slashes[2] ?? null);
    suffix = trimOrNull(slashes[3] ?? null);
  } else {
    given = trimOrNull(value);
  }

  const givnSub = childValue(node, "GIVN");
  const surnSub = childValue(node, "SURN");
  const spfxSub = childValue(node, "SPFX");
  const nsfxSub = childValue(node, "NSFX");
  if (givnSub !== null) {
    given = givnSub;
  }
  if (surnSub !== null) {
    surname = surnSub;
  }
  if (nsfxSub !== null) {
    suffix = nsfxSub;
  }
  if (spfxSub !== null && surname !== null) {
    surname = `${spfxSub} ${surname}`;
  }

  // `TYPE` is read by the caller; keep every other sub-tag (and the children of
  // the parsed parts, e.g. a `SOUR` under `GIVN`) in raw.
  const raw: RawGedcomNode[] = [];
  for (const sub of node.children) {
    if (sub.tag === "TYPE") {
      continue;
    }
    if (NAME_HANDLED.has(sub.tag)) {
      keepExtraChildren(raw, sub);
    } else {
      raw.push(nodeToRaw(sub));
    }
  }

  return {
    given_name: given,
    surname,
    prefix: childValue(node, "NPFX"),
    suffix,
    nickname: childValue(node, "NICK"),
    raw_gedcom: raw,
  };
}

// --- records ------------------------------------------------------------

const EMPTY_NAME: NameParts = {
  given_name: null,
  surname: null,
  prefix: null,
  suffix: null,
  nickname: null,
  raw_gedcom: [],
};

// Consumed once each; a repeat still reaches `raw_gedcom`.
const INDI_HANDLED_ONCE: readonly string[] = ["SEX", "REFN", "AFN", "_FSFTID"];
// Consumed on every occurrence.
const INDI_HANDLED_MANY: readonly string[] = [
  "NAME",
  "NOTE",
  "SOUR",
  "OBJE",
  "EVEN",
  "FACT",
  ...EVENT_TAGS,
  ...FACT_TAGS,
];

function readIndi(node: GedcomNode, places: PlaceCollector): ParsedPerson {
  const nameNodes = children(node, "NAME");
  const primaryNode = nameNodes[0];
  // GEDCOM 7.0 recommends a `TYPE` on every `NAME`; a `TYPE BIRTH` on the first
  // name is still the person's primary name, not an extra `person_name` row.
  const primary =
    primaryNode !== undefined ? parseNameNode(primaryNode) : EMPTY_NAME;

  const additionalNames: ParsedPersonName[] = nameNodes
    .slice(1)
    .map((nameNode, index): ParsedPersonName => {
      const parts = parseNameNode(nameNode);
      return {
        type: mapNameType(childValue(nameNode, "TYPE")),
        given_name: parts.given_name,
        surname: parts.surname,
        prefix: parts.prefix,
        suffix: parts.suffix,
        nickname: parts.nickname,
        sort_order: index,
        raw_gedcom: parts.raw_gedcom,
      };
    });

  const events: ParsedEvent[] = [];
  const facts: ParsedFact[] = [];
  const notes: ParsedNote[] = [];
  const citations: ParsedCitation[] = [];
  const mediaLinks: ParsedMediaLink[] = [];

  for (const sub of node.children) {
    if (sub.tag === "NOTE") {
      notes.push(readNote(sub));
    } else if (sub.tag === "SOUR") {
      citations.push(readCitation(sub));
    } else if (sub.tag === "OBJE") {
      mediaLinks.push(readMediaLink(sub));
    } else if (EVENT_TYPES[sub.tag] !== undefined || sub.tag === "EVEN") {
      events.push(readEvent(sub, places));
    } else if (FACT_TYPES[sub.tag] !== undefined || sub.tag === "FACT") {
      facts.push(readFact(sub, places));
    }
  }

  return {
    gedcom_xref: node.xref ?? "",
    given_name: primary.given_name,
    surname: primary.surname,
    name_prefix: primary.prefix,
    name_suffix: primary.suffix,
    nickname: primary.nickname,
    primary_name_raw_gedcom: primary.raw_gedcom,
    sex: mapSex(childValue(node, "SEX")),
    familysearch_id: childValue(node, "_FSFTID"),
    ancestral_file_number: childValue(node, "AFN"),
    user_reference_number: childValue(node, "REFN"),
    additional_names: additionalNames,
    events,
    facts,
    notes,
    citations,
    media_links: mediaLinks,
    raw_gedcom: unhandledChildren(node, INDI_HANDLED_ONCE, INDI_HANDLED_MANY),
  };
}

const FAMILY_CHILD_HANDLED: readonly string[] = ["PEDI", "_FREL", "_MREL"];

function readFamilyChild(
  node: GedcomNode,
  sortOrder: number,
): ParsedFamilyChild {
  const pedigree = mapChildRelation(childValue(node, "PEDI"));
  const relToPartner1 = mapChildRelation(childValue(node, "_FREL")) ?? pedigree;
  const relToPartner2 = mapChildRelation(childValue(node, "_MREL")) ?? pedigree;

  // A `CHIL` can carry `NOTE` / `SOUR` (SPEC §4.5, §4.3 allow a `family_child`
  // owner); the #14 importer wires those from raw. Only the relationship tags
  // are mapped to columns here.
  return {
    person_xref: node.pointer ?? "",
    relation_to_partner1: relToPartner1,
    relation_to_partner2: relToPartner2,
    sort_order: sortOrder,
    raw_gedcom: unhandledChildren(node, [], FAMILY_CHILD_HANDLED),
  };
}

const FAM_HANDLED_MANY: readonly string[] = [
  "HUSB",
  "WIFE",
  "CHIL",
  "NOTE",
  "SOUR",
  "OBJE",
  "EVEN",
  ...EVENT_TAGS,
];

function readFam(node: GedcomNode, places: PlaceCollector): ParsedFamily {
  let partner1Xref: string | null = null;
  let partner2Xref: string | null = null;
  let partner1Role: PartnerRole | null = null;
  let partner2Role: PartnerRole | null = null;
  const childRows: ParsedFamilyChild[] = [];
  const events: ParsedEvent[] = [];
  const notes: ParsedNote[] = [];
  const citations: ParsedCitation[] = [];
  const mediaLinks: ParsedMediaLink[] = [];
  const raw: RawGedcomNode[] = [];
  let hasMarriage = false;

  const assignPartner = (xref: string | null, role: PartnerRole): boolean => {
    if (partner1Xref === null) {
      partner1Xref = xref;
      partner1Role = role;
      return true;
    }
    if (partner2Xref === null) {
      partner2Xref = xref;
      partner2Role = role;
      return true;
    }
    return false;
  };

  for (const sub of node.children) {
    if (sub.tag === "HUSB" || sub.tag === "WIFE") {
      const role: PartnerRole = sub.tag === "HUSB" ? "husband" : "wife";
      if (!assignPartner(sub.pointer, role)) {
        raw.push(nodeToRaw(sub));
      }
    } else if (sub.tag === "CHIL") {
      childRows.push(readFamilyChild(sub, childRows.length));
    } else if (sub.tag === "NOTE") {
      notes.push(readNote(sub));
    } else if (sub.tag === "SOUR") {
      citations.push(readCitation(sub));
    } else if (sub.tag === "OBJE") {
      mediaLinks.push(readMediaLink(sub));
    } else if (EVENT_TYPES[sub.tag] !== undefined || sub.tag === "EVEN") {
      if (sub.tag === "MARR") {
        hasMarriage = true;
      }
      events.push(readEvent(sub, places));
    }
    // Family attributes (`NCHI`, `NMR`, …) fall through to `raw_gedcom` below.
    // `fact.owner_type` allows `family`, but the MVP edit view has no family
    // Facts section (SPEC §10 item 29), so they are preserved, not modelled.
  }

  return {
    gedcom_xref: node.xref ?? "",
    partner1_xref: partner1Xref,
    partner2_xref: partner2Xref,
    partner1_role: partner1Role,
    partner2_role: partner2Role,
    relationship_type: unionType(hasMarriage),
    children: childRows,
    events,
    notes,
    citations,
    media_links: mediaLinks,
    raw_gedcom: [...raw, ...unhandledChildren(node, [], FAM_HANDLED_MANY)],
  };
}

const SOURCE_HANDLED_ONCE: readonly string[] = [
  "TITL",
  "AUTH",
  "PUBL",
  "TEXT",
  "REPO",
];

function readSource(node: GedcomNode): ParsedSource {
  const raw = unhandledChildren(node, SOURCE_HANDLED_ONCE);
  for (const tag of SOURCE_HANDLED_ONCE) {
    keepExtraChildren(raw, child(node, tag));
  }

  return {
    gedcom_xref: node.xref ?? "",
    title: childValue(node, "TITL"),
    author: childValue(node, "AUTH"),
    publication_info: childValue(node, "PUBL"),
    repository_xref: child(node, "REPO")?.pointer ?? null,
    source_text: childValue(node, "TEXT"),
    raw_gedcom: raw,
  };
}

const REPO_HANDLED_ONCE: readonly string[] = [
  "NAME",
  "ADDR",
  "PHON",
  "EMAIL",
  "WWW",
];

function readRepository(node: GedcomNode): ParsedRepository {
  const raw = unhandledChildren(node, REPO_HANDLED_ONCE);
  keepExtraChildren(raw, child(node, "ADDR"));

  return {
    gedcom_xref: node.xref ?? "",
    name: childValue(node, "NAME"),
    address: childValue(node, "ADDR"),
    phone: childValue(node, "PHON"),
    email: childValue(node, "EMAIL"),
    website: childValue(node, "WWW"),
    raw_gedcom: raw,
  };
}

function readMediaRecord(node: GedcomNode): ParsedMedia {
  const fileNodes = children(node, "FILE");
  const firstFile = fileNodes[0];
  const formValue =
    childValue(node, "FORM") ??
    (firstFile !== undefined ? childValue(firstFile, "FORM") : null);
  const dateNode = child(node, "DATE");

  // First `FILE` (with its `FORM` / `TITL`) is mapped; a 7.0 file can repeat, so
  // any further `FILE` node is kept whole in raw.
  const raw = unhandledChildren(node, ["TITL", "FORM", "DATE", "FILE"]);
  if (firstFile !== undefined) {
    raw.push(...unhandledChildren(firstFile, ["FORM", "TITL"]));
  }
  keepExtraChildren(raw, dateNode);

  return {
    gedcom_xref: node.xref ?? "",
    original_filename: trimOrNull(firstFile?.value),
    mime_type: formValue,
    title:
      childValue(node, "TITL") ??
      (firstFile !== undefined ? childValue(firstFile, "TITL") : null),
    date: dateNode?.value != null ? parseGenealogyDate(dateNode.value) : null,
    raw_gedcom: raw,
  };
}

function readNoteRecord(node: GedcomNode): ParsedNote {
  return {
    gedcom_xref: node.xref,
    text: trimOrNull(node.value),
    note_xref: null,
    raw_gedcom: node.children.map(nodeToRaw),
  };
}

function detectVersion(head: GedcomNode): GedcomVersion {
  const gedc = child(head, "GEDC");
  const vers = gedc !== undefined ? childValue(gedc, "VERS") : null;
  if (vers === null) {
    return "unknown";
  }
  if (vers.startsWith("7")) {
    return "7.0";
  }
  // `5.5` and `5.5.1` are close enough that the reader treats them alike.
  if (vers.startsWith("5.5")) {
    return "5.5.1";
  }
  return "unknown";
}

// --- entry point -------------------------------------------------------

/** Read a GEDCOM 5.5.1 or 7.0 document into the Rootward shape. Never throws. */
export function readGedcom(text: string): GedcomReadResult {
  const warnings: string[] = [];
  const lines = tokenizeGedcom(text, warnings);
  const forest = buildForest(lines, warnings);
  const places = new PlaceCollector();

  const persons: ParsedPerson[] = [];
  const families: ParsedFamily[] = [];
  const sources: ParsedSource[] = [];
  const repositories: ParsedRepository[] = [];
  const media: ParsedMedia[] = [];
  const notes: ParsedNote[] = [];
  let header: RawGedcomNode[] = [];
  const submitters: RawGedcomNode[] = [];
  let version: GedcomVersion = "unknown";

  for (const record of forest) {
    switch (record.tag) {
      case "HEAD":
        version = detectVersion(record);
        header = record.children.map(nodeToRaw);
        break;
      case "TRLR":
        break;
      case "SUBM":
      case "SUBN":
        submitters.push(nodeToRaw(record));
        break;
      case "INDI":
        persons.push(readIndi(record, places));
        break;
      case "FAM":
        families.push(readFam(record, places));
        break;
      case "SOUR":
        sources.push(readSource(record));
        break;
      case "REPO":
        repositories.push(readRepository(record));
        break;
      case "OBJE":
        media.push(readMediaRecord(record));
        break;
      case "NOTE":
        notes.push(readNoteRecord(record));
        break;
      default:
        warnings.push(
          `Unmapped level-0 record ${record.xref ?? ""} ${record.tag}`.trim(),
        );
    }
  }

  return {
    version,
    header,
    submitters,
    persons,
    families,
    sources,
    repositories,
    media,
    notes,
    places: places.list(),
    warnings,
  };
}
