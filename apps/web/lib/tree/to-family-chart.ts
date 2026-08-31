import type { Neighborhood, NeighborhoodPerson, Sex } from "@/lib/db";
import { findUnresolvedPartners } from "./expand-tree";

/**
 * The `family-chart` datum shape (SPEC §8.2, WAYFINDER decision 23). Kept as our
 * own type rather than importing the library's: its published `Datum` marks
 * `data.gender` as a required `"M" | "F"`, and we build every field ourselves in
 * {@link toFamilyChartData}. This type is a structural subset of the library's,
 * so the array passes straight to `createChart` with no assertion.
 */
export interface FamilyChartDatum {
  id: string;
  data: FamilyChartPersonData;
  // Mutable — `family-chart` owns this structure once it is handed over (it
  // migrates legacy `father` / `mother` keys and tags nodes during layout).
  rels: {
    parents: string[];
    spouses: string[];
    children: string[];
  };
}

/** The tint bucket for a card — the real `sex`, folded to what the card shows. */
export type CardSex = "male" | "female" | "neutral";

export interface FamilyChartPersonData {
  /**
   * Layout hint for `family-chart` only: `"M"` for male, `"F"` for everyone
   * else. The library positions a couple by this and nothing else keys off it
   * for us — the card tint reads {@link FamilyChartPersonData.sex}. An
   * unknown-sex person is laid out on the same side as a woman; that is a
   * position, not a claim.
   */
  readonly gender: "M" | "F";
  /** The real value, drives the blue / orange / grey card tint. */
  readonly sex: CardSex;
  readonly givenName: string;
  readonly surname: string;
  readonly nickname: string;
  readonly birthYear: number | null;
  readonly deathYear: number | null;
  readonly isLiving: boolean | null;
  /** A profile photo when one exists (issue #34); silhouette until then. */
  readonly avatarUrl: string | null;
  /**
   * Expand-in-place (issue #24, SPEC §8.2): true when this person sits at the
   * edge of the fetched window and has a recorded parent / child the window
   * did not fetch. `hiddenPartnerId` is set instead when a family already in
   * view names a partner the window never resolved to a full person.
   */
  readonly canExpandUp: boolean;
  readonly canExpandDown: boolean;
  readonly hiddenPartnerId: string | null;
}

export interface FamilyChartTree {
  readonly data: readonly FamilyChartDatum[];
  readonly mainId: string;
}

/**
 * Turn one {@link Neighborhood} into the array `family-chart` renders, plus the
 * id it should centre on.
 *
 * The only reshaping is de-duplication: every id appears once and each `rels`
 * array is a sorted, duplicate-free set. A repeated ancestor (a cousin marriage
 * folds the pedigree into a diamond) is left for `family-chart` to detect and
 * draw once — the graph is keyed by id and a diamond is not a cycle. A genuine
 * self-loop (a person listed among their own family's children) is dropped.
 */
export function toFamilyChartData(neighborhood: Neighborhood): FamilyChartTree {
  const rels = buildRels(neighborhood);
  const unresolvedPartners = findUnresolvedPartners(neighborhood);

  const data: FamilyChartDatum[] = neighborhood.persons.map((person) => {
    const entry = rels.get(person.id);
    return {
      id: person.id,
      data: toPersonData(person, unresolvedPartners.get(person.id) ?? null),
      rels: {
        parents: sortedIds(entry?.parents),
        spouses: sortedIds(entry?.spouses),
        children: sortedIds(entry?.children),
      },
    };
  });

  return { data, mainId: neighborhood.focus_id };
}

interface RelSets {
  readonly parents: Set<string>;
  readonly spouses: Set<string>;
  readonly children: Set<string>;
}

/**
 * Walk the `family` edges once and collect each person's parents / spouses /
 * children as sets. Only people that are themselves in the neighborhood are
 * linked — a partner or child outside the fetched window is left out, which is
 * what bounds the chart to the visible neighbourhood (WAYFINDER decision 9).
 */
function buildRels(neighborhood: Neighborhood): Map<string, RelSets> {
  const rels = new Map<string, RelSets>();
  for (const person of neighborhood.persons) {
    rels.set(person.id, {
      parents: new Set(),
      spouses: new Set(),
      children: new Set(),
    });
  }

  for (const family of neighborhood.families) {
    const partners = [family.partner1_id, family.partner2_id].filter(
      (id): id is string => id !== null && rels.has(id),
    );

    const [first, second] = partners;
    if (first !== undefined && second !== undefined) {
      rels.get(first)?.spouses.add(second);
      rels.get(second)?.spouses.add(first);
    }

    for (const childId of family.child_ids) {
      const childRels = rels.get(childId);
      if (childRels === undefined) {
        continue;
      }
      for (const partnerId of partners) {
        if (partnerId === childId) {
          continue; // a person is never their own parent
        }
        childRels.parents.add(partnerId);
        rels.get(partnerId)?.children.add(childId);
      }
    }
  }

  return rels;
}

function toPersonData(
  person: NeighborhoodPerson,
  hiddenPartnerId: string | null,
): FamilyChartPersonData {
  return {
    gender: person.sex === "male" ? "M" : "F",
    sex: cardSex(person.sex),
    givenName: person.given_name ?? "",
    surname: person.surname ?? "",
    nickname: person.nickname ?? "",
    birthYear: person.birth_year,
    deathYear: person.death_year,
    isLiving: person.is_living,
    avatarUrl: null,
    canExpandUp: person.can_expand_up,
    canExpandDown: person.can_expand_down,
    hiddenPartnerId,
  };
}

function cardSex(sex: Sex | null): CardSex {
  if (sex === "male") {
    return "male";
  }
  if (sex === "female") {
    return "female";
  }
  return "neutral";
}

function sortedIds(ids: Set<string> | undefined): string[] {
  return ids === undefined ? [] : [...ids].sort();
}
