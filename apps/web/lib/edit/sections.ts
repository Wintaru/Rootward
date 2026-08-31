/**
 * The edit view's left-rail section nav (SPEC §8.3, WAYFINDER decision 21 —
 * MVP panel inventory). Pure and framework-free so the URL/slug contract this
 * issue (#26) establishes is unit-testable, and each section issue (#27–#32)
 * builds against it without guessing the shape.
 */

export const EDIT_SECTIONS = [
  { slug: "name-gender", label: "Name & Gender" },
  { slug: "additional-names", label: "Additional Names" },
  { slug: "events", label: "Events" },
  { slug: "facts", label: "Facts" },
  { slug: "media", label: "Media" },
  { slug: "sources", label: "Sources" },
  { slug: "notes", label: "Notes" },
  { slug: "reference-numbers", label: "Reference Numbers" },
] as const;

export type EditSectionSlug = (typeof EDIT_SECTIONS)[number]["slug"];
export type EditSection = (typeof EDIT_SECTIONS)[number];

export const DEFAULT_EDIT_SECTION: EditSectionSlug = EDIT_SECTIONS[0]!.slug;

/** An unrecognised or missing `?section=` falls back to the first section
 * rather than erroring — a stale bookmark from a since-renamed slug should
 * still open the editor. */
export function resolveEditSection(
  raw: string | string[] | undefined,
): EditSectionSlug {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return EDIT_SECTIONS.some((section) => section.slug === value)
    ? (value as EditSectionSlug)
    : DEFAULT_EDIT_SECTION;
}

/** `/person/<id>/edit` for the default section, `?section=` only when it
 * differs — mirrors `treeHref`'s bare-URL-for-the-default convention. */
export function editSectionHref(
  personId: string,
  section: EditSectionSlug,
): string {
  const base = `/person/${personId}/edit`;
  return section === DEFAULT_EDIT_SECTION ? base : `${base}?section=${section}`;
}

/** The nav label for a section slug — the presence banner's only other
 * consumer of this registry (SPEC §8.3 / §8.5, §10 item 32). Takes a plain
 * `string`, not `EditSectionSlug`: the banner's caller already validates
 * membership (`describeOtherEditors`), but this stays total — never throwing
 * on an unrecognised value — rather than trust that validation from a second
 * file not to have a gap, same "don't error on a stale/unknown value"
 * posture as `resolveEditSection` above. */
export function editSectionLabel(slug: string): string {
  return (
    EDIT_SECTIONS.find((section) => section.slug === slug)?.label ??
    "another section"
  );
}
