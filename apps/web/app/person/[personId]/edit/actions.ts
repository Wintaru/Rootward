"use server";

import { revalidatePath } from "next/cache";

import { resolveEditAccess } from "@/lib/auth/require-moderator";
import {
  addChildToFamily,
  addParent,
  addPartner,
  deletePerson,
  fillFamilyPartnerSlot,
  isUuid,
  removeFamilyChild,
  removePartnerFromFamily,
  reorderFamilyChildren,
  searchPersons,
  searchPlaces as searchPlacesDb,
  saveCitations as persistCitations,
  saveEvents as persistEvents,
  saveFamilyEvents as persistFamilyEvents,
  saveFacts as persistFacts,
  saveNotes as persistNotes,
  saveRepositories as persistRepositories,
  saveSources as persistSources,
  updateFamilyChildRelation,
  updateFamilyRelationshipType,
  updatePartnerRole,
  updatePersonFields,
  saveAdditionalNames as persistAdditionalNames,
  type ChildRelation,
  type CitationDeleteInput,
  type CitationInsertInput,
  type CitationUpdateInput,
  type EventDeleteInput,
  type EventInsertInput,
  type EventUpdateInput,
  type FactDeleteInput,
  type FactInsertInput,
  type FactUpdateInput,
  type FamilyWriteResult,
  type NoteDeleteInput,
  type NoteInsertInput,
  type NoteUpdateInput,
  type PartnerRole,
  type PersonEditFields,
  type PersonFieldPatch,
  type PersonNameDeleteInput,
  type PersonNameInsertInput,
  type PersonNameUpdateInput,
  type PersonSearchOption,
  type PlaceOption,
  type RepositoryDeleteInput,
  type RepositoryInsertInput,
  type RepositoryUpdateInput,
  type RowConflict,
  type SaveAdditionalNamesResult,
  type SaveCitationsResult,
  type SaveEventsResult,
  type SaveFactsResult,
  type SaveNotesResult,
  type SaveRepositoriesResult,
  type SaveSourcesResult,
  type SourceDeleteInput,
  type SourceInsertInput,
  type SourceUpdateInput,
  type UnionEndedBy,
  type UnionType,
  UNION_ENDING_EVENT_TYPES,
} from "@/lib/db";
import { dateColumnsFromRaw } from "@/lib/edit/events";
import { toPersonRef, type PersonRefInput } from "@/lib/edit/relationships";
import {
  saveMediaLinks as persistMediaLinks,
  setPrimaryMedia,
  type MediaLinkDeleteInput,
  type MediaLinkUpdateInput,
  type SaveMediaLinksResult,
  type SetPrimaryMediaResult,
} from "@/lib/db/media-edit";
import { getSignedMediaUrl } from "@/lib/db/media-urls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server actions for the Name & Gender, Additional Names, Reference Numbers,
 * Events, Facts, and Notes sections (SPEC §8.3, §10 items 27, 28, 29, 31). Each
 * re-checks moderator access independently — the section components never
 * trust the page-level guard alone, same posture as `inviteToClaim` in
 * `app/moderation/actions.ts`. RLS (`person_update` / `person_name_write` /
 * `event_write` / `note_write` / `place_write`, all `is_moderator()`) is
 * still the real boundary; this is for a clean error message.
 *
 * Every write is version-checked (WAYFINDER decision 26): a save that loses
 * the `updated_at` compare comes back carrying a `RowConflict` (the row's
 * current state, refetched — see each `lib/db` module's own doc comment)
 * rather than throwing, which the section renders via the shared
 * `ConflictDialog` (#31).
 */

export type SavePersonFieldsResult =
  | { readonly status: "saved"; readonly row: PersonEditFields }
  | {
      readonly status: "conflict";
      readonly conflict: RowConflict<PersonEditFields>;
    }
  | { readonly status: "error"; readonly message: string };

/** Shared by Name & Gender and Reference Numbers — both patch the same
 * `person` row, just a different column subset. */
export async function savePersonFields(input: {
  readonly personId: string;
  readonly expectedUpdatedAt: string;
  readonly patch: PersonFieldPatch;
}): Promise<SavePersonFieldsResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (Object.keys(input.patch).length === 0) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await updatePersonFields(supabase, input);
  if (!result.ok) {
    return { status: "conflict", conflict: result.conflict };
  }

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "saved", row: result.row };
}

export type DeletePersonActionResult =
  | { readonly status: "deleted" }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string };

/** The Name & Gender section's danger-zone delete (SPEC §8.3, decision 18,
 * issue #59) — admin, not just moderator+. `delete_person`'s own
 * `is_admin()` check is the real boundary regardless (see its doc comment in
 * the migration); this is for a clean error message, same posture as every
 * other action here. The typed-name confirmation is a client-side safety
 * catch against a misclick (`DeletePersonSection.tsx`), not re-verified —
 * there is nothing more to check server-side once the caller is confirmed
 * admin. `not-found` covers a concurrent delete or a stale page; the
 * component treats it the same as `deleted`. */
export async function deletePersonAction(input: {
  readonly personId: string;
}): Promise<DeletePersonActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!access.isAdmin) {
    return {
      status: "error",
      message: "Deleting a person needs admin access.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }

  const supabase = await createSupabaseServerClient();
  let deleted: boolean;
  try {
    deleted = await deletePerson(supabase, input.personId);
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "That person could not be deleted.",
    };
  }

  revalidatePath("/tree");
  revalidatePath(`/person/${input.personId}`);
  revalidatePath(`/person/${input.personId}/edit`);
  return { status: deleted ? "deleted" : "not-found" };
}

export type SaveAdditionalNamesActionResult =
  | { readonly status: "saved"; readonly result: SaveAdditionalNamesResult }
  | { readonly status: "error"; readonly message: string };

export async function saveAdditionalNames(input: {
  readonly personId: string;
  readonly inserts: readonly PersonNameInsertInput[];
  readonly updates: readonly PersonNameUpdateInput[];
  readonly deletes: readonly PersonNameDeleteInput[];
}): Promise<SaveAdditionalNamesActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistAdditionalNames(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  return { status: "saved", result };
}

export type SaveEventsActionResult =
  | { readonly status: "saved"; readonly result: SaveEventsResult }
  | { readonly status: "error"; readonly message: string };

export async function saveEvents(input: {
  readonly personId: string;
  readonly inserts: readonly EventInsertInput[];
  readonly updates: readonly EventUpdateInput[];
  readonly deletes: readonly EventDeleteInput[];
}): Promise<SaveEventsActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistEvents(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "saved", result };
}

/** One union family's events group under the Events section (SPEC §8.3,
 * issue #57) — `personId` is only the page being edited (for access-checking
 * and revalidation), the write itself is scoped to `familyId`; `event_write`
 * RLS (`is_moderator()`) is the real boundary regardless. */
export async function saveFamilyEvents(input: {
  readonly personId: string;
  readonly familyId: string;
  readonly inserts: readonly EventInsertInput[];
  readonly updates: readonly EventUpdateInput[];
  readonly deletes: readonly EventDeleteInput[];
}): Promise<SaveEventsActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || !isUuid(input.familyId)) {
    return { status: "error", message: "Invalid request." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistFamilyEvents(supabase, {
    familyId: input.familyId,
    inserts: input.inserts,
    updates: input.updates,
    deletes: input.deletes,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "saved", result };
}

export type SaveFactsActionResult =
  | { readonly status: "saved"; readonly result: SaveFactsResult }
  | { readonly status: "error"; readonly message: string };

export async function saveFacts(input: {
  readonly personId: string;
  readonly inserts: readonly FactInsertInput[];
  readonly updates: readonly FactUpdateInput[];
  readonly deletes: readonly FactDeleteInput[];
}): Promise<SaveFactsActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistFacts(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "saved", result };
}

export type SaveNotesActionResult =
  | { readonly status: "saved"; readonly result: SaveNotesResult }
  | { readonly status: "error"; readonly message: string };

/** The Notes section (SPEC §10 item 31) has no single "owning" person the
 * way the other sections do — a note may be owned by the person or by one
 * of their events — so this only re-checks moderator access on `personId`
 * (the page the caller is editing) and does not otherwise scope the write to
 * it; `note_write` RLS is the real boundary regardless. */
export async function saveNotes(input: {
  readonly personId: string;
  readonly inserts: readonly NoteInsertInput[];
  readonly updates: readonly NoteUpdateInput[];
  readonly deletes: readonly NoteDeleteInput[];
}): Promise<SaveNotesActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistNotes(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  return { status: "saved", result };
}

export type SaveRepositoriesActionResult =
  | { readonly status: "saved"; readonly result: SaveRepositoriesResult }
  | { readonly status: "error"; readonly message: string };

/** `repository` (SPEC §10 item 30) is global reference data, not owned by any
 * one person — same as `source` below — so `personId` is only used to
 * re-validate the page the caller is editing, not to scope the write;
 * `repository_write` RLS (`is_moderator()`) is the real boundary. */
export async function saveRepositories(input: {
  readonly personId: string;
  readonly inserts: readonly RepositoryInsertInput[];
  readonly updates: readonly RepositoryUpdateInput[];
  readonly deletes: readonly RepositoryDeleteInput[];
}): Promise<SaveRepositoriesActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistRepositories(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  return { status: "saved", result };
}

export type SaveSourcesActionResult =
  | { readonly status: "saved"; readonly result: SaveSourcesResult }
  | { readonly status: "error"; readonly message: string };

/** `source` (SPEC §10 item 30) is global reference data — same scope note as
 * `saveRepositories` above. A `repositoryId` in the diff may name a
 * repository inserted in the same page load's Repositories save (already
 * committed by the time this runs, since the caller awaits that save first —
 * see `source-edit.ts`'s module doc). */
export async function saveSources(input: {
  readonly personId: string;
  readonly inserts: readonly SourceInsertInput[];
  readonly updates: readonly SourceUpdateInput[];
  readonly deletes: readonly SourceDeleteInput[];
}): Promise<SaveSourcesActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistSources(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  return { status: "saved", result };
}

export type SaveCitationsActionResult =
  | { readonly status: "saved"; readonly result: SaveCitationsResult }
  | { readonly status: "error"; readonly message: string };

/** The Citations list (SPEC §10 item 30) has no single "owning" person the
 * way most sections do — a citation may be owned by the person or by one of
 * their events or facts — so this only re-checks moderator access on
 * `personId` (the page the caller is editing), same posture as `saveNotes`;
 * `citation_write` RLS is the real boundary regardless. */
export async function saveCitations(input: {
  readonly personId: string;
  readonly inserts: readonly CitationInsertInput[];
  readonly updates: readonly CitationUpdateInput[];
  readonly deletes: readonly CitationDeleteInput[];
}): Promise<SaveCitationsActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (
    input.inserts.length === 0 &&
    input.updates.length === 0 &&
    input.deletes.length === 0
  ) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistCitations(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  return { status: "saved", result };
}

/** Place autocomplete for the Events section's `PlaceInput` (SPEC §10 item
 * 28). Gated the same as the other actions here even though `place_select`
 * RLS already allows any approved member to read — this action is only ever
 * called from the (moderator-only) edit view. */
export async function searchPlaces(
  query: string,
): Promise<readonly PlaceOption[]> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return [];
  }

  const supabase = await createSupabaseServerClient();
  return searchPlacesDb(supabase, query);
}

export type SaveMediaLinksActionResult =
  | { readonly status: "saved"; readonly result: SaveMediaLinksResult }
  | { readonly status: "error"; readonly message: string };

/** The Media section's caption/reorder/delete batch (SPEC §10 item 34) — the
 * upload itself does not go through a server action (see `MediaSection.tsx`'s
 * doc comment); this only covers edits to a link `media-process` already
 * created. */
export async function saveMediaLinks(input: {
  readonly personId: string;
  readonly updates: readonly MediaLinkUpdateInput[];
  readonly deletes: readonly MediaLinkDeleteInput[];
}): Promise<SaveMediaLinksActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }
  if (input.updates.length === 0 && input.deletes.length === 0) {
    return { status: "error", message: "Nothing to save." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await persistMediaLinks(supabase, input);

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "saved", result };
}

export type SetPrimaryMediaActionResult =
  | { readonly status: "saved"; readonly result: SetPrimaryMediaResult }
  | { readonly status: "error"; readonly message: string };

/** Set a media link as the person's primary photo (SPEC §10 item 34) —
 * immediate, not part of the batched save above (see `setPrimaryMedia`'s own
 * doc comment for why it can't be a version-checked field patch). Returns the
 * touched rows' fresh `updated_at` so the client can fold them back in
 * through `reconcileMediaLinksAfterSave` rather than caching a now-stale
 * version for either row. */
export async function setPrimaryMediaAction(input: {
  readonly personId: string;
  readonly mediaLinkId: string;
}): Promise<SetPrimaryMediaActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || !isUuid(input.mediaLinkId)) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createSupabaseServerClient();
  let result: SetPrimaryMediaResult;
  try {
    result = await setPrimaryMedia(supabase, {
      ownerType: "person",
      ownerId: input.personId,
      mediaLinkId: input.mediaLinkId,
    });
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "That photo could not be set as primary.",
    };
  }

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "saved", result };
}

/** Sign a freshly uploaded media's thumbnail path (SPEC §10 item 34) — the
 * `media` bucket only grants `storage.objects` access to moderators, and even
 * a moderator's own browser session can't mint a signed URL past that policy
 * the way the service role can (see `media-urls.ts`'s module doc). Gated the
 * same as every other action here even though the row this path came from was
 * already confirmed visible by the caller's own read moments earlier. */
export async function signMediaThumbUrl(
  path: string | null,
): Promise<string | null> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return null;
  }
  return getSignedMediaUrl(path);
}

/**
 * The Relationships section's actions (SPEC §8.3, WAYFINDER decision 36,
 * issue #56). Unlike every action above, these are immediate — no dirty
 * draft, no batched diff — since a relationship change spans `family` and
 * `family_child` together and sometimes creates or deletes a `family` row;
 * see `lib/db/family-edit.ts`'s module doc for the full rationale.
 * `RelationshipsSection.tsx` calls `router.refresh()` on a `status: "ok"`
 * result rather than reconciling returned data, so these return only whether
 * the write landed, not the row.
 */

export type RelationshipActionResult =
  | { readonly status: "ok" }
  | { readonly status: "conflict" }
  | { readonly status: "no-empty-slot" }
  | { readonly status: "error"; readonly message: string };

function toRelationshipActionResult(
  result: FamilyWriteResult,
): RelationshipActionResult {
  if (result.ok) {
    return { status: "ok" };
  }
  return { status: result.reason };
}

/** Name search behind `PersonPickerOrCreate` on this page — same underlying
 * query as `/moderation` and `/settings`' pickers (`searchPersons`),
 * gated here by `resolveEditAccess` instead of `resolveModerationAccess` /
 * `resolveSettingsAccess` since this route is the caller. */
export async function searchRelationshipPersons(
  query: string,
): Promise<readonly PersonSearchOption[]> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return [];
  }
  const supabase = await createSupabaseServerClient();
  return searchPersons(supabase, query);
}

export async function addParentAction(input: {
  readonly personId: string;
  readonly parent: PersonRefInput;
  readonly role: PartnerRole;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await addParent(supabase, {
    childPersonId: input.personId,
    parent: toPersonRef(input.parent),
    role: input.role,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return toRelationshipActionResult(result);
}

export async function addPartnerAction(input: {
  readonly personId: string;
  readonly focusRole: PartnerRole;
  readonly partner: PersonRefInput;
  readonly partnerRole: PartnerRole;
  readonly relationshipType: UnionType | null;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await addPartner(supabase, {
    focusPersonId: input.personId,
    focusRole: input.focusRole,
    partner: toPersonRef(input.partner),
    partnerRole: input.partnerRole,
    relationshipType: input.relationshipType,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return toRelationshipActionResult(result);
}

export async function fillFamilyPartnerSlotAction(input: {
  readonly personId: string;
  readonly familyId: string;
  readonly expectedUpdatedAt: string;
  readonly slot: "partner1" | "partner2";
  readonly partner: PersonRefInput;
  readonly role: PartnerRole;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || !isUuid(input.familyId)) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await fillFamilyPartnerSlot(supabase, {
    familyId: input.familyId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    slot: input.slot,
    partner: toPersonRef(input.partner),
    role: input.role,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return toRelationshipActionResult(result);
}

export async function removePartnerFromFamilyAction(input: {
  readonly personId: string;
  readonly familyId: string;
  readonly expectedUpdatedAt: string;
  readonly slot: "partner1" | "partner2";
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || !isUuid(input.familyId)) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await removePartnerFromFamily(supabase, {
    familyId: input.familyId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    slot: input.slot,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return toRelationshipActionResult(result);
}

/** "Record a divorce" on a union card (issue #122): one `divorce` (or
 * `annulment`) event written against the family, the same row the Events
 * section's "Union with <partner>" group would produce — this is a shortcut
 * to that write, not a second representation. Returns the Relationships
 * section's own result shape so the card's `useFamilyAction` drives it. A
 * union already ended is refused: the second ending would just be a
 * duplicate event, and editing the existing one belongs in Events. */
export async function recordUnionEndAction(input: {
  readonly personId: string;
  readonly familyId: string;
  readonly endedBy: UnionEndedBy;
  readonly dateRaw: string;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (
    !isUuid(input.personId) ||
    !isUuid(input.familyId) ||
    !UNION_ENDING_EVENT_TYPES.some((type) => type === input.endedBy)
  ) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createSupabaseServerClient();
  const existing = await supabase
    .from("family")
    .select("id, ended_by")
    .eq("id", input.familyId)
    .maybeSingle();
  if (existing.error !== null) {
    return { status: "error", message: existing.error.message };
  }
  if (existing.data === null) {
    return { status: "error", message: "Family not found." };
  }
  // `ended_by` is the computed field, unknown to the generated row type —
  // see `family-edit.ts`'s `UNION_FAMILY_COLUMNS`.
  const alreadyEnded = (existing.data as { ended_by?: string | null }).ended_by;
  if (alreadyEnded != null) {
    return {
      status: "error",
      message: "This union has already ended. Edit the event under Events.",
    };
  }

  await persistFamilyEvents(supabase, {
    familyId: input.familyId,
    inserts: [
      {
        id: crypto.randomUUID(),
        type: input.endedBy,
        typeOther: null,
        value: null,
        ageText: null,
        date: dateColumnsFromRaw(input.dateRaw),
        placeName: null,
      },
    ],
    updates: [],
    deletes: [],
  });

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "ok" };
}

export async function updateFamilyRelationshipTypeAction(input: {
  readonly personId: string;
  readonly familyId: string;
  readonly expectedUpdatedAt: string;
  readonly relationshipType: UnionType | null;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || !isUuid(input.familyId)) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await updateFamilyRelationshipType(supabase, {
    familyId: input.familyId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    relationshipType: input.relationshipType,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  return toRelationshipActionResult(result);
}

export async function updatePartnerRoleAction(input: {
  readonly personId: string;
  readonly familyId: string;
  readonly expectedUpdatedAt: string;
  readonly slot: "partner1" | "partner2";
  readonly role: PartnerRole | null;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || !isUuid(input.familyId)) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await updatePartnerRole(supabase, {
    familyId: input.familyId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    slot: input.slot,
    role: input.role,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  return toRelationshipActionResult(result);
}

export async function addChildToFamilyAction(input: {
  readonly personId: string;
  readonly familyId: string;
  readonly child: PersonRefInput;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || !isUuid(input.familyId)) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await addChildToFamily(supabase, {
    familyId: input.familyId,
    child: toPersonRef(input.child),
  });

  revalidatePath(`/person/${input.personId}/edit`);
  return toRelationshipActionResult(result);
}

export async function removeFamilyChildAction(input: {
  readonly personId: string;
  readonly familyChildId: string;
  readonly expectedUpdatedAt: string;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await removeFamilyChild(supabase, {
    familyChildId: input.familyChildId,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return toRelationshipActionResult(result);
}

export async function updateFamilyChildRelationAction(input: {
  readonly personId: string;
  readonly familyChildId: string;
  readonly expectedUpdatedAt: string;
  readonly slot: "partner1" | "partner2";
  readonly relation: ChildRelation | null;
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await updateFamilyChildRelation(supabase, {
    familyChildId: input.familyChildId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    slot: input.slot,
    relation: input.relation,
  });

  revalidatePath(`/person/${input.personId}/edit`);
  return toRelationshipActionResult(result);
}

export async function reorderFamilyChildrenAction(input: {
  readonly personId: string;
  readonly updates: readonly {
    readonly id: string;
    readonly expectedUpdatedAt: string;
    readonly sortOrder: number;
  }[];
}): Promise<RelationshipActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit this person.",
    };
  }
  if (!isUuid(input.personId) || input.updates.length === 0) {
    return { status: "error", message: "Nothing to reorder." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await reorderFamilyChildren(supabase, input.updates);

  revalidatePath(`/person/${input.personId}/edit`);
  return toRelationshipActionResult(result);
}
