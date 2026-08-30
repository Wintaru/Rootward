/**
 * `@rootward/gedcom` — a portable GEDCOM reader and writer (5.5.1 and 7.0).
 * Consumed by the Supabase Edge Functions and by the test suite.
 *
 * Pure TypeScript. No Node or Deno built-ins, so the module can move to a
 * C#/iDesign service later (WAYFINDER decision 8).
 */

export { readGedcom } from "./reader";

export {
  buildForest,
  child,
  childPointer,
  childValue,
  children,
  nodeToRaw,
  rawChildrenOnly,
  tokenizeGedcom,
  unhandledChildren,
} from "./nodes";
export type { GedcomLine, GedcomNode, RawGedcomNode } from "./nodes";

export type {
  ChildRelation,
  EventType,
  FactType,
  GedcomReadResult,
  GedcomVersion,
  NameType,
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
  Sex,
  UnionType,
} from "./types";
