import type { EventType, FactType, NameType, Sex, UnionType } from "@/lib/db";

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

function label(token: string): string {
  return OVERRIDES[token] ?? humanizeToken(token);
}

export function sexLabel(sex: Sex | null): string | null {
  return sex === null ? null : humanizeToken(sex);
}

export function nameTypeLabel(type: NameType | null): string {
  return type === null ? "Name" : label(type);
}

export function unionTypeLabel(type: UnionType | null): string | null {
  return type === null || type === "unknown" ? null : label(type);
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
  return label(type);
}

/** A fact's label — same `other` handling as {@link eventTypeLabel}. */
export function factTypeLabel(
  type: FactType,
  typeOther: string | null,
): string {
  if (type === "other") {
    return typeOther?.trim() || "Fact";
  }
  return label(type);
}
