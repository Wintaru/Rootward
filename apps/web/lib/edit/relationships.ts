import type { PersonRef, UnionFamilySummary } from "@/lib/db/family-edit";
import type { PartnerRole, Sex } from "@/lib/db/types";

import { normalizeText } from "./diff";

/**
 * Pure helpers for the Relationships section (SPEC §8.3, WAYFINDER decision
 * 36, issue #56), shared between the picker component
 * (`PersonPickerOrCreate.tsx`) and the server actions that resolve its
 * choice into a `family-edit.ts` write. The section itself has no
 * local diff/draft state to speak of — see `family-edit.ts`'s module doc for
 * why — so this is what stays pure and unit-testable regardless.
 */

/** GEDCOM's own convention (HUSB/WIFE) as a sensible starting point, always
 * editable afterward (decision 36 — "partner roles derive from sex"). */
export function defaultPartnerRoleForSex(sex: Sex | null): PartnerRole {
  if (sex === "male") return "husband";
  if (sex === "female") return "wife";
  return "partner";
}

/** What `PersonPickerOrCreate` resolves to: an id already in the tree, or the
 * fields for a brand-new person (issue #55's shape) — not yet normalised,
 * since that is a server-side concern ({@link toPersonRef}) the same as every
 * other section's save path. */
export type PersonRefInput =
  | { readonly kind: "existing"; readonly personId: string }
  | {
      readonly kind: "new";
      readonly givenName: string;
      readonly surname: string;
      readonly sex: Sex;
    };

/** Normalises a picker's choice into `family-edit.ts`'s `PersonRef` — empty
 * name fields become `null`, same as every other free-text save
 * (`normalizeText`, `lib/edit/diff.ts`). */
export function toPersonRef(input: PersonRefInput): PersonRef {
  if (input.kind === "existing") {
    return { kind: "existing", personId: input.personId };
  }
  return {
    kind: "new",
    givenName: normalizeText(input.givenName),
    surname: normalizeText(input.surname),
    sex: input.sex,
  };
}

/** "Union with Jane Doe" for the Events section's per-family group heading
 * (SPEC §8.3, issue #57) — the *other* partner relative to `focusPersonId`,
 * falling back to a bare "Union" for a single-known-parent family with no
 * second partner yet (SPEC §8.3's #56 note on single-parent families). */
export function unionPartnerLabel(
  union: UnionFamilySummary,
  focusPersonId: string,
): string {
  const other =
    union.partner1?.id === focusPersonId ? union.partner2 : union.partner1;
  return other === null ? "Union" : `Union with ${other.name}`;
}
