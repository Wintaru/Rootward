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
export type ChildRelation = Database["public"]["Enums"]["child_relation"];
export type EventType = Database["public"]["Enums"]["event_type"];
export type FactType = Database["public"]["Enums"]["fact_type"];
export type NameType = Database["public"]["Enums"]["name_type"];
export type FactVisibility = Database["public"]["Enums"]["fact_visibility"];
export type PersonVisibility = Database["public"]["Enums"]["person_visibility"];
export type NoteOwner = Database["public"]["Enums"]["note_owner"];
export type CitationOwner = Database["public"]["Enums"]["citation_owner"];
export type MediaOwner = Database["public"]["Enums"]["media_owner"];
export type AccountRole = Database["public"]["Enums"]["account_role"];
export type AccountStatus = Database["public"]["Enums"]["account_status"];
export type NotificationType = Database["public"]["Enums"]["notification_type"];

/**
 * The event types that end a union (issue #122). Mirrors the `in ('divorce',
 * 'annulment')` list in the `family_ended_by` SQL function — that function is
 * the one place the "has this union ended" rule is evaluated; this list only
 * names the values it can hand back, so `parseFamily` can narrow them.
 */
export const UNION_ENDING_EVENT_TYPES = [
  "divorce",
  "annulment",
] as const satisfies readonly EventType[];

export type UnionEndedBy = (typeof UNION_ENDING_EVENT_TYPES)[number];

/**
 * One person in a {@link Neighborhood}. Carries only the fields the tree card
 * needs (name parts, sex, living flag, birth/death year) plus `generation`
 * relative to the focus: 0 for the focus, its siblings, and its partners;
 * positive upward (ancestors); negative downward (descendants).
 *
 * `can_expand_up` / `can_expand_down` (issue #24) are true only for a person at
 * the edge of the fetched window with a recorded relative just past it — the
 * expand-in-place affordance shows only then, per `get_neighborhood`'s and
 * `expand_relatives`' own docs.
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
  /**
   * The surname of this person's `married` (resp. `maiden` / `birth`)
   * `person_name` variant, or null when none is recorded — the tree card
   * composes "Given Married (Maiden)" from these and `surname`
   * (`lib/tree/person-card.ts`). Null does not mean the person never married:
   * it means no such name row exists.
   */
  married_surname: string | null;
  maiden_surname: string | null;
  generation: number;
  birth_year: number | null;
  death_year: number | null;
  can_expand_up: boolean;
  can_expand_down: boolean;
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
  /** The event that ended the union (`family_ended_by`, issue #122), or
   * `null` while it stands. Derived server-side from the family's events —
   * never from `relationship_type`, which is the kind of union, not its state. */
  ended_by: UnionEndedBy | null;
  child_ids: string[];
}

/** The payload returned by {@link getNeighborhood} / the `get_neighborhood` RPC. */
export interface Neighborhood {
  focus_id: string;
  persons: NeighborhoodPerson[];
  families: NeighborhoodFamily[];
}

/**
 * Which relative to fetch for one expand-in-place step (issue #24), mirroring
 * the `expand_relatives` SQL function's `p_relation` argument: the family a
 * person is a child in, every family they partner in, or just that one person
 * (resolving a partner a family already named but the window did not fetch).
 */
export type ExpandRelation = "parents" | "children" | "self";

/**
 * The payload returned by {@link expandRelatives} / the `expand_relatives` RPC
 * — one branch, one level, no `focus_id` (there is no new focus). `generation`
 * on each person is a placeholder (`0`) — the SQL function does not compute
 * one, because it does not know the branch's position; the merge that folds a
 * fragment into a {@link Neighborhood} (`lib/tree/expand-tree.ts`) overwrites
 * it from the person already on screen that the expansion started from.
 */
export interface NeighborhoodFragment {
  persons: NeighborhoodPerson[];
  families: NeighborhoodFamily[];
}
