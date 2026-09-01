import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "./database.types";
import type { NotificationType } from "./types";

type Db = SupabaseClient<Database>;
type NotificationInsert = Database["public"]["Tables"]["notification"]["Row"];
type NotificationReadInsert =
  Database["public"]["Tables"]["notification_read"]["Insert"];

/**
 * The moderator notification queue (SPEC §4.7, §8.5, decision 27). Read state
 * is per-user (`notification_read`); "resolved" is global on the row itself,
 * set either by the auto-resolve triggers (migration 20260901205718) or the
 * manual resolve action below.
 */
export type NotificationStatusFilter = "unresolved" | "resolved" | "all";

export interface NotificationRow {
  readonly id: string;
  readonly type: NotificationType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  /** `null` until the caller's own {@link markNotificationsRead} call. */
  readonly readAt: string | null;
}

const NOTIFICATION_COLUMNS = "id, type, payload, created_at, resolved_at";

type NotificationQueryRow = Pick<
  NotificationInsert,
  "id" | "type" | "payload" | "created_at" | "resolved_at"
>;

function asPayloadRecord(raw: Json): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw
    : {};
}

/**
 * `notification` has no per-row RLS beyond "is a moderator" (SPEC §5) -- every
 * approved moderator sees the same table, so the unread count is exactly
 * `total notification rows - this account's notification_read rows`. No extra
 * SQL function needed: both counts already run through the same RLS-scoped
 * client, so they can never disagree about which rows exist.
 */
export async function getUnreadNotificationCount(
  client: Db,
  accountId: string,
): Promise<number> {
  const [totalResult, readResult] = await Promise.all([
    client.from("notification").select("*", { count: "exact", head: true }),
    client
      .from("notification_read")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId),
  ]);

  if (totalResult.error !== null) {
    throw new Error(`getUnreadNotificationCount: ${totalResult.error.message}`);
  }
  if (readResult.error !== null) {
    throw new Error(`getUnreadNotificationCount: ${readResult.error.message}`);
  }

  return Math.max((totalResult.count ?? 0) - (readResult.count ?? 0), 0);
}

/**
 * The notification list (SPEC §8.5, decision 27: "view defaults to unresolved,
 * with filters for resolved and all"). Two round trips, not one per row: the
 * page of `notification` rows, then this account's `notification_read` rows for
 * just those ids, merged in memory.
 */
export async function listNotifications(
  client: Db,
  args: {
    readonly accountId: string;
    readonly status: NotificationStatusFilter;
    readonly limit?: number;
  },
): Promise<readonly NotificationRow[]> {
  let query = client
    .from("notification")
    .select(NOTIFICATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 30);

  if (args.status === "unresolved") {
    query = query.is("resolved_at", null);
  } else if (args.status === "resolved") {
    query = query.not("resolved_at", "is", null);
  }

  const { data, error } = await query;
  if (error !== null) {
    throw new Error(`listNotifications: ${error.message}`);
  }
  const rows = data as readonly NotificationQueryRow[];

  const ids = rows.map((row) => row.id);
  const readAtById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: reads, error: readsError } = await client
      .from("notification_read")
      .select("notification_id, read_at")
      .eq("account_id", args.accountId)
      .in("notification_id", ids);
    if (readsError !== null) {
      throw new Error(`listNotifications: ${readsError.message}`);
    }
    for (const read of reads) {
      readAtById.set(read.notification_id, read.read_at);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    payload: asPayloadRecord(row.payload),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    readAt: readAtById.get(row.id) ?? null,
  }));
}

/**
 * Mark a batch of notifications read for the caller's own account (RLS
 * `notification_read_write`: own `account_id` only). `ignoreDuplicates` makes
 * re-marking an already-read notification a no-op rather than a conflict.
 */
export async function markNotificationsRead(
  client: Db,
  accountId: string,
  notificationIds: readonly string[],
): Promise<void> {
  if (notificationIds.length === 0) {
    return;
  }
  const rows: NotificationReadInsert[] = notificationIds.map((id) => ({
    notification_id: id,
    account_id: accountId,
  }));
  const { error } = await client.from("notification_read").upsert(rows, {
    onConflict: "notification_id,account_id",
    ignoreDuplicates: true,
  });
  if (error !== null) {
    throw new Error(`markNotificationsRead: ${error.message}`);
  }
}

/**
 * Manual resolve (decision 27: "manual resolve for events with no single
 * trigger" -- `import_finished` / `import_failed` / `hide_request` have no
 * further action to auto-resolve on). Goes through `notification_update` RLS
 * directly (`is_moderator()`); the `is null` guard makes a double-click a
 * no-op rather than clobbering an already-recorded `resolved_by`.
 */
export async function resolveNotification(
  client: Db,
  notificationId: string,
  resolvedByAccountId: string,
): Promise<void> {
  const { error } = await client
    .from("notification")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedByAccountId,
    })
    .eq("id", notificationId)
    .is("resolved_at", null);
  if (error !== null) {
    throw new Error(`resolveNotification: ${notificationId}: ${error.message}`);
  }
}
