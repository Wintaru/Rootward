import { Constants } from "@/lib/db";
import type { RowConflict } from "@/lib/db/conflict";
import type {
  PersonEditFields,
  PersonFieldPatch,
  PersonReferenceNumberFields,
} from "@/lib/db/person-edit";
import type { PersonVisibility, Sex } from "@/lib/db/types";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure form state + diffing for the Name & Gender and Reference Numbers
 * sections (SPEC §8.3, §10 item 27) — both edit different columns of the same
 * `person` row. Two small, concrete shapes rather than one generic
 * "field-subset" abstraction: `sex` is a closed enum (a `<select>`, not text)
 * while every other field is free text, so a single generic mapping over
 * `PersonEditFields` buys nothing but type-gymnastics for two call sites.
 *
 * Both `loaded` types are narrower `Pick`s of {@link PersonEditFields}, not
 * the whole thing — the `/edit` shell has already fetched the Name & Gender
 * columns (they are exactly `ProfilePersonCore`'s, `lib/db/person.ts`), so
 * `page.tsx` builds `NameGenderFields` from the shell data with no second
 * `person` query; Reference Numbers still needs its own read
 * ({@link PersonReferenceNumberFields}), but a lean one — just the three
 * reference columns, not the Name & Gender ones the shell already holds.
 * Both stay `Pick`s of {@link PersonEditFields} (not e.g. `ProfilePersonCore`
 * directly) so a save's full returned row is always assignable back onto
 * whichever of these the section is holding.
 */

export type NameGenderFields = Pick<
  PersonEditFields,
  | "id"
  | "updatedAt"
  | "givenName"
  | "surname"
  | "namePrefix"
  | "nameSuffix"
  | "nickname"
  | "sex"
  | "visibility"
  | "isLiving"
>;

export interface NameGenderDraft {
  readonly givenName: string;
  readonly surname: string;
  readonly namePrefix: string;
  readonly nameSuffix: string;
  readonly nickname: string;
  readonly sex: Sex | null;
  readonly visibility: PersonVisibility;
  /** `null` = Computed, otherwise an explicit override — same tri-state as
   * {@link PersonEditFields.isLiving}. */
  readonly isLiving: boolean | null;
}

export interface ReferenceNumbersDraft {
  readonly familysearchId: string;
  readonly ancestralFileNumber: string;
  readonly userReferenceNumber: string;
}

export function nameGenderDraft(loaded: NameGenderFields): NameGenderDraft {
  return {
    givenName: loaded.givenName ?? "",
    surname: loaded.surname ?? "",
    namePrefix: loaded.namePrefix ?? "",
    nameSuffix: loaded.nameSuffix ?? "",
    nickname: loaded.nickname ?? "",
    sex: loaded.sex,
    visibility: loaded.visibility,
    isLiving: loaded.isLiving,
  };
}

export function referenceNumbersDraft(
  loaded: PersonReferenceNumberFields,
): ReferenceNumbersDraft {
  return {
    familysearchId: loaded.familysearchId ?? "",
    ancestralFileNumber: loaded.ancestralFileNumber ?? "",
    userReferenceNumber: loaded.userReferenceNumber ?? "",
  };
}

/** `null` means nothing changed — the caller's cue to skip the save call. */
export function nameGenderPatch(
  loaded: NameGenderFields,
  draft: NameGenderDraft,
): PersonFieldPatch | null {
  const givenName = normalizeText(draft.givenName);
  const surname = normalizeText(draft.surname);
  const namePrefix = normalizeText(draft.namePrefix);
  const nameSuffix = normalizeText(draft.nameSuffix);
  const nickname = normalizeText(draft.nickname);

  const patch: PersonFieldPatch = {
    ...(givenName !== loaded.givenName ? { givenName } : {}),
    ...(surname !== loaded.surname ? { surname } : {}),
    ...(namePrefix !== loaded.namePrefix ? { namePrefix } : {}),
    ...(nameSuffix !== loaded.nameSuffix ? { nameSuffix } : {}),
    ...(nickname !== loaded.nickname ? { nickname } : {}),
    ...(draft.sex !== loaded.sex ? { sex: draft.sex } : {}),
    ...(draft.visibility !== loaded.visibility
      ? { visibility: draft.visibility }
      : {}),
    ...(draft.isLiving !== loaded.isLiving ? { isLiving: draft.isLiving } : {}),
  };

  return Object.keys(patch).length === 0 ? null : patch;
}

export function referenceNumbersPatch(
  loaded: PersonReferenceNumberFields,
  draft: ReferenceNumbersDraft,
): PersonFieldPatch | null {
  const familysearchId = normalizeText(draft.familysearchId);
  const ancestralFileNumber = normalizeText(draft.ancestralFileNumber);
  const userReferenceNumber = normalizeText(draft.userReferenceNumber);

  const patch: PersonFieldPatch = {
    ...(familysearchId !== loaded.familysearchId ? { familysearchId } : {}),
    ...(ancestralFileNumber !== loaded.ancestralFileNumber
      ? { ancestralFileNumber }
      : {}),
    ...(userReferenceNumber !== loaded.userReferenceNumber
      ? { userReferenceNumber }
      : {}),
  };

  return Object.keys(patch).length === 0 ? null : patch;
}

/** Reads off `Constants.public.Enums.sex` (the generated schema constant) so
 * this never drifts from the Postgres enum it validates against. */
export function isSex(value: string): value is Sex {
  return (Constants.public.Enums.sex as readonly string[]).includes(value);
}

/** The visibility values the edit view's `<select>` offers (SPEC §5, decision
 * 7). `close_family` is a valid `person_visibility` value (post-MVP, #43) but
 * deliberately excluded — the MVP UI never lets a moderator choose it. */
export const EDITABLE_PERSON_VISIBILITIES: readonly PersonVisibility[] = [
  "everyone_approved",
  "moderators_only",
  "hidden",
];

export function isEditablePersonVisibility(
  value: string,
): value is PersonVisibility {
  return (EDITABLE_PERSON_VISIBILITIES as readonly string[]).includes(value);
}

// --- conflict description ---------------------------------------------

const PERSON_FIELD_LABELS: Readonly<Record<keyof PersonFieldPatch, string>> = {
  givenName: "Given name",
  surname: "Surname",
  namePrefix: "Prefix",
  nameSuffix: "Suffix",
  nickname: "Nickname",
  sex: "Sex",
  visibility: "Visibility",
  isLiving: "Living",
  familysearchId: "FamilySearch ID",
  ancestralFileNumber: "Ancestral File Number",
  userReferenceNumber: "User Reference Number",
};

/** `key` distinguishes `isLiving`'s `null` (Computed — a real, chosen state)
 * from every other field's `null` (cleared — shown blank, same as always). */
function fieldToText(
  key: keyof PersonFieldPatch,
  value: string | Sex | PersonVisibility | boolean | null | undefined,
): string {
  if (typeof value === "boolean") {
    return value ? "Living" : "Deceased";
  }
  if (key === "isLiving") {
    return "Computed";
  }
  return value ?? "";
}

/**
 * Maps a rejected Name & Gender / Reference Numbers save into the shared
 * `ConflictItem` shape (SPEC §8.3, decision 26) — see `describeEventConflicts`
 * for the "only fields actually attempted" rationale, which here is simply
 * `patch`'s own keys (a section only ever patches the columns it touches).
 * `yours` reads from `patch`, not `draft` — `patch` is already the
 * normalised value a save would have sent.
 */
export function describePersonFieldsConflict(
  personId: string,
  patch: PersonFieldPatch,
  conflict: RowConflict<PersonEditFields>,
): ConflictItem {
  return {
    id: personId,
    title: "This person",
    changedBy: conflict.changedBy,
    deleted: conflict.theirs === null,
    fields:
      conflict.theirs === null
        ? []
        : (Object.keys(patch) as (keyof PersonFieldPatch)[]).map((key) => ({
            label: PERSON_FIELD_LABELS[key],
            yours: fieldToText(key, patch[key]),
            theirs: fieldToText(key, conflict.theirs![key]),
          })),
  };
}
