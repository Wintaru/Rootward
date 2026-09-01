-- Notification center: Realtime delivery + server-side auto-resolve triggers
-- (docs/SPEC.md §8.5, §4.7, §10 item 35, WAYFINDER decision 27). Issue #35.
-- Depends on #8 (notification / notification_read / access_request tables),
-- #17 (account), #19 (notify_access_requested).
--
-- Two things land here:
--
-- 1. `notification` joins the `supabase_realtime` publication so the bell can
--    subscribe to Postgres Changes (INSERT) directly. Unlike the edit-view
--    presence channel (decision 26), this is a real table with its own RLS
--    (`notification_select`, `is_moderator()`) -- Realtime evaluates that same
--    policy for a `postgres_changes` subscription made by an `authenticated`
--    role, so no `realtime.messages` policy is needed the way presence's
--    private broadcast channel required one. Default REPLICA IDENTITY (the
--    primary key) is enough: Realtime only needs the old row for UPDATE/DELETE
--    diffing, and the bell only listens for INSERT.
--
-- 2. Two auto-resolve triggers for the two cases decision 27 names explicitly
--    ("grant access -> request resolves"; "reassign claim -> self-claim
--    notification resolves"). Both watch a table `access_request` /
--    `account` -- these auto-resolve triggers do not depend on issue #36 (the
--    moderator UI that performs those UPDATEs) to exist first: they just watch
--    for the state transition, so they light up the moment #36 starts writing
--    it. `import_finished` / `import_failed` / `hide_request` have no further
--    triggering action to auto-resolve on (decision 27: "manual resolve for
--    events with no single trigger") -- the frontend's manual "mark resolved"
--    button covers those, going through the existing `notification_update`
--    RLS policy directly, no new SQL needed for it.

-- `publish` (insert/update/delete/truncate) is a whole-publication option in
-- Postgres, not settable per table on ADD TABLE -- confirmed against the
-- local server (`ALTER PUBLICATION ... ADD TABLE t WITH (publish = ...)` is a
-- syntax error; `pg_publication.pubinsert` etc. are publication-level
-- columns, not per-table). Narrowing `supabase_realtime` to insert-only would
-- affect every table ever added to it, not just this one, so it stays at the
-- default (all four) rather than reaching for a mechanism that does not exist
-- at this granularity. The bell's own subscription already filters to INSERT
-- (`NotificationBell.tsx`), so the extra event types are simply unsent to it.
alter publication supabase_realtime add table public.notification;

-- ---------------------------------------------------------------------------
-- resolve_access_request_notifications -- AFTER UPDATE on access_request
--
-- Fires when `status` leaves 'pending' (approve or reject -- #36). Resolves
-- the linked 'access_requested' notification (payload carries the exact
-- `access_request_id`, set by `notify_access_requested`) and any open
-- 'claim_attempt_cap' notification for the same account -- the #18 rate-limit
-- path raises that notification in the same breath as the access_request it
-- files, so resolving the request closes both queue items for that account
-- (matched by `account_id`, not a row id -- `claim_attempt_cap`'s payload
-- carries no `access_request_id`; see `supabase/functions/onboarding-match/matcher.ts`).
-- `resolved_by` comes from the row's own column (SPEC §4.7), set by whichever
-- moderator/admin performed the UPDATE -- not `auth.uid()`, so this works
-- whether #36 turns out to be a direct client write or a service-role action.
--
-- SECURITY DEFINER: no role holds an UPDATE grant on `notification` beyond
-- what `notification_update` RLS (`is_moderator()`) already allows the acting
-- moderator directly, but this keeps the same "trigger writes notification
-- itself" shape as `notify_access_requested`, robust to whichever path #36
-- takes. search_path = '' so every reference is schema-qualified.
-- ---------------------------------------------------------------------------

create function public.resolve_access_request_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification
  set resolved_at = now(),
      resolved_by = new.resolved_by
  where resolved_at is null
    and (
      (type = 'access_requested' and payload ->> 'access_request_id' = new.id::text)
      or (type = 'claim_attempt_cap' and payload ->> 'account_id' = new.account_id::text)
    );

  return new;
end;
$$;

comment on function public.resolve_access_request_notifications() is
  'SPEC §5 / §5.8 / decision 27. AFTER UPDATE on access_request, when status '
  'leaves ''pending'': resolve the linked access_requested notification plus '
  'any open claim_attempt_cap notification for the same account.';

create trigger resolve_notifications_on_access_request_decided
  after update on public.access_request
  for each row
  when (old.status = 'pending' and new.status is distinct from 'pending')
  execute function public.resolve_access_request_notifications();

-- ---------------------------------------------------------------------------
-- resolve_self_claim_notification -- AFTER UPDATE on account
--
-- Fires only on a genuine reassignment: `person_id` was already set (a prior
-- self-claim or invite link) and changes to something else, including NULL
-- (an unlink). The *first* link -- self-claim (#18) or invite-accept (#20),
-- both `person_id` going from NULL -- must not fire this: there is nothing to
-- resolve yet, the self_claim_linked notification (if any) is what that same
-- flow just raised.
--
-- `account` carries no "who changed this row" column (SPEC §4.6), unlike
-- access_request's `resolved_by` -- `auth.uid()` stands in instead. This is
-- safe because `account_update` RLS is `is_admin()` only (SPEC §5): whoever
-- can reach this UPDATE at all is a signed-in admin acting as themselves, not
-- a service-role path, so `auth.uid()` names the right person.
-- ---------------------------------------------------------------------------

create function public.resolve_self_claim_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification
  set resolved_at = now(),
      resolved_by = (select auth.uid())
  where type = 'self_claim_linked'
    and resolved_at is null
    and payload ->> 'account_id' = new.id::text;

  return new;
end;
$$;

comment on function public.resolve_self_claim_notification() is
  'SPEC §5 / §9.4, decision 27. AFTER UPDATE on account, on a reassignment or '
  'unlink (person_id was already set and changes): resolve that account''s '
  'open self_claim_linked notification.';

create trigger resolve_notification_on_claim_reassigned
  after update on public.account
  for each row
  when (old.person_id is not null and new.person_id is distinct from old.person_id)
  execute function public.resolve_self_claim_notification();
