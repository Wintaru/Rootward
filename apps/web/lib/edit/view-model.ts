import type { PersonEditShellData } from "@/lib/db/person";
import type { NeighborhoodPerson } from "@/lib/db/types";

import { sexLabel } from "@/lib/person/labels";
import {
  assembleName,
  formatLifespan,
  personName,
  resolveRelationships,
} from "@/lib/person/relatives";

import {
  DEFAULT_EDIT_SECTION,
  EDIT_SECTIONS,
  editSectionHref,
  type EditSectionSlug,
} from "./sections";

/**
 * Pure view model for the `/person/[personId]/edit` shell (SPEC §8.3, §10 item
 * 26). Section content itself is out of scope here — #27–#32 add it — so this
 * only builds the header, the section nav, and the parents / partners+children
 * relatives strip.
 */

export interface EditRelativeLine {
  readonly id: string;
  readonly name: string;
  readonly lifespan: string | null;
  readonly detail: string | null;
  readonly href: string;
}

export interface EditSectionNavItem {
  readonly slug: EditSectionSlug;
  readonly label: string;
  readonly href: string;
  readonly isActive: boolean;
}

export interface EditShellView {
  readonly id: string;
  readonly displayName: string;
  readonly subtitle: string | null;
  readonly profileHref: string;
  readonly sections: readonly EditSectionNavItem[];
  readonly activeSection: EditSectionNavItem;
  readonly parents: readonly EditRelativeLine[];
  readonly partnersAndChildren: readonly EditRelativeLine[];
}

export function buildEditShellView(
  data: PersonEditShellData,
  requestedSection: EditSectionSlug = DEFAULT_EDIT_SECTION,
): EditShellView {
  const { person, relationships } = data;
  const focus = relationships.persons.find((p) => p.id === person.id) ?? null;
  const rel = resolveRelationships(relationships, person.id);

  const sections = EDIT_SECTIONS.map((section): EditSectionNavItem => ({
    slug: section.slug,
    label: section.label,
    href: editSectionHref(person.id, section.slug),
    isActive: section.slug === requestedSection,
  }));
  const activeSection =
    sections.find((section) => section.isActive) ?? sections[0]!;

  const displayName = assembleName({
    prefix: person.namePrefix,
    given: person.givenName,
    surname: person.surname,
    suffix: person.nameSuffix,
    nickname: person.nickname,
  });

  const subtitleParts = [
    sexLabel(person.sex),
    focus === null ? null : formatLifespan(focus) || null,
  ].filter((part): part is string => part !== null);

  return {
    id: person.id,
    displayName: displayName || "Unnamed person",
    subtitle: subtitleParts.length === 0 ? null : subtitleParts.join(" · "),
    profileHref: `/person/${person.id}`,
    sections,
    activeSection,
    parents: rel.parents.map((parent) => toRelativeLine(parent)),
    partnersAndChildren: [
      ...rel.partners.map((entry) =>
        toRelativeLine(entry.person, entry.unionType),
      ),
      ...rel.children.map((child) => toRelativeLine(child)),
    ],
  };
}

function toRelativeLine(
  person: NeighborhoodPerson,
  detail: string | null = null,
): EditRelativeLine {
  return {
    id: person.id,
    name: personName(person),
    lifespan: formatLifespan(person) || null,
    detail,
    href: `/person/${person.id}/edit`,
  };
}
