/**
 * GEDCOM tag → Rootward enum lookup tables (SPEC §6).
 *
 * Only the tags listed here are mapped to a typed `event` / `fact` / name / …
 * row. Every other sub-tag falls through to the parent record's `raw_gedcom`,
 * so nothing is lost on a round trip (decision 4).
 */

import type {
  ChildRelation,
  EventType,
  FactType,
  NameType,
  Sex,
  UnionType,
} from "./types";

/** GEDCOM individual / family event tags → `event_type`. */
export const EVENT_TYPES: Readonly<Record<string, EventType>> = {
  BIRT: "birth",
  DEAT: "death",
  MARR: "marriage",
  DIV: "divorce",
  BURI: "burial",
  CREM: "cremation",
  CHR: "christening",
  CHRA: "christening",
  BAPM: "baptism",
  BAPL: "baptism",
  BARM: "bar_mitzvah",
  BASM: "bat_mitzvah",
  CONF: "confirmation",
  FCOM: "first_communion",
  ADOP: "adoption",
  GRAD: "graduation",
  IMMI: "immigration",
  EMIG: "emigration",
  NATU: "naturalization",
  CENS: "census",
  RESI: "residence",
  RETI: "retirement",
  WILL: "will",
  PROB: "probate",
  ENGA: "engagement",
  MARB: "marriage_banns",
  ANUL: "annulment",
};

/** GEDCOM individual attribute tags → `fact_type` (SPEC §6). */
export const FACT_TYPES: Readonly<Record<string, FactType>> = {
  DSCR: "physical_description",
  OCCU: "occupation",
  RELI: "religion",
  NATI: "nationality",
  SSN: "ssn",
  EDUC: "education",
  CAST: "caste",
  TITL: "title_of_nobility",
  NOBL: "title_of_nobility",
  PROP: "property",
  NCHI: "number_of_children",
  NMR: "number_of_marriages",
  IDNO: "national_id",
};

/** GEDCOM `SEX` payload → `sex`. */
export function mapSex(value: string | null): Sex {
  switch ((value ?? "").trim().toUpperCase()) {
    case "M":
      return "male";
    case "F":
      return "female";
    case "X":
    case "INTERSEX":
      return "other";
    default:
      return "unknown";
  }
}

/** GEDCOM `TYPE` under a `NAME` → `name_type`. Unknown → `also_known_as`. */
export function mapNameType(value: string | null): NameType {
  switch ((value ?? "").trim().toLowerCase()) {
    case "birth":
      return "birth";
    case "married":
    case "marriage":
      return "married";
    case "maiden":
      return "maiden";
    case "immigrant":
      return "immigrant";
    case "religious":
      return "religious";
    case "nickname":
      return "nickname";
    default:
      return "also_known_as";
  }
}

/** GEDCOM `PEDI` / `_FREL` / `_MREL` payload → `child_relation`. */
export function mapChildRelation(value: string | null): ChildRelation | null {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "") {
    return null;
  }
  switch (text) {
    case "birth":
    case "natural":
    case "biological":
      return "biological";
    case "adopted":
    case "adoptive":
      return "adopted";
    case "step":
      return "step";
    case "foster":
      return "foster";
    case "guardian":
      return "guardian";
    case "sealing":
    case "sealed":
      return "sealed";
    default:
      return "unknown";
  }
}

/** GEDCOM `FAM` event mix → `union_type`. `MARR` present → `married`. */
export function unionType(hasMarriage: boolean): UnionType {
  return hasMarriage ? "married" : "unknown";
}

// --- reverse tables (writer, SPEC §6) -----------------------------------
// One GEDCOM tag / keyword per Rootward enum value, for `writeGedcom`. Each is
// `satisfies Record<Enum, …>` so a new enum value fails typecheck until it is
// mapped. A value the reader can never produce (event `occupation`, name type
// `other`, the body-measurement facts) still maps best-effort so the record is
// total; the writer routes `other` through `EVEN` / `FACT` + a `TYPE` line.

/** `event_type` → the GEDCOM event tag `writeGedcom` emits. */
export const EVENT_TAG_FOR = {
  birth: "BIRT",
  death: "DEAT",
  marriage: "MARR",
  divorce: "DIV",
  burial: "BURI",
  cremation: "CREM",
  christening: "CHR",
  baptism: "BAPM",
  bar_mitzvah: "BARM",
  bat_mitzvah: "BASM",
  confirmation: "CONF",
  first_communion: "FCOM",
  adoption: "ADOP",
  graduation: "GRAD",
  immigration: "IMMI",
  emigration: "EMIG",
  naturalization: "NATU",
  census: "CENS",
  residence: "RESI",
  occupation: "OCCU",
  retirement: "RETI",
  will: "WILL",
  probate: "PROB",
  engagement: "ENGA",
  marriage_banns: "MARB",
  annulment: "ANUL",
  other: "EVEN",
} as const satisfies Record<EventType, string>;

/** `fact_type` → the GEDCOM attribute tag `writeGedcom` emits. */
export const FACT_TAG_FOR = {
  eye_color: "FACT",
  hair_color: "FACT",
  height: "FACT",
  weight: "FACT",
  physical_description: "DSCR",
  ethnic_origin: "FACT",
  skin_color: "FACT",
  religion: "RELI",
  nationality: "NATI",
  occupation: "OCCU",
  education: "EDUC",
  caste: "CAST",
  title_of_nobility: "TITL",
  number_of_children: "NCHI",
  number_of_marriages: "NMR",
  property: "PROP",
  national_id: "IDNO",
  ssn: "SSN",
  medical: "FACT",
  other: "FACT",
} as const satisfies Record<FactType, string>;

/** `name_type` → the GEDCOM `NAME.TYPE` keyword `writeGedcom` emits. */
export const NAME_TYPE_KEYWORD = {
  birth: "birth",
  married: "married",
  maiden: "maiden",
  also_known_as: "also_known_as",
  nickname: "nickname",
  religious: "religious",
  immigrant: "immigrant",
  other: "other",
} as const satisfies Record<NameType, string>;

/** `sex` → the GEDCOM `SEX` payload, or `null` to omit the line. */
export const SEX_KEYWORD = {
  male: "M",
  female: "F",
  other: "X",
  unknown: null,
} as const satisfies Record<Sex, string | null>;

/** `child_relation` → the GEDCOM `_FREL` / `_MREL` payload `writeGedcom` emits. */
export const CHILD_RELATION_KEYWORD = {
  biological: "biological",
  adopted: "adopted",
  step: "step",
  foster: "foster",
  guardian: "guardian",
  sealed: "sealed",
  unknown: "unknown",
} as const satisfies Record<ChildRelation, string>;
