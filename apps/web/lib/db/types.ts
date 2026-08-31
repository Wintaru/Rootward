import type { Database } from "./database.types";

/** Row aliases for the core genealogy tables. */
export type Person = Database["public"]["Tables"]["person"]["Row"];
export type PersonName = Database["public"]["Tables"]["person_name"]["Row"];
export type Family = Database["public"]["Tables"]["family"]["Row"];
export type FamilyChild = Database["public"]["Tables"]["family_child"]["Row"];
export type EventRow = Database["public"]["Tables"]["event"]["Row"];
export type FactRow = Database["public"]["Tables"]["fact"]["Row"];

/** Enum aliases. */
export type Sex = Database["public"]["Enums"]["sex"];
export type PartnerRole = Database["public"]["Enums"]["partner_role"];
export type UnionType = Database["public"]["Enums"]["union_type"];
export type AccountRole = Database["public"]["Enums"]["account_role"];
export type AccountStatus = Database["public"]["Enums"]["account_status"];

/**
 * One person in a {@link Neighborhood}. Carries only the fields the tree card
 * needs (name parts, sex, living flag, birth/death year) plus `generation`
 * relative to the focus: 0 for the focus, its siblings, and its partners;
 * positive upward (ancestors); negative downward (descendants).
 */
export interface NeighborhoodPerson {
  id: string;
  given_name: string | null;
  surname: string | null;
  name_prefix: string | null;
  name_suffix: string | null;
  nickname: string | null;
  sex: Sex | null;
  is_living: boolean | null;
  generation: number;
  birth_year: number | null;
  death_year: number | null;
}

/**
 * One family edge in a {@link Neighborhood}. `child_ids` is limited to children
 * that are themselves in the neighborhood. A `partner*_id` may name a person not
 * in `persons` — a descendant's spouse, say — which the tree view loads on
 * demand when that branch is expanded.
 */
export interface NeighborhoodFamily {
  id: string;
  partner1_id: string | null;
  partner2_id: string | null;
  partner1_role: PartnerRole | null;
  partner2_role: PartnerRole | null;
  relationship_type: UnionType | null;
  child_ids: string[];
}

/** The payload returned by {@link getNeighborhood} / the `get_neighborhood` RPC. */
export interface Neighborhood {
  focus_id: string;
  persons: NeighborhoodPerson[];
  families: NeighborhoodFamily[];
}
