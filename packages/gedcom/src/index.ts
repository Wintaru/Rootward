/**
 * `@rootward/gedcom` — a portable GEDCOM reader and writer (5.5.1 and 7.0).
 * Consumed by the Supabase Edge Functions and by the test suite.
 *
 * Pure TypeScript. No Node or Deno built-ins, so the module can move to a
 * C#/iDesign service later (WAYFINDER decision 8).
 */

export { readGedcom, normalizePlaceName } from "./reader.ts";
export { writeGedcom } from "./writer.ts";
export type { GedcomWriteOptions } from "./writer.ts";

export {
  buildMediaFileIndex,
  isZip,
  matchMediaFile,
  readGedZip,
  readMediaEntries,
} from "./gedzip.ts";
export type {
  GedZipContents,
  MatchedMediaFile,
  MediaFileIndex,
} from "./gedzip.ts";

export {
  decodeMediaStorageKey,
  encodeMediaStorageKey,
  GEDCOM_OBJECT_NAME,
  isSafeArchivePath,
  MEDIA_META_OBJECT_NAME,
  MEDIA_SUBPREFIX,
} from "./media-storage-keys.ts";
export type {
  DecodedMediaStorageKey,
  MediaMetaJson,
} from "./media-storage-keys.ts";

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
} from "./nodes.ts";
export type { GedcomLine, GedcomNode, RawGedcomNode } from "./nodes.ts";

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
} from "./types.ts";
