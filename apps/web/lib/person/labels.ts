import type {
  ChildRelation,
  EventType,
  FactType,
  NameType,
  PartnerRole,
  Sex,
  UnionEndedBy,
  UnionType,
} from "@/lib/db";

/**
 * Display labels for the genealogy enums the read-only profile shows. Most
 * values humanise cleanly by rule (`from_to` → "From to" never appears here;
 * `marriage_banns` → "Marriage banns"), so this is a rule plus a short override
 * table for acronyms and proper nouns — not a full hand-maintained map that can
 * drift from the enum.
 */

/** `some_token` → `Some token`. */
export function humanizeToken(token: string): string {
  const spaced = token.replace(/_/g, " ").trim();
  return spaced.length === 0
    ? ""
    : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const OVERRIDES: Readonly<Record<string, string>> = {
  ssn: "Social Security Number",
  national_id: "National ID",
  bar_mitzvah: "Bar Mitzvah",
  bat_mitzvah: "Bat Mitzvah",
};

/** A raw enum token → its display label, respecting the override table above.
 * Exported (not just used internally by the `*TypeLabel` helpers below) for
 * an enum picker's option list, where there is no saved record yet to read a
 * `type_other` off of — see `EventsSection.tsx`'s `Type` `<select>`. */
export function enumTokenLabel(token: string): string {
  return OVERRIDES[token] ?? humanizeToken(token);
}

export function sexLabel(sex: Sex | null): string | null {
  return sex === null ? null : humanizeToken(sex);
}

export function nameTypeLabel(type: NameType | null): string {
  return type === null ? "Name" : enumTokenLabel(type);
}

export function unionTypeLabel(type: UnionType | null): string | null {
  return type === null || type === "unknown" ? null : enumTokenLabel(type);
}

/** "Divorced" / "Annulled" — the state a union is in once its
 * `ended_by` event exists (issue #122). Not derivable by rule: the event
 * type is a noun and the status is a participle. */
export function unionEndedLabel(endedBy: UnionEndedBy): string {
  switch (endedBy) {
    case "divorce":
      return "Divorced";
    case "annulment":
      return "Annulled";
    default:
      return assertNeverEndedBy(endedBy);
  }
}

function assertNeverEndedBy(value: never): never {
  throw new Error(`unionEndedLabel: unhandled ended_by ${String(value)}`);
}

/** `"<label> — <date>, <place>"`, dropping whichever part is missing:
 * `"Married — 1950, Springfield"` · `"Divorced — 1960"` · `"Married"` ·
 * `null` when there is nothing at all. The profile's partner line and the
 * Relationships card's status line both build from this (issues #57, #122). */
export function unionSegment(
  label: string | null,
  dateText: string | null,
  placeName: string | null,
): string | null {
  const dateAndPlace =
    [dateText, placeName]
      .filter((part): part is string => part !== null && part !== "")
      .join(", ") || null;
  const parts = [label, dateAndPlace].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : parts.join(" — ");
}

/** The one-word state of a union for a compact line — "Divorced" once it
 * has ended, otherwise the union type ("Married", "Partnership", …) or
 * `null` when that is unset / unknown. */
export function unionStatusLabel(
  type: UnionType | null,
  endedBy: UnionEndedBy | null,
): string | null {
  return endedBy === null ? unionTypeLabel(type) : unionEndedLabel(endedBy);
}

/** Unlike {@link unionTypeLabel}, `unknown` gets its own label here rather
 * than collapsing to `null` — the Relationships section's role and relation
 * `<select>`s (issue #56) show every enum value including `unknown` as an
 * explicit, chosen state, distinct from "not set yet" (`null`, shown as
 * "Unspecified"). */
export function partnerRoleLabel(role: PartnerRole | null): string {
  return role === null ? "Unspecified" : enumTokenLabel(role);
}

export function childRelationLabel(relation: ChildRelation | null): string {
  return relation === null ? "Unspecified" : enumTokenLabel(relation);
}

/**
 * An event's label: the typed name, or the free-text `type_other` when the type
 * is `other`, falling back to "Event".
 */
export function eventTypeLabel(
  type: EventType,
  typeOther: string | null,
): string {
  if (type === "other") {
    return typeOther?.trim() || "Event";
  }
  return enumTokenLabel(type);
}

/** A fact's label — same `other` handling as {@link eventTypeLabel}. */
export function factTypeLabel(
  type: FactType,
  typeOther: string | null,
): string {
  if (type === "other") {
    return typeOther?.trim() || "Fact";
  }
  return enumTokenLabel(type);
}
