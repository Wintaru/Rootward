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
