/**
 * The typed data layer. Every query the app makes against Supabase lives here or
 * in a sibling module — no component builds its own query (WAYFINDER decision
 * 10). View and edit share this layer.
 */

export type { Database, Json } from "./database.types";
export { Constants } from "./database.types";
export * from "./types";
export * from "./import-jobs";
export {
  DEFAULT_GENERATIONS_DOWN,
  DEFAULT_GENERATIONS_UP,
  getNeighborhood,
} from "./neighborhood";
