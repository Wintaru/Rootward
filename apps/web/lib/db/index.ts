/**
 * The typed data layer. Every query the app makes against Supabase lives here or
 * in a sibling module — no component builds its own query (WAYFINDER decision
 * 10). View and edit share this layer.
 */

export type { Database, Json } from "./database.types";
export { Constants } from "./database.types";
export * from "./types";
export * from "./genealogy-date";
export * from "./person";
export * from "./person-edit";
export * from "./event-edit";
export * from "./fact-edit";
export * from "./note-edit";
export * from "./source-edit";
export type { RowConflict } from "./conflict";
export * from "./place";
export * from "./import-jobs";
export * from "./invitations";
export * from "./moderation";
export * from "./onboarding";
export * from "./notifications";
export * from "./accounts";
export {
  getAllowSelfSignup,
  getDefaultGenerations,
  getDefaultRootPersonId,
  getTreeSettings,
  updateTreeSettings,
} from "./tree-settings";
export type {
  DefaultGenerations,
  TreeSettings,
  TreeSettingsPatch,
} from "./tree-settings";
export {
  DEFAULT_GENERATIONS_DOWN,
  DEFAULT_GENERATIONS_UP,
  MAX_GENERATIONS,
  clampGenerations,
  expandRelatives,
  getNeighborhood,
} from "./neighborhood";
export { isUuid } from "./uuid";
