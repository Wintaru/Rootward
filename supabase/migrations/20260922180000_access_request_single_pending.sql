-- One pending access_request per account, and a resolve that matches the way
-- the notification was deduped. Issue #49, SPEC §5 / §9.3.
--
-- The defect, in one sentence: `notify_access_requested` dedupes by
-- `account_id` but freezes the FIRST request's id in the notification payload,
-- while `resolve_access_request_notifications` looks the notification up by
-- that exact id -- so approving a SECOND pending request for the same account
-- matches nothing and strands the notification in the moderator queue forever.
--
-- The two halves of that `where` clause already disagreed. The
-- 'claim_attempt_cap' arm matches on `account_id`, because its payload carries
-- no request id. The 'access_requested' arm matches on `access_request_id`.
-- Only the second arm can miss.
--
-- A second pending row is reachable today. `onboarding-match/gateway.ts` calls
-- `hasOpenAccessRequest` before it inserts, but that is a check-then-insert
-- with a race in the middle, and `apps/web/lib/db/onboarding.ts`'s
-- `submitAccessRequest` has no guard at all. Nothing in the schema stopped it:
-- before this migration `access_request` carried only its primary key and two
-- non-unique indexes.
--
-- Two changes, because each one alone leaves a hole:
--
--   1. A partial unique index makes the second pending row impossible, which
--      closes the gateway's race as well as the unguarded web path. This is
--      the "make illegal states unrepresentable" half -- the application can
--      no longer create the state the resolve step cannot handle.
--   2. The resolve matches 'access_requested' by `account_id`, the same way it
--      already matches 'claim_attempt_cap' and the same way the notification
--      was deduped in the first place. This repairs every account that still
--      has a pending request, because its next decision now matches.
--   3. A one-time backfill closes the case step 2 cannot reach: an account
--      whose requests were ALL decided while a notification stayed open has no
--      future UPDATE left to fire the trigger. See step 4.
--
-- Existing duplicates are collapsed rather than deleted. The newest pending row
-- survives because it carries the person's most recent message. Older ones move
-- to 'rejected' with `resolved_at` set and `resolved_by` left NULL -- a NULL
-- resolver is what distinguishes this system collapse from a moderator's
-- decision, which SPEC §4.7 always attributes. The collapse runs with the
-- resolve trigger disabled, so it cannot resolve the account's live
-- notification on the way past: that account still has an open request.

-- --- 1. collapse any existing duplicates ----------------------------------

-- No `lock table` here, deliberately. A SHARE lock would close the window
-- between the collapse below and the index build -- a client committing a
-- second pending row in between fails the build and rolls the migration back.
-- But `supabase start` replays migrations with autocommit, one statement per
-- transaction, and `LOCK TABLE` outside a transaction block is an error
-- (25P01). It would work under `supabase db push`, which wraps the file, and
-- fail every local stack and every CI run.
--
-- Wrapping this file in an explicit `begin`/`commit` would buy the lock back,
-- and no other migration here does that. The window it protects is a client
-- writing to `access_request` during a schema migration, and the cost of
-- losing that race is a failed migration that succeeds on a re-run. Not worth
-- diverging for.

alter table public.access_request
  disable trigger resolve_notifications_on_access_request_decided;

with ranked as (
  select id,
         row_number() over (
           partition by account_id
           order by created_at desc, id desc
         ) as rn
  from public.access_request
  where status = 'pending'
)
update public.access_request as ar
set status = 'rejected',
    resolved_at = now()
from ranked
where ar.id = ranked.id
  and ranked.rn > 1;

alter table public.access_request
  enable trigger resolve_notifications_on_access_request_decided;

-- --- 2. make a second pending row impossible -------------------------------

create unique index access_request_one_pending_per_account
  on public.access_request (account_id)
  where status = 'pending';

comment on index public.access_request_one_pending_per_account is
  'Issue #49. One open request per account. The moderator queue shows one '
  'notification per account, so a second pending row has no way to be seen '
  'and its approval used to strand the first row''s notification.';

-- --- 3. resolve by account, like the claim_attempt_cap arm already does -----

create or replace function public.resolve_access_request_notifications()
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
    and payload ->> 'account_id' = new.account_id::text
    and type in ('access_requested', 'claim_attempt_cap');

  return new;
end;
$$;

comment on function public.resolve_access_request_notifications() is
  'SPEC §5 / §5.8 / decision 27, issue #49. AFTER UPDATE on access_request, '
  'when status leaves ''pending'': resolve every open access_requested and '
  'claim_attempt_cap notification for that account. Matches on account_id, '
  'not on a row id -- notify_access_requested dedupes per account, so the '
  'payload''s access_request_id names only the first request and misses when '
  'a later one is the row a moderator decides.';

-- --- 4. release the notifications the old code already stranded ------------

-- Step 3 repairs every account that still has a pending request, because the
-- next decision now matches. It cannot reach the worst case in the issue: two
-- requests open, the second approved (stranding the first's notification), the
-- first then decided as well. Every request for that account is now resolved,
-- so no future UPDATE will ever fire the trigger, and the notification would
-- sit in the queue forever.
--
-- An open 'access_requested' notification for an account with no pending
-- request is exactly that state, and it has no other legitimate cause: the
-- notification is raised by an INSERT of a pending row, and any path out of
-- 'pending' resolves it. `resolved_by` stays NULL, the same way the collapse
-- above marks a decision no moderator made.
--
-- Compared as text on both sides. The payload is JSON and a cast would fail on
-- a hand-seeded value rather than simply not matching.
update public.notification as n
set resolved_at = now()
where n.resolved_at is null
  and n.type = 'access_requested'
  and not exists (
    select 1
    from public.access_request as ar
    where ar.account_id::text = n.payload ->> 'account_id'
      and ar.status = 'pending'
  );
