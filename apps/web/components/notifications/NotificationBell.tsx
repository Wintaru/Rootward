"use client";

import { Bell, Check } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getUnreadNotificationCount,
  listNotifications,
  markNotificationsRead,
  resolveNotification,
  type NotificationRow,
  type NotificationStatusFilter,
} from "@/lib/db/notifications";
import {
  describeNotification,
  notificationPersonId,
} from "@/lib/notifications/format";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const STATUS_TABS: readonly {
  value: NotificationStatusFilter;
  label: string;
}[] = [
  { value: "unresolved", label: "Unresolved" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

/**
 * The moderator+ notification bell (SPEC §8.5, decision 27, issue #35).
 * `initialUnreadCount` is fetched server-side in the root layout so the badge
 * is correct on first paint; a `notification` INSERT event over Realtime
 * (SPEC §8.5's `notifications` channel -- Postgres Changes on the table, not a
 * private broadcast channel like edit-view presence, since `notification`
 * already has its own `notification_select` RLS policy that Realtime enforces
 * for an `authenticated` subscriber) bumps it live from there.
 *
 * Opening the panel fetches the current filter's page and marks every
 * unread row in it read in the same round trip -- decision 27 draws no
 * distinction between "seen the list" and "read", so there is no separate
 * per-row click-to-read affordance.
 */
export function NotificationBell({
  accountId,
  initialUnreadCount,
}: {
  readonly accountId: string;
  readonly initialUnreadCount: number;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<NotificationStatusFilter>("unresolved");
  const [notifications, setNotifications] = useState<
    readonly NotificationRow[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an out-of-order response: a quick tab switch fires a
  // second `load` before the first settles, and the network can resolve them
  // in either order. Only the most recently *requested* load is allowed to
  // write `notifications` -- a stale response is dropped instead of
  // clobbering what the current tab is showing.
  const requestIdRef = useRef(0);

  // Best-effort resync, not the source of truth for any single update -- a
  // dropped Realtime event (a reconnect gap, a tab backgrounded through a
  // socket drop) would otherwise permanently desync the badge from the +1 /
  // -N deltas below until a hard reload. Failures here are silent: the next
  // successful reconnect, tab-focus, or panel open corrects it.
  const resyncUnreadCount = useCallback(async () => {
    try {
      setUnreadCount(await getUnreadNotificationCount(supabase, accountId));
    } catch {
      // no-op -- see above
    }
  }, [supabase, accountId]);

  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notification" },
        () => setUnreadCount((count) => count + 1),
      )
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          void resyncUnreadCount();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, resyncUnreadCount]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void resyncUnreadCount();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [resyncUnreadCount]);

  const load = useCallback(
    async (nextStatus: NotificationStatusFilter) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const rows = await listNotifications(supabase, {
          accountId,
          status: nextStatus,
        });
        if (requestIdRef.current !== requestId) {
          return; // a newer load has since been requested -- drop this one
        }
        setNotifications(rows);

        const unreadIds = rows
          .filter((row) => row.readAt === null)
          .map((row) => row.id);
        if (unreadIds.length > 0) {
          await markNotificationsRead(supabase, accountId, unreadIds);
          if (requestIdRef.current === requestId) {
            setUnreadCount((count) => Math.max(count - unreadIds.length, 0));
          }
        }
      } catch (err) {
        if (requestIdRef.current === requestId) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load notifications.",
          );
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [supabase, accountId],
  );

  function toggleOpen() {
    setOpen((wasOpen) => {
      const nextOpen = !wasOpen;
      if (nextOpen) {
        void load(status);
      }
      return nextOpen;
    });
  }

  function changeStatus(nextStatus: NotificationStatusFilter) {
    setStatus(nextStatus);
    void load(nextStatus);
  }

  async function handleResolve(id: string) {
    try {
      await resolveNotification(supabase, id, accountId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not resolve notification.",
      );
      return;
    }
    setNotifications((rows) =>
      status === "unresolved"
        ? rows.filter((row) => row.id !== id)
        : rows.map((row) =>
            row.id === id
              ? { ...row, resolvedAt: new Date().toISOString() }
              : row,
          ),
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={
          unreadCount > 0
            ? `Notifications (${String(unreadCount)} unread)`
            : "Notifications"
        }
        aria-expanded={open}
        className="hover:bg-accent relative flex h-9 w-9 items-center justify-center rounded-full"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notifications"
            className="border-border bg-popover text-popover-foreground absolute right-0 z-50 mt-2 flex max-h-[70vh] w-80 flex-col rounded-lg border shadow-lg"
          >
            <div className="border-border flex gap-1 border-b p-2">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => changeStatus(tab.value)}
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    status === tab.value
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {error !== null ? (
                <p className="text-destructive p-4 text-sm">{error}</p>
              ) : loading && notifications.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">Loading…</p>
              ) : notifications.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">
                  No notifications here.
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onResolve={() => void handleResolve(notification.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onResolve,
}: {
  readonly notification: NotificationRow;
  readonly onResolve: () => void;
}) {
  const personId = notificationPersonId(notification);

  return (
    <li className="flex flex-col gap-1 p-3 text-sm">
      <p>
        {personId !== null ? (
          <Link href={`/person/${personId}`} className="hover:underline">
            {describeNotification(notification)}
          </Link>
        ) : (
          describeNotification(notification)
        )}
      </p>
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <span>{formatTimestamp(notification.createdAt)}</span>
        {notification.resolvedAt === null ? (
          <button
            type="button"
            onClick={onResolve}
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            Mark resolved
          </button>
        ) : (
          <span>Resolved</span>
        )}
      </div>
    </li>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
