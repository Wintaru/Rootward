/**
 * The Rootward-shape output of {@link readGedcom}.
 *
 * These records mirror the Postgres tables in `supabase/migrations` but stay
 * DB-agnostic: cross-record links are GEDCOM xref strings (`@I1@`), not UUIDs.
 * The `gedcom-import` edge function (#14) assigns ids and resolves the xrefs.
 * Enum-valued fields already hold the Postgres enum string.
 */

import type { GenealogyDateFields } from "@rootward/shared";

import type { RawGedcomNode } from "./nodes";

export type GedcomVersion = "5.5.1" | "7.0" | "unknown";

export type Sex = "male" | "female" | "unknown" | "other";

export type NameType =
  | "birth"
  | "married"
  | "maiden"
  | "also_known_as"
  | "nickname"
  | "religious"
  | "immigrant"
  | "other";

export type PartnerRole = "husband" | "wife" | "partner" | "unknown";

export type UnionType = "married" | "partnership" | "civil_union" | "unknown";

export type ChildRelation =
  | "biological"
  | "adopted"
  | "step"
  | "foster"
  | "guardian"
  | "sealed"
  | "unknown";

export type EventType =
  | "birth"
  | "death"
  | "marriage"
  | "divorce"
  | "burial"
  | "cremation"
  | "christening"
  | "baptism"
  | "bar_mitzvah"
  | "bat_mitzvah"
  | "confirmation"
  | "first_communion"
  | "adoption"
  | "graduation"
  | "immigration"
  | "emigration"
  | "naturalization"
  | "census"
  | "residence"
  | "occupation"
  | "retirement"
  | "will"
  | "probate"
  | "engagement"
  | "marriage_banns"
  | "annulment"
  | "other";

export type FactType =
  | "eye_color"
  | "hair_color"
  | "height"
  | "weight"
  | "physical_description"
  | "ethnic_origin"
  | "skin_color"
  | "religion"
  | "nationality"
  | "occupation"
  | "education"
  | "caste"
  | "title_of_nobility"
  | "number_of_children"
  | "number_of_marriages"
  | "property"
  | "national_id"
  | "ssn"
  | "medical"
  | "other";

/** An inline or shared `NOTE` attached to a record. */
export interface ParsedNote {
  /** Set for a shared `NOTE` record (`@N1@`), else `null`. */
  readonly gedcom_xref: string | null;
  /** Text of an inline note, or the resolved text of a shared record. */
  readonly text: string | null;
  /** Pointer to a shared `NOTE` record when the note is a reference. */
  readonly note_xref: string | null;
  readonly raw_gedcom: readonly RawGedcomNode[];
}

/** A `SOUR` reference (pointer or inline) attached to a record. */
export interface ParsedCitation {
  /** Pointer to the `source` record (`@S1@`), or `null` for an inline source. */
  readonly source_xref: string | null;
  readonly page: string | null;
  readonly data_text: string | null;
  readonly date: GenealogyDateFields | null;
  /** GEDCOM `QUAY`, 0–3, or `null`. */
  readonly quality: number | null;
  readonly notes: readonly ParsedNote[];
  readonly raw_gedcom: readonly RawGedcomNode[];
}

/** An `OBJE` reference attached to a record. */
export interface ParsedMediaLink {
  /** Pointer to a `media` record (`@O1@`), or `null` for an inline `OBJE`. */
  readonly media_xref: string | null;
  /** File path of an inline `OBJE`, else `null`. */
  readonly file_path: string | null;
  readonly title: string | null;
  readonly caption: string | null;
  /** GEDCOM `_PRIM Y` — the owner's main photo. */
  readonly is_primary: boolean;
  readonly raw_gedcom: readonly RawGedcomNode[];
}

/** Base for an `event` or a `fact` row (both embed the §4.1 date set). */
interface DatedRecord {
  readonly date: GenealogyDateFields | null;
  readonly place_name: string | null;
  readonly value: string | null;
  readonly notes: readonly ParsedNote[];
  readonly citations: readonly ParsedCitation[];
  readonly media_links: readonly ParsedMediaLink[];
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedEvent extends DatedRecord {
  readonly type: EventType;
  /** Label when `type === "other"` (GEDCOM `EVEN` / `TYPE`). */
  readonly type_other: string | null;
  /** GEDCOM `AGE`. */
  readonly age_text: string | null;
}

export interface ParsedFact extends DatedRecord {
  readonly type: FactType;
  readonly type_other: string | null;
}

/** An additional `person_name` row (the primary name lives on `person`). */
export interface ParsedPersonName {
  readonly type: NameType;
  readonly given_name: string | null;
  readonly surname: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
  readonly sort_order: number;
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedPerson {
  readonly gedcom_xref: string;
  readonly given_name: string | null;
  readonly surname: string | null;
  readonly name_prefix: string | null;
  readonly name_suffix: string | null;
  readonly nickname: string | null;
  readonly sex: Sex;
  readonly familysearch_id: string | null;
  readonly ancestral_file_number: string | null;
  readonly user_reference_number: string | null;
  readonly additional_names: readonly ParsedPersonName[];
  readonly events: readonly ParsedEvent[];
  readonly facts: readonly ParsedFact[];
  readonly notes: readonly ParsedNote[];
  readonly citations: readonly ParsedCitation[];
  readonly media_links: readonly ParsedMediaLink[];
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedFamilyChild {
  readonly person_xref: string;
  readonly relation_to_partner1: ChildRelation | null;
  readonly relation_to_partner2: ChildRelation | null;
  readonly sort_order: number;
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedFamily {
  readonly gedcom_xref: string;
  readonly partner1_xref: string | null;
  readonly partner2_xref: string | null;
  readonly partner1_role: PartnerRole | null;
  readonly partner2_role: PartnerRole | null;
  readonly relationship_type: UnionType;
  readonly children: readonly ParsedFamilyChild[];
  readonly events: readonly ParsedEvent[];
  readonly notes: readonly ParsedNote[];
  readonly citations: readonly ParsedCitation[];
  readonly media_links: readonly ParsedMediaLink[];
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedRepository {
  readonly gedcom_xref: string;
  readonly name: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedSource {
  readonly gedcom_xref: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly publication_info: string | null;
  readonly repository_xref: string | null;
  readonly source_text: string | null;
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedMedia {
  readonly gedcom_xref: string;
  readonly original_filename: string | null;
  readonly mime_type: string | null;
  readonly title: string | null;
  readonly date: GenealogyDateFields | null;
  readonly raw_gedcom: readonly RawGedcomNode[];
}

export interface ParsedPlace {
  readonly name: string;
  readonly normalized_name: string;
}

export interface GedcomReadResult {
  readonly version: GedcomVersion;
  /** The `HEAD` block's sub-tags, verbatim — the writer (#13) regenerates its
   * own `HEAD` but may carry `COPR` / `LANG` / `NOTE` forward. */
  readonly header: readonly RawGedcomNode[];
  /** `SUBM` / `SUBN` records, verbatim. Rootward has no submitter table. */
  readonly submitters: readonly RawGedcomNode[];
  readonly persons: readonly ParsedPerson[];
  readonly families: readonly ParsedFamily[];
  readonly sources: readonly ParsedSource[];
  readonly repositories: readonly ParsedRepository[];
  readonly media: readonly ParsedMedia[];
  /** Shared `NOTE` records only; inline notes hang off their owner. */
  readonly notes: readonly ParsedNote[];
  /** Distinct places, deduped on `normalized_name`, in first-seen order. */
  readonly places: readonly ParsedPlace[];
  /** Recoverable problems: malformed lines, unmapped level-0 records. */
  readonly warnings: readonly string[];
}
