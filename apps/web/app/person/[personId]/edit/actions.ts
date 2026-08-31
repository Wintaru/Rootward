"use server";

import { revalidatePath } from "next/cache";

import { resolveEditAccess } from "@/lib/auth/require-moderator";
import {
  isUuid,
  searchPlaces as searchPlacesDb,
  saveEvents as persistEvents,
  updatePersonFields,
  saveAdditionalNames as persistAdditionalNames,
  type EventDeleteInput,
  type EventInsertInput,
  type EventUpdateInput,
  type PersonEditFields,
  type PersonFieldPatch,
  type PersonNameDeleteInput,
  type PersonNameInsertInput,
  type PersonNameUpdateInput,
  type PlaceOption,
  type SaveAdditionalNamesResult,
  type SaveEventsResult,
} from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server actions for the Name & Gender, Additional Names, Reference Numbers,
 * and Events sections (SPEC §8.3, §10 items 27, 28). Each re-checks moderator
 * access independently — the section components never trust the page-level
 * guard alone, same posture as `inviteToClaim` in `app/moderation/actions.ts`.
 * RLS (`person_update` / `person_name_write` / `event_write` / `place_write`,
 * all `is_moderator()`) is still the real boundary; this is for a clean error
 * message.
 *
 * Both writes are version-checked (WAYFINDER decision 26): a save that loses
 * the `updated_at` compare comes back as `{ status: "conflict" }` rather than
 * throwing. The full `ConflictDialog` side-by-side treatment is #31 — this
 * issue only has to get the save shape and the conflict signal right.
 */

export type SavePersonFieldsResult =
  | { readonly status: "saved"; readonly row: PersonEditFields }
  | { readonly status: "conflict" }
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
    return { status: "conflict" };
  }

  revalidatePath(`/person/${input.personId}/edit`);
  revalidatePath(`/person/${input.personId}`);
  return { status: "saved", row: result.row };
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
