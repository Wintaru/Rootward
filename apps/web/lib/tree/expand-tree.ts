import type {
  ExpandRelation,
  Neighborhood,
  NeighborhoodFamily,
  NeighborhoodFragment,
} from "@/lib/db";

/**
 * The generation a fragment's persons sit at, relative to the person the
 * expansion started from (SPEC §8.2, issue #24): a level up for `"parents"`, a
 * level down for `"children"`, the same tier for `"self"` (a resolved partner
 * sits beside the card that carried the affordance, not above or below it).
 */
export function expandedGeneration(
  anchorGeneration: number,
  relation: ExpandRelation,
): number {
  switch (relation) {
    case "parents":
      return anchorGeneration + 1;
    case "children":
      return anchorGeneration - 1;
    case "self":
      return anchorGeneration;
  }
}

/**
 * Fold one `expand_relatives` fragment into the current neighborhood
 * (issue #24) — additive, never a re-fetch of the whole tree.
 *
 * A person already in `base` is left as-is (their real `generation` is not
 * overwritten by a placeholder from a second expansion path — pedigree
 * collapse can make the same person reachable from more than one branch). A
 * family already in `base` has its `child_ids` widened, not duplicated:
 * `expand_relatives("children")` returns every child of a family
 * `getNeighborhood` may already have returned with a window-truncated set.
 */
export function mergeNeighborhoodFragment(
  base: Neighborhood,
  fragment: NeighborhoodFragment,
  generation: number,
): Neighborhood {
  const persons = [...base.persons];
  const personIds = new Set(persons.map((person) => person.id));
  for (const person of fragment.persons) {
    if (personIds.has(person.id)) {
      continue;
    }
    personIds.add(person.id);
    persons.push({ ...person, generation });
  }

  const familiesById = new Map(
    base.families.map((family) => [family.id, family]),
  );
  for (const family of fragment.families) {
    const existing = familiesById.get(family.id);
    familiesById.set(
      family.id,
      existing === undefined ? family : mergeFamily(existing, family),
    );
  }

  return { ...base, persons, families: [...familiesById.values()] };
}

function mergeFamily(
  existing: NeighborhoodFamily,
  incoming: NeighborhoodFamily,
): NeighborhoodFamily {
  return {
    ...existing,
    child_ids: [
      ...new Set([...existing.child_ids, ...incoming.child_ids]),
    ].sort(),
  };
}

/**
 * Person ids in `neighborhood.persons` whose family names a partner the
 * fetched window did not resolve — a descendant's spouse, say (SPEC §8.4).
 * The tree view shows a "resolve partner" affordance on the known partner's
 * card; expanding it calls `expandRelatives(hiddenPartnerId, "self")`.
 *
 * One entry per known partner: a person married more than once, with more
 * than one off-window spouse, surfaces only the last family walked. Same
 * v1-scope call as the rest of expand-in-place (WAYFINDER decision 28) — rare
 * enough, and low-stakes enough (the affordance still resolves *a* spouse), to
 * leave for the post-MVP extended-family pass rather than a `Map<string,
 * string[]>` every caller has to handle.
 */
export function findUnresolvedPartners(
  neighborhood: Neighborhood,
): ReadonlyMap<string, string> {
  const knownIds = new Set(neighborhood.persons.map((person) => person.id));
  const unresolved = new Map<string, string>();
  for (const family of neighborhood.families) {
    addIfUnresolved(
      unresolved,
      knownIds,
      family.partner1_id,
      family.partner2_id,
    );
    addIfUnresolved(
      unresolved,
      knownIds,
      family.partner2_id,
      family.partner1_id,
    );
  }
  return unresolved;
}

function addIfUnresolved(
  target: Map<string, string>,
  knownIds: ReadonlySet<string>,
  knownPartnerId: string | null,
  otherPartnerId: string | null,
): void {
  if (
    knownPartnerId !== null &&
    otherPartnerId !== null &&
    knownIds.has(knownPartnerId) &&
    !knownIds.has(otherPartnerId)
  ) {
    target.set(knownPartnerId, otherPartnerId);
  }
}
