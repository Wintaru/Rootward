-- Notification center: Realtime publication + the two auto-resolve triggers
-- (migration 20260901205718). Issue #35, SPEC §5 / §8.5, decision 27.
--
-- The moderator-queue notification list / bell (apps/web) is not exercised
-- here -- this covers the server-side contract: `notification` is Realtime-
-- enabled, and the two documented auto-resolve cases actually resolve the
-- right row(s) and nothing else.

begin;
select plan(17);

create function pg_temp.act_as(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- Fixtures: two pending self-claim accounts, one admin (also satisfies
-- is_moderator()), and two people to reassign / unlink between.
insert into auth.users (id) values
  ('d9100000-0000-0000-0000-0000000000a1'),
  ('d9100000-0000-0000-0000-0000000000a2'),
  ('d9100000-0000-0000-0000-00000000ad01')
on conflict (id) do nothing;
insert into public.account (id, role, status)
values ('d9100000-0000-0000-0000-00000000ad01', 'admin', 'active')
on conflict (id) do update set role = excluded.role, status = excluded.status;
insert into public.person (id) values
  ('d9100000-0000-0000-0000-0000000000e1'),
  ('d9100000-0000-0000-0000-0000000000e2'),
  ('d9100000-0000-0000-0000-0000000000e3');

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification'
  ),
  'notification is in the supabase_realtime publication');

-- ---------------------------------------------------------------------------
-- resolve_access_request_notifications -- shape
-- ---------------------------------------------------------------------------

select is(
  (select prosecdef from pg_proc
   where proname = 'resolve_access_request_notifications'),
  true,
  'resolve_access_request_notifications is SECURITY DEFINER');

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.access_request'::regclass
      and not tgisinternal
      and tgname = 'resolve_notifications_on_access_request_decided'
  ),
  'the trigger is wired on access_request');

-- ---------------------------------------------------------------------------
-- resolve_access_request_notifications -- behaviour
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as('d9100000-0000-0000-0000-0000000000a1');
insert into public.access_request (account_id, submitted_name)
values ('d9100000-0000-0000-0000-0000000000a1', 'Ada Lovelace');
set local role postgres;

-- Simulate #18's cap path: its own claim_attempt_cap notification, raised
-- alongside the access_request above, no access_request_id in its payload.
insert into public.notification (type, payload)
values (
  'claim_attempt_cap',
  jsonb_build_object('account_id', 'd9100000-0000-0000-0000-0000000000a1')
);

select is(
  (select count(*)::int from public.notification
   where resolved_at is null
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a1'),
  2,
  'both an access_requested and a claim_attempt_cap notification are open');

update public.access_request
set status = 'approved', resolved_by = 'd9100000-0000-0000-0000-00000000ad01'
where account_id = 'd9100000-0000-0000-0000-0000000000a1';

select is(
  (select count(*)::int from public.notification
   where resolved_at is null
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a1'),
  0,
  'approving the access_request resolves both notifications');

select is(
  (select array_agg(distinct resolved_by) from public.notification
   where payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a1'),
  array['d9100000-0000-0000-0000-00000000ad01'::uuid],
  'resolved_by on both rows comes from the access_request''s own resolved_by column');

-- Rejecting also resolves (not just approving).
insert into public.access_request (account_id, submitted_name)
values ('d9100000-0000-0000-0000-0000000000a2', 'Grace Hopper');

select is(
  (select count(*)::int from public.notification
   where type = 'access_requested' and resolved_at is null
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a2'),
  1,
  'a fresh access_request for a second account raises its own notification');

update public.access_request
set status = 'rejected', resolved_by = 'd9100000-0000-0000-0000-00000000ad01'
where account_id = 'd9100000-0000-0000-0000-0000000000a2';

select is(
  (select resolved_at is not null from public.notification
   where type = 'access_requested'
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a2'),
  true,
  'rejecting an access_request resolves its notification too');

-- The first account's already-resolved notifications were untouched by the
-- second account's decision.
select is(
  (select count(*)::int from public.notification
   where resolved_at is null
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a1'),
  0,
  'a different account''s decision does not reopen or duplicate anything');

-- ---------------------------------------------------------------------------
-- resolve_self_claim_notification -- shape
-- ---------------------------------------------------------------------------

select is(
  (select prosecdef from pg_proc
   where proname = 'resolve_self_claim_notification'),
  true,
  'resolve_self_claim_notification is SECURITY DEFINER');

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.account'::regclass
      and not tgisinternal
      and tgname = 'resolve_notification_on_claim_reassigned'
  ),
  'the trigger is wired on account');

-- ---------------------------------------------------------------------------
-- resolve_self_claim_notification -- behaviour
-- ---------------------------------------------------------------------------

-- The initial link (person_id null -> set) must NOT resolve anything -- that
-- is the self-claim flow itself raising the notification, not a reassignment.
insert into public.notification (type, payload)
values (
  'self_claim_linked',
  jsonb_build_object(
    'account_id', 'd9100000-0000-0000-0000-0000000000a1',
    'person_id', 'd9100000-0000-0000-0000-0000000000e1')
);

set local role authenticated;
select pg_temp.act_as('d9100000-0000-0000-0000-00000000ad01');
update public.account
set person_id = 'd9100000-0000-0000-0000-0000000000e1'
where id = 'd9100000-0000-0000-0000-0000000000a1';
set local role postgres;

select is(
  (select resolved_at from public.notification where type = 'self_claim_linked'),
  null,
  'the first link (person_id null -> set) does not resolve the notification');

-- A genuine reassignment (person_id set -> a different person) resolves it.
set local role authenticated;
select pg_temp.act_as('d9100000-0000-0000-0000-00000000ad01');
update public.account
set person_id = 'd9100000-0000-0000-0000-0000000000e2'
where id = 'd9100000-0000-0000-0000-0000000000a1';
set local role postgres;

select is(
  (select resolved_at is not null from public.notification
   where type = 'self_claim_linked'
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a1'),
  true,
  'reassigning person_id resolves the self_claim_linked notification');

select is(
  (select resolved_by from public.notification
   where type = 'self_claim_linked'
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a1'),
  'd9100000-0000-0000-0000-00000000ad01'::uuid,
  'resolved_by is the acting admin (auth.uid() -- account carries no updated_by column)');

-- An unlink (person_id -> null) also counts as a reassignment for a second
-- account that never got resolved above. A different person (e3) -- e2 is
-- already claimed by account a1 above (person_id is unique).
insert into public.notification (type, payload)
values (
  'self_claim_linked',
  jsonb_build_object(
    'account_id', 'd9100000-0000-0000-0000-0000000000a2',
    'person_id', 'd9100000-0000-0000-0000-0000000000e3')
);
update public.account set person_id = 'd9100000-0000-0000-0000-0000000000e3'
where id = 'd9100000-0000-0000-0000-0000000000a2';

select is(
  (select resolved_at from public.notification
   where type = 'self_claim_linked'
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a2'),
  null,
  'a second account''s own first link still does not resolve its notification');

set local role authenticated;
select pg_temp.act_as('d9100000-0000-0000-0000-00000000ad01');
update public.account set person_id = null
where id = 'd9100000-0000-0000-0000-0000000000a2';
set local role postgres;

select is(
  (select resolved_at is not null from public.notification
   where type = 'self_claim_linked'
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a2'),
  true,
  'unlinking (person_id -> null) also resolves that account''s notification');

-- A no-op UPDATE (person_id unchanged, some other column touched) does not
-- fire the trigger at all -- guards the WHEN clause against a false trigger.
set local role authenticated;
select pg_temp.act_as('d9100000-0000-0000-0000-00000000ad01');
update public.account set display_name = 'Ada L.'
where id = 'd9100000-0000-0000-0000-0000000000a1';
set local role postgres;

select is(
  (select count(*)::int from public.notification
   where type = 'self_claim_linked'
     and payload ->> 'account_id' = 'd9100000-0000-0000-0000-0000000000a1'),
  1,
  'an unrelated column update does not duplicate or re-fire the resolve trigger');

select * from finish();
rollback;
