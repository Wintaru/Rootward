/**
 * `@rootward/shared` — types shared between the web app and the Supabase Edge
 * Functions, plus the genealogy-date parser and formatter.
 *
 * Pure TypeScript. No Node or Deno built-ins, so a future C# port stays
 * possible (WAYFINDER decision 8).
 */

export {
  CALENDARS,
  GENEALOGY_DATE_KINDS,
  formatGenealogyDate,
  parseGenealogyDate,
} from "./genealogy-date";
export type {
  Calendar,
  GenealogyDateFields,
  GenealogyDateKind,
} from "./genealogy-date";
