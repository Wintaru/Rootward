import { formatRowDate } from "@/lib/db/genealogy-date";
import type {
  PersonProfileData,
  ProfileCitation,
  ProfileEvent,
  ProfileFact,
  ProfileName,
} from "@/lib/db/person";
import type { Neighborhood, NeighborhoodPerson } from "@/lib/db/types";

import {
  eventTypeLabel,
  factTypeLabel,
  humanizeToken,
  nameTypeLabel,
  sexLabel,
  unionTypeLabel,
} from "./labels";

/**
 * Pure view model for `/person/[personId]`. Turns the raw
 * {@link PersonProfileData} bundle into the exact strings the presentational
 * component renders — every date, label, name, and ordering decision is here so
 * the component stays a thin renderer and this stays unit-testable without a
 * runtime (frontend-arch: container/presentational via a pure builder).
 */

export interface NameLine {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export interface TimelineEntry {
  readonly id: string;
  readonly title: string;
  readonly date: string | null;
  readonly place: string | null;
  readonly detail: string | null;
}

export interface FactLine {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly date: string | null;
  readonly place: string | null;
  /** Non-null for a restricted fact — shown as a small badge (moderators only
   * ever receive these rows; RLS drops them for everyone else). */
  readonly restriction: string | null;
}

export interface RelationLine {
  readonly id: string;
  readonly name: string;
  readonly lifespan: string | null;
  readonly detail: string | null;
  readonly href: string;
}

export interface MediaLine {
  readonly id: string;
  readonly label: string;
  readonly caption: string | null;
  readonly isPrimary: boolean;
}

export interface SourceLine {
  readonly id: string;
  readonly title: string;
  readonly meta: string | null;
  readonly page: string | null;
  readonly quality: string | null;
}

export interface PersonProfileView {
  readonly id: string;
  readonly fullName: string;
  readonly sexLabel: string | null;
  readonly lifespan: string | null;
  readonly isLiving: boolean;
  readonly treeHref: string;
  readonly names: readonly NameLine[];
  readonly timeline: readonly TimelineEntry[];
  readonly facts: readonly FactLine[];
  readonly parents: readonly RelationLine[];
  readonly siblings: readonly RelationLine[];
  readonly partners: readonly RelationLine[];
  readonly children: readonly RelationLine[];
  readonly media: readonly MediaLine[];
  readonly sources: readonly SourceLine[];
  readonly notes: readonly NoteLine[];
}

export interface NoteLine {
  readonly id: string;
  readonly text: string;
}

export function buildPersonProfileView(
  data: PersonProfileData,
): PersonProfileView {
  const focus =
    data.relationships.persons.find((p) => p.id === data.person.id) ?? null;
  const rel = resolveRelationships(data.relationships, data.person.id);

  return {
    id: data.person.id,
    fullName: assembleName({
      prefix: data.person.namePrefix,
      given: data.person.givenName,
      surname: data.person.surname,
      suffix: data.person.nameSuffix,
      nickname: data.person.nickname,
    }),
    sexLabel: sexLabel(data.person.sex),
    lifespan: focus === null ? null : formatLifespan(focus),
    isLiving: data.person.isLiving === true,
    treeHref: `/tree/${data.person.id}`,
    names: data.names.map(toNameLine).filter((line) => line.value !== ""),
    timeline: toTimeline(data.events),
    facts: data.facts.map(toFactLine),
    parents: rel.parents.map((p) => toRelationLine(p)),
    siblings: rel.siblings.map((p) => toRelationLine(p)),
    partners: rel.partners.map((entry) =>
      toRelationLine(entry.person, entry.unionType),
    ),
    children: rel.children.map((p) => toRelationLine(p)),
    media: data.media.map((m) => ({
      id: m.id,
      label: m.title?.trim() || m.filename?.trim() || "Untitled media",
      caption: m.caption,
      isPrimary: m.isPrimary,
    })),
    sources: data.citations.map(toSourceLine),
    notes: data.notes
      .filter((note) => note.text.trim() !== "")
      .map((note) => ({ id: note.id, text: note.text })),
  };
}

// --- names -----------------------------------------------------------

interface NameParts {
  readonly prefix: string | null;
  readonly given: string | null;
  readonly surname: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
}

/** `Dr. John Smith Jr. "Jack"`, dropping every empty part. */
function assembleName(parts: NameParts): string {
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

function toNameLine(name: ProfileName): NameLine {
  return {
    id: name.id,
    label: nameTypeLabel(name.type),
    value: assembleName({
      prefix: name.prefix,
      given: name.givenName,
      surname: name.surname,
      suffix: name.suffix,
      nickname: name.nickname,
    }),
  };
}

// --- timeline --------------------------------------------------------

/**
 * Events ordered by `sort_key` (the DB's date + per-type ordinal), with undated
 * events last in their original order — a stable sort keyed on a sentinel.
 */
function toTimeline(events: readonly ProfileEvent[]): TimelineEntry[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const ka = a.event.sortKey;
      const kb = b.event.sortKey;
      if (ka === kb) return a.index - b.index;
      if (ka === null) return 1;
      if (kb === null) return -1;
      return ka < kb ? -1 : 1;
    })
    .map(({ event }) => ({
      id: event.id,
      title: eventTypeLabel(event.type, event.typeOther),
      date: formatRowDate(event.date) || null,
      place: event.placeName,
      detail: eventDetail(event),
    }));
}

function eventDetail(event: ProfileEvent): string | null {
  const parts = [event.value?.trim(), formatAge(event.ageText)].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return parts.length === 0 ? null : parts.join(" · ");
}

function formatAge(ageText: string | null): string {
  const age = ageText?.trim();
  return age === undefined || age === "" ? "" : `age ${age}`;
}

// --- facts ----------------------------------------------------------

function toFactLine(fact: ProfileFact): FactLine {
  return {
    id: fact.id,
    label: factTypeLabel(fact.type, fact.typeOther),
    value: fact.value?.trim() || null,
    date: formatRowDate(fact.date) || null,
    place: fact.placeName,
    restriction: factRestriction(fact),
  };
}

function factRestriction(fact: ProfileFact): string | null {
  if (fact.visibility !== "everyone_approved") {
    return humanizeToken(fact.visibility);
  }
  return fact.isSensitive ? "Sensitive" : null;
}

// --- sources ------------------------------------------------------

const QUALITY_LABELS = [
  "Unreliable",
  "Questionable",
  "Secondary evidence",
  "Primary evidence",
] as const;

function toSourceLine(citation: ProfileCitation): SourceLine {
  const meta = [
    citation.sourceAuthor,
    citation.sourcePublication,
    citation.repositoryName,
    citation.detail,
  ]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" · ");
  const quality =
    citation.quality !== null && citation.quality >= 0 && citation.quality <= 3
      ? (QUALITY_LABELS[citation.quality] ?? null)
      : null;
  return {
    id: citation.id,
    title: citation.sourceTitle?.trim() || "Untitled source",
    meta: meta === "" ? null : meta,
    page: citation.page?.trim() || null,
    quality,
  };
}

// --- relationships ----------------------------------------------------

interface ResolvedRelationships {
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
function resolveRelationships(
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

// --- shared person formatting --------------------------------------

function toRelationLine(
  person: NeighborhoodPerson,
  detail: string | null = null,
): RelationLine {
  return {
    id: person.id,
    name: personName(person),
    lifespan: formatLifespan(person) || null,
    detail,
    href: `/person/${person.id}`,
  };
}

function personName(person: NeighborhoodPerson): string {
  const full = [person.given_name, person.surname]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return full || person.nickname?.trim() || "Unknown";
}

/** `1806–1874` · `b. 1806` · `d. 1874` · `""` when neither year is known. */
function formatLifespan(person: NeighborhoodPerson): string {
  const { birth_year: birth, death_year: death } = person;
  if (birth !== null && death !== null) return `${birth}–${death}`;
  if (birth !== null) return `b. ${birth}`;
  if (death !== null) return `d. ${death}`;
  return "";
}
