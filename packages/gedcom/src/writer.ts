/**
 * Rootward → GEDCOM writer (SPEC §6). Emits GEDCOM 5.5.1 by default, 7.0 behind
 * `options.version`.
 *
 * `writeGedcom` is the inverse of `readGedcom` for round-trip purposes:
 * `readGedcom(writeGedcom(readGedcom(text)))` is structurally equal to
 * `readGedcom(text)` (decision 4). It does not reproduce the source byte for
 * byte — a `DATE` is re-emitted from `date_value_raw`, a `_FREL Natural` comes
 * back as `_FREL biological`, and the `HEAD` block is preserved rather than
 * regenerated.
 *
 * Every mapped field is emitted first, then the record's stored `raw_gedcom`
 * nodes verbatim, so nothing the reader kept is lost.
 *
 * Pure TypeScript — no Node or Deno built-ins (decision 8).
 *
 * Known limitation: a value that starts with `@` but is not a cross-reference
 * pointer (or looks like `@X@ more text`) is emitted unescaped and would
 * mis-tokenize on re-read. GEDCOM 5.5.1 §1 `@@` escaping is out of scope; the
 * reader does not un-escape either, so the two stay consistent.
 */

import type { GenealogyDateFields } from "@rootward/shared";

import {
  CHILD_RELATION_KEYWORD,
  EVENT_TAG_FOR,
  FACT_TAG_FOR,
  NAME_TYPE_KEYWORD,
  SEX_KEYWORD,
} from "./mapping";
import type { RawGedcomNode } from "./nodes";
import type {
  GedcomReadResult,
  GedcomVersion,
  ParsedCitation,
  ParsedEvent,
  ParsedFact,
  ParsedFamily,
  ParsedMedia,
  ParsedMediaLink,
  ParsedNote,
  ParsedPerson,
  ParsedPersonName,
  ParsedRepository,
  ParsedSource,
  PartnerRole,
} from "./types";

export interface GedcomWriteOptions {
  /**
   * GEDCOM version to declare in `HEAD.GEDC.VERS`. Omit to keep whatever the
   * source header already declares (the default, and what the round-trip tests
   * use). When set, only the `VERS` value changes — dates and other syntax are
   * re-emitted verbatim, so this is a declaration, not a conversion.
   */
  readonly version?: Exclude<GedcomVersion, "unknown">;
}

// GEDCOM 5.5.1 caps a physical line at 255 bytes. Split value text at 200 code
// points with `CONC` — short enough that typical multi-byte text stays inside
// 255 bytes (our reader has no line-length cap, so it round-trips either way).
// `CONT` carries an embedded newline.
const MAX_VALUE_CHARS = 200;

/** Serialize a {@link GedcomReadResult} to GEDCOM text. */
export function writeGedcom(
  result: GedcomReadResult,
  options: GedcomWriteOptions = {},
): string {
  const out: string[] = [];

  // A non-empty source header round-trips verbatim (with the version override,
  // when asked). An empty header — a from-scratch write — gets a minimal
  // `GEDC` block so the file is valid; default it to 5.5.1.
  const version =
    result.header.length === 0 ? (options.version ?? "5.5.1") : options.version;
  out.push("0 HEAD");
  for (const node of headerWithVersion(result.header, version)) {
    emitRaw(out, node, 1);
  }

  for (const submitter of result.submitters) {
    emitRaw(out, submitter, 0);
  }

  for (const person of result.persons) {
    emitPerson(out, person);
  }
  for (const family of result.families) {
    emitFamily(out, family);
  }
  for (const source of result.sources) {
    emitSource(out, source);
  }
  for (const repository of result.repositories) {
    emitRepository(out, repository);
  }
  for (const media of result.media) {
    emitMediaRecord(out, media);
  }
  for (const note of result.notes) {
    emitNoteRecord(out, note);
  }

  out.push("0 TRLR");
  return `${out.join("\n")}\n`;
}

// --- header -------------------------------------------------------------

/**
 * Return `header` unchanged when no version override is asked for. Otherwise set
 * the `GEDC.VERS` value, adding a `GEDC` node when the header has none. An empty
 * header with a version defaults to a minimal 5.5.1-shaped `GEDC` block.
 */
function headerWithVersion(
  header: readonly RawGedcomNode[],
  version: string | undefined,
): readonly RawGedcomNode[] {
  if (version === undefined) {
    return header;
  }

  let sawGedc = false;
  const mapped = header.map((node): RawGedcomNode => {
    if (node.tag !== "GEDC") {
      return node;
    }
    sawGedc = true;
    const kids = (node.children ?? []).map((child): RawGedcomNode =>
      child.tag === "VERS" ? { ...child, value: version } : child,
    );
    if (!kids.some((child) => child.tag === "VERS")) {
      kids.push({ tag: "VERS", value: version });
    }
    return { ...node, children: kids };
  });

  if (sawGedc) {
    return mapped;
  }
  const gedc: RawGedcomNode = {
    tag: "GEDC",
    children: [
      { tag: "VERS", value: version },
      { tag: "FORM", value: "LINEAGE-LINKED" },
    ],
  };
  return [gedc, ...mapped];
}

// --- line primitives ---------------------------------------------------

/** `n TAG` with no value. */
function emitTag(out: string[], level: number, tag: string): void {
  out.push(`${level} ${tag}`);
}

/** `n TAG @X@` — a cross-reference pointer line. */
function emitPointer(
  out: string[],
  level: number,
  tag: string,
  pointer: string,
): void {
  out.push(`${level} ${tag} ${pointer}`);
}

/**
 * `n TAG value`, splitting an embedded newline onto a `CONT` line and a value
 * longer than {@link MAX_VALUE_CHARS} onto `CONC` lines. An empty value emits a
 * bare `n TAG`.
 */
function emitValue(
  out: string[],
  level: number,
  tag: string,
  value: string,
): void {
  if (value === "") {
    emitTag(out, level, tag);
    return;
  }
  const segments = value.split("\n");
  segments.forEach((segment, segmentIndex) => {
    const lineTag = segmentIndex === 0 ? tag : "CONT";
    const lineLevel = segmentIndex === 0 ? level : level + 1;
    const codePoints = [...segment];
    if (codePoints.length === 0) {
      emitTag(out, lineLevel, lineTag);
      return;
    }
    for (
      let offset = 0;
      offset < codePoints.length;
      offset += MAX_VALUE_CHARS
    ) {
      const chunk = codePoints.slice(offset, offset + MAX_VALUE_CHARS).join("");
      if (offset === 0) {
        out.push(`${lineLevel} ${lineTag} ${chunk}`);
      } else {
        out.push(`${level + 1} CONC ${chunk}`);
      }
    }
  });
}

/** `n TAG value` only when `value` is a non-empty string. */
function emitOptional(
  out: string[],
  level: number,
  tag: string,
  value: string | null,
): void {
  if (value !== null && value !== "") {
    emitValue(out, level, tag, value);
  }
}

/** A stored `raw_gedcom` node and its whole sub-tree, verbatim. */
function emitRaw(out: string[], node: RawGedcomNode, level: number): void {
  if (node.xref !== undefined) {
    // A level-0 record kept whole (a `SUBM` / `SUBN`): `0 @U1@ SUBM`.
    out.push(`${level} ${node.xref} ${node.tag}`);
  } else if (node.pointer !== undefined) {
    emitPointer(out, level, node.tag, node.pointer);
  } else if (node.value !== undefined) {
    emitValue(out, level, node.tag, node.value);
  } else {
    emitTag(out, level, node.tag);
  }
  for (const child of node.children ?? []) {
    emitRaw(out, child, level + 1);
  }
}

function emitRawList(
  out: string[],
  nodes: readonly RawGedcomNode[],
  level: number,
): void {
  for (const node of nodes) {
    emitRaw(out, node, level);
  }
}

// --- shared sub-records ----------------------------------------------

function emitDate(
  out: string[],
  level: number,
  date: GenealogyDateFields | null,
): void {
  if (date === null || date.date_value_raw.trim() === "") {
    return;
  }
  emitValue(out, level, "DATE", date.date_value_raw);
}

function emitNote(out: string[], level: number, note: ParsedNote): void {
  if (note.note_xref !== null) {
    emitPointer(out, level, "NOTE", note.note_xref);
  } else if (note.text !== null) {
    emitValue(out, level, "NOTE", note.text);
  } else {
    emitTag(out, level, "NOTE");
  }
  emitRawList(out, note.raw_gedcom, level + 1);
}

function emitCitation(
  out: string[],
  level: number,
  citation: ParsedCitation,
): void {
  if (citation.source_xref !== null) {
    emitPointer(out, level, "SOUR", citation.source_xref);
    emitOptional(out, level + 1, "TEXT", citation.data_text);
  } else {
    // Inline source: the text (if any) is the SOUR value itself.
    emitValue(out, level, "SOUR", citation.data_text ?? "");
  }
  emitOptional(out, level + 1, "PAGE", citation.page);
  if (citation.quality !== null) {
    emitValue(out, level + 1, "QUAY", String(citation.quality));
  }
  emitDate(out, level + 1, citation.date);
  for (const note of citation.notes) {
    emitNote(out, level + 1, note);
  }
  emitRawList(out, citation.raw_gedcom, level + 1);
}

function emitMediaLink(
  out: string[],
  level: number,
  link: ParsedMediaLink,
): void {
  if (link.media_xref !== null) {
    emitPointer(out, level, "OBJE", link.media_xref);
  } else {
    emitTag(out, level, "OBJE");
  }
  emitOptional(out, level + 1, "FILE", link.file_path);
  emitOptional(out, level + 1, "TITL", link.title);
  if (link.is_primary) {
    emitValue(out, level + 1, "_PRIM", "Y");
  }
  emitRawList(out, link.raw_gedcom, level + 1);
}

/** DATE / PLACE / notes / citations / media / raw common to event and fact. */
function emitDatedParts(
  out: string[],
  level: number,
  record: ParsedEvent | ParsedFact,
): void {
  emitDate(out, level, record.date);
  emitOptional(out, level, "PLAC", record.place_name);
  for (const note of record.notes) {
    emitNote(out, level, note);
  }
  for (const citation of record.citations) {
    emitCitation(out, level, citation);
  }
  for (const link of record.media_links) {
    emitMediaLink(out, level, link);
  }
  emitRawList(out, record.raw_gedcom, level);
}

function emitEvent(out: string[], level: number, event: ParsedEvent): void {
  const tag = EVENT_TAG_FOR[event.type];
  if (event.value !== null && event.value !== "") {
    emitValue(out, level, tag, event.value);
  } else {
    emitTag(out, level, tag);
  }
  // `EVEN` is the only event tag with no intrinsic type — a mapped tag
  // (`BIRT`, …) carries its own meaning and needs no `TYPE`.
  if (tag === "EVEN" && event.type_other !== null) {
    emitValue(out, level + 1, "TYPE", event.type_other);
  }
  emitOptional(out, level + 1, "AGE", event.age_text);
  emitDatedParts(out, level + 1, event);
}

function emitFact(out: string[], level: number, fact: ParsedFact): void {
  const tag = FACT_TAG_FOR[fact.type];
  if (fact.value !== null && fact.value !== "") {
    emitValue(out, level, tag, fact.value);
  } else {
    emitTag(out, level, tag);
  }
  // `FACT` is the untyped attribute tag. A fact routed to it — `type = "other"`,
  // or a fact type with no standard GEDCOM tag (`height`, `eye_color`, …) —
  // keeps its label on a `TYPE` line so it degrades to `other` / `type_other`
  // on re-read instead of vanishing. A mapped tag (`OCCU`, …) needs no `TYPE`.
  if (tag === "FACT") {
    const label = fact.type === "other" ? fact.type_other : fact.type;
    if (label !== null) {
      emitValue(out, level + 1, "TYPE", label);
    }
  }
  emitDatedParts(out, level + 1, fact);
}

// --- names ------------------------------------------------------------

/** `given /surname/ suffix`, trimmed. Slashes are dropped only when both the
 * surname and the suffix are absent. */
function nameValue(
  given: string | null,
  surname: string | null,
  suffix: string | null,
): string {
  const givenPart = given ?? "";
  if (surname === null && suffix === null) {
    return givenPart;
  }
  const surnamePart = surname ?? "";
  const withSurname = `${givenPart} /${surnamePart}/`;
  const withSuffix =
    suffix !== null && suffix !== "" ? `${withSurname} ${suffix}` : withSurname;
  return withSuffix.trim();
}

function emitPrimaryName(out: string[], person: ParsedPerson): void {
  const value = nameValue(
    person.given_name,
    person.surname,
    person.name_suffix,
  );
  emitValue(out, 1, "NAME", value);
  emitOptional(out, 2, "NPFX", person.name_prefix);
  emitOptional(out, 2, "NICK", person.nickname);
  emitRawList(out, person.primary_name_raw_gedcom, 2);
}

function emitAdditionalName(out: string[], name: ParsedPersonName): void {
  const value = nameValue(name.given_name, name.surname, name.suffix);
  emitValue(out, 1, "NAME", value);
  emitValue(out, 2, "TYPE", NAME_TYPE_KEYWORD[name.type]);
  emitOptional(out, 2, "NPFX", name.prefix);
  emitOptional(out, 2, "NICK", name.nickname);
  emitRawList(out, name.raw_gedcom, 2);
}

// --- level-0 records -------------------------------------------------

function emitRecordStart(out: string[], xref: string, tag: string): void {
  out.push(xref === "" ? `0 ${tag}` : `0 ${xref} ${tag}`);
}

function emitPerson(out: string[], person: ParsedPerson): void {
  emitRecordStart(out, person.gedcom_xref, "INDI");
  emitPrimaryName(out, person);
  for (const name of [...person.additional_names].sort(
    (a, b) => a.sort_order - b.sort_order,
  )) {
    emitAdditionalName(out, name);
  }

  const sex = SEX_KEYWORD[person.sex];
  if (sex !== null) {
    emitValue(out, 1, "SEX", sex);
  }
  emitOptional(out, 1, "REFN", person.user_reference_number);
  emitOptional(out, 1, "AFN", person.ancestral_file_number);
  emitOptional(out, 1, "_FSFTID", person.familysearch_id);

  for (const event of person.events) {
    emitEvent(out, 1, event);
  }
  for (const fact of person.facts) {
    emitFact(out, 1, fact);
  }
  for (const note of person.notes) {
    emitNote(out, 1, note);
  }
  for (const citation of person.citations) {
    emitCitation(out, 1, citation);
  }
  for (const link of person.media_links) {
    emitMediaLink(out, 1, link);
  }
  emitRawList(out, person.raw_gedcom, 1);
}

/** The GEDCOM tag for a partner slot, given its stored role. */
function partnerTag(role: PartnerRole | null, slot: 1 | 2): "HUSB" | "WIFE" {
  if (role === "husband") {
    return "HUSB";
  }
  if (role === "wife") {
    return "WIFE";
  }
  return slot === 1 ? "HUSB" : "WIFE";
}

function emitFamily(out: string[], family: ParsedFamily): void {
  emitRecordStart(out, family.gedcom_xref, "FAM");

  if (family.partner1_xref !== null || family.partner1_role !== null) {
    const tag = partnerTag(family.partner1_role, 1);
    if (family.partner1_xref !== null) {
      emitPointer(out, 1, tag, family.partner1_xref);
    } else {
      emitTag(out, 1, tag);
    }
  }
  if (family.partner2_xref !== null || family.partner2_role !== null) {
    const tag = partnerTag(family.partner2_role, 2);
    if (family.partner2_xref !== null) {
      emitPointer(out, 1, tag, family.partner2_xref);
    } else {
      emitTag(out, 1, tag);
    }
  }

  for (const child of [...family.children].sort(
    (a, b) => a.sort_order - b.sort_order,
  )) {
    if (child.person_xref !== "") {
      emitPointer(out, 1, "CHIL", child.person_xref);
    } else {
      emitTag(out, 1, "CHIL");
    }
    if (child.relation_to_partner1 !== null) {
      emitValue(
        out,
        2,
        "_FREL",
        CHILD_RELATION_KEYWORD[child.relation_to_partner1],
      );
    }
    if (child.relation_to_partner2 !== null) {
      emitValue(
        out,
        2,
        "_MREL",
        CHILD_RELATION_KEYWORD[child.relation_to_partner2],
      );
    }
    emitRawList(out, child.raw_gedcom, 2);
  }

  for (const event of family.events) {
    emitEvent(out, 1, event);
  }
  for (const note of family.notes) {
    emitNote(out, 1, note);
  }
  for (const citation of family.citations) {
    emitCitation(out, 1, citation);
  }
  for (const link of family.media_links) {
    emitMediaLink(out, 1, link);
  }
  emitRawList(out, family.raw_gedcom, 1);
}

function emitSource(out: string[], source: ParsedSource): void {
  emitRecordStart(out, source.gedcom_xref, "SOUR");
  emitOptional(out, 1, "TITL", source.title);
  emitOptional(out, 1, "AUTH", source.author);
  emitOptional(out, 1, "PUBL", source.publication_info);
  if (source.repository_xref !== null) {
    emitPointer(out, 1, "REPO", source.repository_xref);
  }
  emitOptional(out, 1, "TEXT", source.source_text);
  emitRawList(out, source.raw_gedcom, 1);
}

function emitRepository(out: string[], repository: ParsedRepository): void {
  emitRecordStart(out, repository.gedcom_xref, "REPO");
  emitOptional(out, 1, "NAME", repository.name);
  emitOptional(out, 1, "ADDR", repository.address);
  emitOptional(out, 1, "PHON", repository.phone);
  emitOptional(out, 1, "EMAIL", repository.email);
  emitOptional(out, 1, "WWW", repository.website);
  emitRawList(out, repository.raw_gedcom, 1);
}

function emitMediaRecord(out: string[], media: ParsedMedia): void {
  emitRecordStart(out, media.gedcom_xref, "OBJE");
  emitOptional(out, 1, "FILE", media.original_filename);
  emitOptional(out, 1, "FORM", media.mime_type);
  emitOptional(out, 1, "TITL", media.title);
  emitDate(out, 1, media.date);
  emitRawList(out, media.raw_gedcom, 1);
}

function emitNoteRecord(out: string[], note: ParsedNote): void {
  emitRecordStart(out, note.gedcom_xref ?? "", "NOTE");
  if (note.text !== null && note.text !== "") {
    // The record start line already carries the tag; append the text as a
    // CONT block so a leading newline is not needed.
    emitValue(out, 1, "CONT", note.text);
  }
  emitRawList(out, note.raw_gedcom, 1);
}
