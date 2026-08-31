import type { Neighborhood, NeighborhoodPerson } from "@/lib/db/types";

import { unionTypeLabel } from "./labels";

/**
 * Shared person-display and relationship-resolution helpers. Pulled out of
 * `view-model.ts` (the read-only profile) so `edit/view-model.ts` (the edit
 * shell's relatives strip, issue #26) reuses the exact same name-assembly and
 * family-walk logic instead of a second copy that can drift from it.
 */

export interface NameParts {
  readonly prefix: string | null;
  readonly given: string | null;
  readonly surname: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
}

/** `Dr. John Smith Jr. "Jack"`, dropping every empty part. */
export function assembleName(parts: NameParts): string {
  const core = [parts.prefix, parts.given, parts.surname, parts.suffix]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  const nick = parts.nickname?.trim();
  if (core === "") {
    return nick ? `"${nick}"` : "";
  }
  return nick ? `${core} "${nick}"` : core;
}

export function personName(person: NeighborhoodPerson): string {
  const full = [person.given_name, person.surname]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return full || person.nickname?.trim() || "Unknown";
}

/** `1806–1874` · `b. 1806` · `d. 1874` · `""` when neither year is known. */
export function formatLifespan(person: NeighborhoodPerson): string {
  const { birth_year: birth, death_year: death } = person;
  if (birth !== null && death !== null) return `${birth}–${death}`;
  if (birth !== null) return `b. ${birth}`;
  if (death !== null) return `d. ${death}`;
  return "";
}

export interface ResolvedRelationships {
  readonly parents: NeighborhoodPerson[];
  readonly siblings: NeighborhoodPerson[];
  readonly partners: {
    readonly person: NeighborhoodPerson;
    readonly unionType: string | null;
  }[];
  readonly children: NeighborhoodPerson[];
}

/**
 * Split the one-generation {@link Neighborhood} into the four relationship
 * groups. `get_neighborhood` already limited the set to the visible
 * neighbourhood, so an id absent from `persons` is simply left out.
 */
export function resolveRelationships(
  neighborhood: Neighborhood,
  focusId: string,
): ResolvedRelationships {
  const byId = new Map(neighborhood.persons.map((p) => [p.id, p]));

  const parentIds = new Set<string>();
  const siblingIds = new Set<string>();
  for (const family of neighborhood.families) {
    if (!family.child_ids.includes(focusId)) continue;
    for (const partnerId of [family.partner1_id, family.partner2_id]) {
      if (partnerId !== null && partnerId !== focusId) parentIds.add(partnerId);
    }
    for (const childId of family.child_ids) {
      if (childId !== focusId) siblingIds.add(childId);
    }
  }

  // Two families with the same partner (an earlier and a later marriage to the
  // same person) collapse to one entry — deliberate for a v1 read-only view;
  // only the first union's label is kept.
  const partners: { person: NeighborhoodPerson; unionType: string | null }[] =
    [];
  const seenPartners = new Set<string>();
  const childIds = new Set<string>();
  for (const family of neighborhood.families) {
    const isPartner =
      family.partner1_id === focusId || family.partner2_id === focusId;
    if (!isPartner) continue;
    const otherId =
      family.partner1_id === focusId ? family.partner2_id : family.partner1_id;
    const other = otherId === null ? undefined : byId.get(otherId);
    if (other !== undefined && !seenPartners.has(other.id)) {
      seenPartners.add(other.id);
      partners.push({
        person: other,
        unionType: unionTypeLabel(family.relationship_type),
      });
    }
    for (const childId of family.child_ids) childIds.add(childId);
  }

  return {
    parents: collect(byId, parentIds),
    siblings: collect(byId, siblingIds),
    partners,
    children: collect(byId, childIds),
  };
}

function collect(
  byId: ReadonlyMap<string, NeighborhoodPerson>,
  ids: ReadonlySet<string>,
): NeighborhoodPerson[] {
  const people: NeighborhoodPerson[] = [];
  for (const id of ids) {
    const person = byId.get(id);
    if (person !== undefined) people.push(person);
  }
  return people.sort(byBirthThenName);
}

function byBirthThenName(a: NeighborhoodPerson, b: NeighborhoodPerson): number {
  const ya = a.birth_year ?? Number.POSITIVE_INFINITY;
  const yb = b.birth_year ?? Number.POSITIVE_INFINITY;
  if (ya !== yb) return ya - yb;
  return personName(a).localeCompare(personName(b));
}
