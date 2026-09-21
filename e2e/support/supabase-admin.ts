import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

// Type-only, by relative path: the suite gets the same row and column types
// the app has without taking a package dependency on `apps/web`, and
// `verbatimModuleSyntax` erases the import, so nothing is loaded at runtime.
import type { Database } from "../../apps/web/lib/db/database.types";

import { env } from "./env";

/**
 * Service-role access to the local stack, for the parts of a test that are
 * setup rather than the thing under test: making an account, giving it a
 * role, and cleaning up afterwards.
 *
 * It bypasses RLS on purpose. Never use it to assert what a member can see —
 * that is exactly what the suite is checking, and it must be read through the
 * app under the member's own session.
 */
export const admin = createClient<Database>(
  env.supabaseUrl,
  env.serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export type AccountRole = "viewer" | "moderator" | "admin";
export type AccountStatus = "active" | "pending" | "suspended";

export type TestUser = {
  readonly email: string;
  readonly userId: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly displayName: string;
};

type UserSpec = {
  readonly email: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly displayName: string;
  /** Link the account to this person, as a claimed record would be. */
  readonly personId?: string | null;
};

async function findUserIdByEmail(email: string): Promise<string | null> {
  // `listUsers` is paginated; the local stack holds few users, but page
  // through anyway rather than assume the first page is everything.
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error !== null) {
      throw new Error(`listUsers failed: ${error.message}`);
    }
    const match = data.users.find(
      (user) => (user.email ?? "").toLowerCase() === target,
    );
    if (match !== undefined) {
      return match.id;
    }
    if (data.users.length < 200) {
      return null;
    }
  }
  return null;
}

/**
 * Create (or reset) one test account and put its `public.account` row in the
 * requested state. `on_auth_user_created` (SPEC §9.1) makes the row; this
 * only moves it to the role/status the test needs.
 */
export async function ensureTestUser(spec: UserSpec): Promise<TestUser> {
  const existing = await findUserIdByEmail(spec.email);
  if (existing !== null) {
    // Start from a clean auth user every run: a left-over session, a stale
    // `person_id`, or a half-finished claim from a previous run would make
    // the next run's assertions depend on history.
    const { error } = await admin.auth.admin.deleteUser(existing);
    if (error !== null) {
      throw new Error(`deleteUser(${spec.email}) failed: ${error.message}`);
    }
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    email_confirm: true,
    user_metadata: { full_name: spec.displayName },
  });
  if (error !== null || data.user === null) {
    throw new Error(
      `createUser(${spec.email}) failed: ${error?.message ?? "no user returned"}`,
    );
  }

  const userId = data.user.id;
  const { error: updateError } = await admin
    .from("account")
    .update({
      role: spec.role,
      status: spec.status,
      display_name: spec.displayName,
      person_id: spec.personId ?? null,
    })
    .eq("id", userId);
  if (updateError !== null) {
    throw new Error(
      `account update for ${spec.email} failed: ${updateError.message}`,
    );
  }

  return {
    email: spec.email,
    userId,
    role: spec.role,
    status: spec.status,
    displayName: spec.displayName,
  };
}

/**
 * Remove an auth user (and, by cascade, its `account` row).
 *
 * "Already gone" is success, not an error: Playwright runs a describe's
 * `afterAll` once per worker that touched the file, so two workers can race
 * the same cleanup and one of them will always find nothing left to delete.
 * Any other failure still throws — a teardown that cannot delete is worth
 * hearing about.
 */
export async function deleteTestUser(email: string): Promise<void> {
  const userId = await findUserIdByEmail(email);
  if (userId === null) {
    return;
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error !== null && !isNotFound(error.message)) {
    throw new Error(`deleteUser(${email}) failed: ${error.message}`);
  }
}

/** GoTrue answers a delete for a user another caller just removed this way. */
function isNotFound(message: string): boolean {
  return message.toLowerCase().includes("not found");
}

/** Put one account back into a known role/status mid-suite. */
export async function setAccountState(
  userId: string,
  patch: Partial<{
    role: AccountRole;
    status: AccountStatus;
    person_id: string | null;
    theme: string;
    color_mode: string;
  }>,
): Promise<void> {
  const { error } = await admin.from("account").update(patch).eq("id", userId);
  if (error !== null) {
    throw new Error(`account patch failed: ${error.message}`);
  }
}

/**
 * The ids of every auth user in the suite's reserved address range.
 *
 * The teardown needs them before {@link deleteUsersByPrefix} runs: rows that
 * name an account rather than a person (an `access_requested` notification)
 * have nothing left to match on once the account is gone.
 */
export async function e2eAccountIds(): Promise<readonly string[]> {
  const ids: string[] = [];
  // Paged, not just the first 200: a developer's stack can hold more auth
  // users than one page, and a miss here leaves a notification in the bell
  // with nothing left to identify it by.
  for (let page = 1; page <= USER_PAGE_LIMIT; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: USER_PAGE_SIZE,
    });
    if (error !== null) {
      throw new Error(`listUsers failed: ${error.message}`);
    }
    for (const user of data.users) {
      if (isSuiteAddress(user.email)) {
        ids.push(user.id);
      }
    }
    if (data.users.length < USER_PAGE_SIZE) {
      return ids;
    }
  }
  throw new Error(
    `e2eAccountIds gave up after ${String(USER_PAGE_LIMIT)} pages.`,
  );
}

const USER_PAGE_SIZE = 200;
const USER_PAGE_LIMIT = 20;

/** The suite's reserved `e2e-…@rootward.test` range. */
function isSuiteAddress(email: string | undefined): boolean {
  const lower = (email ?? "").toLowerCase();
  return lower.startsWith("e2e-") && lower.endsWith("@rootward.test");
}

/**
 * Remove every auth user whose address starts with `prefix` — the suite's
 * reserved `e2e-…@rootward.test` range. Used by the teardown, which cannot
 * know every address a test caused GoTrue to create.
 */
export async function deleteUsersByPrefix(prefix: string): Promise<void> {
  const lower = prefix.toLowerCase();
  // Reserved TLD, so this can never reach a real address even if the suite
  // is pointed at the wrong stack.
  const domain = "@rootward.test";

  // Deleting shrinks the list under us, so re-read the first page until it
  // holds no more matches rather than trying to walk a moving cursor. The
  // attempt cap keeps a surprise here from becoming an infinite loop.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (error !== null) {
      throw new Error(`listUsers failed: ${error.message}`);
    }

    const doomed = data.users.filter((user) => {
      const email = (user.email ?? "").toLowerCase();
      return email.startsWith(lower) && email.endsWith(domain);
    });
    if (doomed.length === 0) {
      return;
    }
    for (const user of doomed) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteError !== null && !isNotFound(deleteError.message)) {
        throw new Error(
          `deleteUser(${user.email ?? user.id}) failed: ${deleteError.message}`,
        );
      }
    }
  }

  // Falling out of the loop means accounts kept coming back. Say so rather
  // than reporting a teardown that did not finish as a success.
  throw new Error(
    `deleteUsersByPrefix("${prefix}") gave up after 50 passes — accounts are still being created or the deletes are not taking.`,
  );
}

/** A row as the database wants it written — the shape every fixture and
 * seed helper builds. */
export type TableInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** The `tree_settings` singleton's editable columns, taken from the table's
 * own row type so the list cannot drift from the schema. */
export type TreeSettingsSnapshot = Pick<
  Database["public"]["Tables"]["tree_settings"]["Row"],
  | "tree_name"
  | "tree_description"
  | "allow_self_signup"
  | "living_threshold_years"
  | "default_root_person_id"
  | "default_generations_up"
  | "default_generations_down"
  | "media_max_bytes"
  | "media_allowed_mime"
  | "strip_exif_gps"
>;

/**
 * Read the settings singleton so a test that changes it can put the whole row
 * back, rather than restoring one field inline and leaving the rest changed
 * if it fails partway.
 */
export async function readTreeSettings(): Promise<TreeSettingsSnapshot> {
  const { data, error } = await admin
    .from("tree_settings")
    .select(
      "tree_name, tree_description, allow_self_signup, living_threshold_years, default_root_person_id, default_generations_up, default_generations_down, media_max_bytes, media_allowed_mime, strip_exif_gps",
    )
    .eq("id", 1)
    .single();
  if (error !== null || data === null) {
    throw new Error(
      `readTreeSettings failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return data;
}

/**
 * Where {@link saveSettingsSnapshot} puts the pre-run `tree_settings` row.
 *
 * On disk rather than in a module variable: `globalSetup` and
 * `globalTeardown` are separate entry points, so nothing in memory is
 * guaranteed to survive from one to the other. Same shape as the account
 * directory beside it.
 */
const SETTINGS_SNAPSHOT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.auth/tree-settings.json",
);

/** Records the settings row as it was before the run. */
export async function saveSettingsSnapshot(): Promise<void> {
  const snapshot = await readTreeSettings();
  await mkdir(dirname(SETTINGS_SNAPSHOT_PATH), { recursive: true });
  await writeFile(
    SETTINGS_SNAPSHOT_PATH,
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
}

/** The snapshot {@link saveSettingsSnapshot} wrote, or `null` when the run
 * never got that far. */
export function readSettingsSnapshot(): TreeSettingsSnapshot | null {
  if (!existsSync(SETTINGS_SNAPSHOT_PATH)) {
    return null;
  }
  return JSON.parse(
    readFileSync(SETTINGS_SNAPSHOT_PATH, "utf8"),
  ) as TreeSettingsSnapshot;
}

export async function restoreTreeSettings(
  snapshot: TreeSettingsSnapshot,
): Promise<void> {
  const { error } = await admin
    .from("tree_settings")
    .update(snapshot)
    .eq("id", 1);
  if (error !== null) {
    throw new Error(`restoreTreeSettings failed: ${error.message}`);
  }
}
