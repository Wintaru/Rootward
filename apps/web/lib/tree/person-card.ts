import type { ExpandRelation } from "@/lib/db";

import type { FamilyChartPersonData } from "./to-family-chart";

/**
 * The inner HTML of one tree card (SPEC §8.2, screenshot 2). `family-chart`
 * renders cards by injecting a string, not by mounting components, so this is a
 * builder, not a React component. Every interpolated value is escaped — names
 * come straight from the database.
 *
 * Visual state that depends on the node's place in the tree — the focus ring —
 * is CSS keyed on the `card-main` class `family-chart` puts on the outer card
 * element, so it is not a parameter here. The gender tint is keyed on
 * {@link FamilyChartPersonData.sex} via the `rw-card--*` modifier below, not on
 * the library's own `card-male` / `card-female` classes, so an unknown-sex
 * person gets a neutral card rather than a wrong one.
 *
 * @param personId the person's id — carried on every expand-affordance button
 *   ({@link expandButtonHtml}) as `data-expand-anchor`, the person already on
 *   screen the click's `expandRelatives` call and generation math are relative
 *   to (issue #24, `lib/tree/expand-tree.ts`).
 * @param duplicateCount how many times this person appears in the current
 *   layout — non-zero for a repeated ancestor (pedigree collapse). `family-chart`
 *   sets it on every copy; the card shows a small `×N` badge.
 */
export function personCardHtml(
  personId: string,
  person: FamilyChartPersonData,
  duplicateCount = 0,
): string {
  const name = escapeHtml(displayName(person));
  const lifespan = escapeHtml(formatLifespan(person));
  const photo = person.avatarUrl
    ? `<img class="rw-card__photo" src="${escapeHtml(person.avatarUrl)}" alt="" />`
    : `<span class="rw-card__photo rw-card__photo--silhouette">${SILHOUETTE_SVG}</span>`;
  const dupBadge =
    duplicateCount > 1
      ? `<span class="rw-card__dup" title="Appears ${duplicateCount} times in this view">×${duplicateCount}</span>`
      : "";
  const partnerBadge = person.hiddenPartnerId
    ? expandButtonHtml({
        modifier: "partner",
        label: "Show partner",
        target: person.hiddenPartnerId,
        anchor: personId,
        relation: "self",
      })
    : "";

  return [
    `<div class="rw-card rw-card--${person.sex}">`,
    person.canExpandUp
      ? expandButtonHtml({
          modifier: "up",
          label: "Show more ancestors",
          target: personId,
          anchor: personId,
          relation: "parents",
        })
      : "",
    photo,
    `<span class="rw-card__body">`,
    `<span class="rw-card__name">${name}</span>`,
    lifespan ? `<span class="rw-card__years">${lifespan}</span>` : "",
    `</span>`,
    dupBadge,
    partnerBadge,
    person.canExpandDown
      ? expandButtonHtml({
          modifier: "down",
          label: "Show more descendants",
          target: personId,
          anchor: personId,
          relation: "children",
        })
      : "",
    `</div>`,
  ].join("");
}

interface ExpandButtonSpec {
  /** `rw-card__expand--<modifier>`, and the glyph the button shows. */
  readonly modifier: "up" | "down" | "partner";
  readonly label: string;
  /** The person `expandRelatives` should fetch — see {@link personCardHtml}. */
  readonly target: string;
  /** The person already on screen to compute the fetched result's generation
   * from. */
  readonly anchor: string;
  readonly relation: ExpandRelation;
}

const EXPAND_GLYPH: Readonly<Record<ExpandButtonSpec["modifier"], string>> = {
  up: "▲",
  down: "▼",
  partner: "+",
};

/**
 * One expand-in-place affordance (issue #24). `family-chart` binds its own
 * card-click handler on the card element itself, so this is a real `<button>`
 * — the click-delegation listener in `FamilyTree` intercepts it in the capture
 * phase (before that handler runs) and stops it from also firing a re-centre.
 */
function expandButtonHtml(spec: ExpandButtonSpec): string {
  return (
    `<button type="button" class="rw-card__expand rw-card__expand--${spec.modifier}" ` +
    `aria-label="${escapeHtml(spec.label)}" ` +
    `data-expand-target="${escapeHtml(spec.target)}" ` +
    `data-expand-anchor="${escapeHtml(spec.anchor)}" ` +
    `data-expand-relation="${spec.relation}">${EXPAND_GLYPH[spec.modifier]}</button>`
  );
}

/** Given + surname, falling back to the nickname, then a placeholder. */
export function displayName(person: FamilyChartPersonData): string {
  const full = [person.givenName, person.surname]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
  if (full.length > 0) {
    return full;
  }
  return person.nickname.trim() || "Unknown";
}

/**
 * The birth–death line under the name:
 * - both years → `1806–1874`
 * - birth only → `b. 1806`
 * - death only → `d. 1874`
 * - neither → empty
 */
export function formatLifespan(person: FamilyChartPersonData): string {
  const { birthYear, deathYear } = person;
  if (birthYear !== null && deathYear !== null) {
    return `${birthYear}–${deathYear}`;
  }
  if (birthYear !== null) {
    return `b. ${birthYear}`;
  }
  if (deathYear !== null) {
    return `d. ${deathYear}`;
  }
  return "";
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for interpolation into an HTML string (attribute or body). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Head-and-shoulders silhouette; tinted by the card background via CSS. */
const SILHOUETTE_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12Zm0 2.4c-3.3 0-9.8 1.6-9.8 4.9v2.5h19.6v-2.5c0-3.3-6.5-4.9-9.8-4.9Z"/>' +
  "</svg>";
