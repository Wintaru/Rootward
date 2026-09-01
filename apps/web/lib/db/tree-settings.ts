import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import {
  DEFAULT_GENERATIONS_DOWN,
  DEFAULT_GENERATIONS_UP,
  clampGenerations,
} from "./neighborhood";

type Db = SupabaseClient<Database>;

/** The singleton `tree_settings` row always has id 1 (CHECK, migration #7). */
const TREE_SETTINGS_ID = 1;

/** Generations to show each way from the focus person (SPEC §8.2, §4.6). */
export interface DefaultGenerations {
  readonly up: number;
  readonly down: number;
}

/**
 * The deployment's default tree depth (SPEC §4.6, decisions 9 / 28). The tree
 * view starts here; a visitor overrides it for their session with the depth
 * control (issue #23). Falls back to the {@link DEFAULT_GENERATIONS_UP} /
 * {@link DEFAULT_GENERATIONS_DOWN} column defaults if the row is missing, and
 * clamps to `0..MAX_GENERATIONS` so a bad settings value cannot ask the
 * `get_neighborhood` function for more than it returns.
 */
export async function getDefaultGenerations(
  client: Db,
): Promise<DefaultGenerations> {
  const { data, error } = await client
    .from("tree_settings")
    .select("default_generations_up, default_generations_down")
    .eq("id", TREE_SETTINGS_ID)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getDefaultGenerations: ${error.message}`);
  }

  return {
    up: clampGenerations(
      data?.default_generations_up ?? DEFAULT_GENERATIONS_UP,
    ),
    down: clampGenerations(
      data?.default_generations_down ?? DEFAULT_GENERATIONS_DOWN,
    ),
  };
}

/**
 * The person the tree view opens on (SPEC §4.6, decision 21). `null` on a fresh
 * deployment with no data yet. Any signed-in account may read `tree_settings`
 * (RLS `tree_settings_select`).
 */
export async function getDefaultRootPersonId(
  client: Db,
): Promise<string | null> {
  const { data, error } = await client
    .from("tree_settings")
    .select("default_root_person_id")
    .eq("id", TREE_SETTINGS_ID)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getDefaultRootPersonId: ${error.message}`);
  }
  return data?.default_root_person_id ?? null;
}

/**
 * Whether the self-claim path is offered on `/onboarding` (SPEC §9.3,
 * decision 12). `false` on an invite-only tree — the claim flow is hidden and
 * only the request-access form shows. Defaults to `true` if the row is somehow
 * missing, matching the column default.
 */
export async function getAllowSelfSignup(client: Db): Promise<boolean> {
  const { data, error } = await client
    .from("tree_settings")
    .select("allow_self_signup")
    .eq("id", TREE_SETTINGS_ID)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getAllowSelfSignup: ${error.message}`);
  }
  return data?.allow_self_signup ?? true;
}

/** The full editable `tree_settings` row for the `/settings` admin form
 * (SPEC §4.6, §10 item 37). Post-MVP columns (`backup_*`) are left out —
 * the form hides that section entirely (decision 29 is not built yet). */
export interface TreeSettings {
  readonly treeName: string | null;
  readonly treeDescription: string | null;
  readonly allowSelfSignup: boolean;
  readonly livingThresholdYears: number;
  readonly defaultRootPersonId: string | null;
  readonly defaultGenerationsUp: number;
  readonly defaultGenerationsDown: number;
  readonly mediaMaxBytes: number;
  readonly mediaAllowedMime: readonly string[];
  readonly stripExifGps: boolean;
  readonly updatedAt: string;
}

const TREE_SETTINGS_COLUMNS =
  "tree_name, tree_description, allow_self_signup, living_threshold_years, default_root_person_id, default_generations_up, default_generations_down, media_max_bytes, media_allowed_mime, strip_exif_gps, updated_at";

/** A validated set of `tree_settings` field values, ready to write —
 * {@link TreeSettings} minus `updatedAt` (server-set on every write, never
 * client-supplied). Owned by the data layer so `lib/settings/tree-settings-form.ts`'s
 * pure validator can import this shape rather than the db layer depending on
 * a feature module (the reverse of every other `lib/db` ↔ `lib/<feature>`
 * pairing in the app — see `lib/moderation/invite.ts` importing `AccountRole`
 * from here for the pattern this follows). */
export type TreeSettingsPatch = Omit<TreeSettings, "updatedAt">;

/**
 * The full row, for the settings form to populate itself from. Unlike the
 * narrower getters above (which tolerate a missing row by falling back to the
 * column defaults, for a reader that may run before an admin has touched
 * anything), the singleton is guaranteed by migration #7's seed + the
 * `id = 1` CHECK — a missing row here is a genuine invariant violation, not
 * "nothing set yet", so `.single()` throws rather than handing the form
 * fallback values an admin could silently save over a broken deployment.
 */
export async function getTreeSettings(client: Db): Promise<TreeSettings> {
  const { data, error } = await client
    .from("tree_settings")
    .select(TREE_SETTINGS_COLUMNS)
    .eq("id", TREE_SETTINGS_ID)
    .single();

  if (error !== null) {
    throw new Error(`getTreeSettings: ${error.message}`);
  }

  return {
    treeName: data.tree_name,
    treeDescription: data.tree_description,
    allowSelfSignup: data.allow_self_signup,
    livingThresholdYears: data.living_threshold_years,
    defaultRootPersonId: data.default_root_person_id,
    defaultGenerationsUp: data.default_generations_up,
    defaultGenerationsDown: data.default_generations_down,
    mediaMaxBytes: data.media_max_bytes,
    mediaAllowedMime: data.media_allowed_mime,
    stripExifGps: data.strip_exif_gps,
    updatedAt: data.updated_at,
  };
}

/**
 * Persist a validated {@link TreeSettingsPatch} (SPEC §5 `tree_settings_update`
 * is `is_admin()`, no version check — decision 26's concurrency-token list
 * stops at the genealogy tables and does not name `tree_settings`). The
 * `id = 1` filter is what keeps the singleton CHECK meaningful: this can only
 * ever touch the one row.
 */
export async function updateTreeSettings(
  client: Db,
  args: TreeSettingsPatch & { readonly updatedBy: string },
): Promise<void> {
  const { error } = await client
    .from("tree_settings")
    .update({
      tree_name: args.treeName,
      tree_description: args.treeDescription,
      allow_self_signup: args.allowSelfSignup,
      living_threshold_years: args.livingThresholdYears,
      default_root_person_id: args.defaultRootPersonId,
      default_generations_up: args.defaultGenerationsUp,
      default_generations_down: args.defaultGenerationsDown,
      media_max_bytes: args.mediaMaxBytes,
      media_allowed_mime: [...args.mediaAllowedMime],
      strip_exif_gps: args.stripExifGps,
      updated_by: args.updatedBy,
    })
    .eq("id", TREE_SETTINGS_ID);

  if (error !== null) {
    throw new Error(`updateTreeSettings: ${error.message}`);
  }
}
