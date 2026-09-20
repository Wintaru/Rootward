import { formatRowDate } from "@/lib/db/genealogy-date";
import type {
  PersonProfileData,
  ProfileCitation,
  ProfileEvent,
  ProfileFact,
  ProfileFamilyEvent,
  ProfileName,
} from "@/lib/db/person";
import {
  UNION_ENDING_EVENT_TYPES,
  type NeighborhoodPerson,
  type UnionEndedBy,
  type UnionType,
} from "@/lib/db/types";

import {
  eventTypeLabel,
  factTypeLabel,
  humanizeToken,
  nameTypeLabel,
  sexLabel,
  unionEndedLabel,
  unionSegment,
  unionTypeLabel,
} from "./labels";
import {
  assembleName,
  formatLifespan,
  personName,
  resolveRelationships,
} from "./relatives";

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
  readonly href: string;
  readonly label: string;
  readonly caption: string | null;
  readonly isPrimary: boolean;
  /** `null` when the section has no thumbnail (no derivative codec for this
   * MIME, or the signed URL failed to mint) — the card falls back to the
   * filename label instead of an `<img>`. */
  readonly thumbUrl: string | null;
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
  /** `storage_path_thumb` → signed URL, pre-fetched server-side (the `media`
   * bucket only grants `storage.objects` access to moderators — see
   * `media-urls.ts`). This function stays pure by taking the lookup rather
   * than minting URLs itself. */
  thumbUrls: ReadonlyMap<string, string> = new Map(),
): PersonProfileView {
  const focus =
    data.relationships.persons.find((p) => p.id === data.person.id) ?? null;
  const rel = resolveRelationships(data.relationships, data.person.id);
  const familyEventsById = groupFamilyEvents(data.familyEvents);

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
      toRelationLine(
        entry.person,
        unionDetail(
          entry.relationshipType,
          entry.endedBy,
          familyEventsById.get(entry.familyId) ?? [],
        ),
      ),
    ),
    children: rel.children.map((p) => toRelationLine(p)),
    media: data.media.map((m) => ({
      id: m.id,
      href: `/media/${m.mediaId}`,
      label: m.title?.trim() || m.filename?.trim() || "Untitled media",
      caption: m.caption,
      isPrimary: m.isPrimary,
      thumbUrl:
        m.storagePathThumb === null
          ? null
          : (thumbUrls.get(m.storagePathThumb) ?? null),
    })),
    sources: data.citations.map(toSourceLine),
    notes: data.notes
      .filter((note) => note.text.trim() !== "")
      .map((note) => ({ id: note.id, text: note.text })),
  };
}

// --- names -----------------------------------------------------------

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

// --- union events (SPEC §8.3, issue #57) ------------------------------

function groupFamilyEvents(
  events: readonly ProfileFamilyEvent[],
): ReadonlyMap<string, readonly ProfileFamilyEvent[]> {
  const byFamily = new Map<string, ProfileFamilyEvent[]>();
  for (const event of events) {
    const list = byFamily.get(event.familyId) ?? [];
    list.push(event);
    byFamily.set(event.familyId, list);
  }
  return byFamily;
}

/** The partner line's `detail` (SPEC §8.3, issue #57's "both partners'
 * profiles show it"): the union type plus its one most relevant event's date
 * and place, e.g. `"Married — 12 Jun 1990, Springfield"`, and — once the
 * union has ended (issue #122) — a second segment for that:
 * `"Married — 1990 · Divorced — 2003, Reno"`. Whether it ended is the
 * server's call (`ended_by`, from `family_ended_by`); this only looks up
 * that event's date. A recorded `marriage` event wins over any other type
 * (engagement, banns, …) as the headline date for a v1 glance line; ties
 * broken by `sortKey` (undated last). An ending event never headlines the
 * standing segment, so a divorce alone reads "Divorced — 2003", not
 * "Married — 2003". The full set is still every partner's own Events
 * section; this is only the profile's one-line summary. */
function unionDetail(
  relationshipType: UnionType | null,
  endedBy: UnionEndedBy | null,
  events: readonly ProfileFamilyEvent[],
): string | null {
  const standing = unionEventSegment(
    unionTypeLabel(relationshipType),
    pickHeadlineUnionEvent(events.filter((event) => !isEndingEvent(event))),
  );
  if (endedBy === null) {
    return standing;
  }
  const ended = unionEventSegment(
    unionEndedLabel(endedBy),
    events.find((event) => event.type === endedBy),
  );
  const segments = [standing, ended].filter(
    (segment): segment is string => segment !== null,
  );
  return segments.length === 0 ? null : segments.join(" · ");
}

function isEndingEvent(event: ProfileFamilyEvent): boolean {
  return UNION_ENDING_EVENT_TYPES.some((type) => type === event.type);
}

function unionEventSegment(
  label: string | null,
  event: ProfileFamilyEvent | undefined,
): string | null {
  return event === undefined
    ? unionSegment(label, null, null)
    : unionSegment(label, formatRowDate(event.date) || null, event.placeName);
}

function pickHeadlineUnionEvent(
  events: readonly ProfileFamilyEvent[],
): ProfileFamilyEvent | undefined {
  const marriage = events.find((event) => event.type === "marriage");
  if (marriage !== undefined) {
    return marriage;
  }
  return [...events].sort((a, b) => {
    if (a.sortKey === b.sortKey) return 0;
    if (a.sortKey === null) return 1;
    if (b.sortKey === null) return -1;
    return a.sortKey < b.sortKey ? -1 : 1;
  })[0];
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
