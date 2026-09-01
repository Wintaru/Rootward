"use server";

import { revalidatePath } from "next/cache";

import { resolveSettingsAccess } from "@/lib/auth/require-moderator";
import {
  changeAccountRole,
  isAccountRole,
  personExists,
  setAccountStatus,
  updateTreeSettings,
} from "@/lib/db";
import {
  type RawTreeSettingsInput,
  validateTreeSettingsForm,
} from "@/lib/settings/tree-settings-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Shared result shape for every `/settings` action. */
export type SettingsActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/** Save the singleton `tree_settings` row (SPEC §4.6, §10 item 37). No
 * version check — decision 26's concurrency-token list does not name
 * `tree_settings` (see `lib/db/tree-settings.ts`'s `updateTreeSettings`
 * doc). */
export async function saveTreeSettingsAction(
  raw: RawTreeSettingsInput,
): Promise<SettingsActionResult> {
  const access = await resolveSettingsAccess();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You do not have permission to do that." };
  }

  const validation = validateTreeSettingsForm(raw);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const patch = validation.value;

  const server = await createSupabaseServerClient();
  if (
    patch.defaultRootPersonId !== null &&
    !(await personExists(server, patch.defaultRootPersonId))
  ) {
    return { ok: false, error: "No person with that ID is visible to you." };
  }

  await updateTreeSettings(server, { ...patch, updatedBy: access.userId });
  revalidatePath("/settings");
  return { ok: true };
}

/** Change an account's role. Admin-only, and never the caller's own account
 * — an admin who demotes themselves with no other admin online would leave
 * the tree with no one who can reach `/settings` to undo it (RLS's
 * `is_admin()` boundary has no recovery path but a raw SQL fix). */
export async function changeAccountRoleAction(
  accountId: string,
  role: string,
): Promise<SettingsActionResult> {
  const access = await resolveSettingsAccess();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (accountId === access.userId) {
    return { ok: false, error: "You cannot change your own role." };
  }
  if (!isAccountRole(role)) {
    return { ok: false, error: "Choose a valid role." };
  }

  const server = await createSupabaseServerClient();
  const result = await changeAccountRole(server, { accountId, role });
  if (!result.ok) {
    return { ok: false, error: "That account no longer exists." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Suspend or reactivate an account. Admin-only, and never the caller's own
 * account — same self-lockout reasoning as {@link changeAccountRoleAction}. */
export async function setAccountStatusAction(
  accountId: string,
  status: "active" | "suspended",
): Promise<SettingsActionResult> {
  const access = await resolveSettingsAccess();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (accountId === access.userId) {
    return {
      ok: false,
      error:
        status === "suspended"
          ? "You cannot suspend your own account."
          : "You cannot reactivate your own account.",
    };
  }

  const server = await createSupabaseServerClient();
  const result = await setAccountStatus(server, { accountId, status });
  if (!result.ok) {
    return { ok: false, error: "That account no longer exists." };
  }
  revalidatePath("/settings");
  return { ok: true };
}
