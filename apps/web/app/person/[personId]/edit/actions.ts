"use server";

import { revalidatePath } from "next/cache";

import { resolveEditAccess } from "@/lib/auth/require-moderator";
import {
  isUuid,
  updatePersonFields,
  saveAdditionalNames as persistAdditionalNames,
  type PersonEditFields,
  type PersonFieldPatch,
  type PersonNameDeleteInput,
  type PersonNameInsertInput,
  type PersonNameUpdateInput,
  type SaveAdditionalNamesResult,
} from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server actions for the Name & Gender, Additional Names, and Reference
 * Numbers sections (SPEC §8.3, §10 item 27). Each re-checks moderator access
 * independently — the section components never trust the page-level guard
 * alone, same posture as `inviteToClaim` in `app/moderation/actions.ts`. RLS
 * (`person_update` / `person_name_write`, both `is_moderator()`) is still the
 * real boundary; this is for a clean error message.
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
