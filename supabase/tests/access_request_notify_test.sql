-- notify_access_requested(): the AFTER INSERT trigger on access_request that
-- feeds the moderator queue. Issue #19, SPEC §5 / §7 / §9.3.
--
-- Verifies the trigger is SECURITY DEFINER, that a caller inserting their own
-- pending access_request (RLS access_request_insert) raises exactly one
-- 'access_requested' notification with the right payload, that a second request
-- for the same account does not stack another unresolved row, and that a fresh
-- request after the first is resolved raises a new one.

begin;
select plan(9);

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

-- Fixtures (built as the superuser): two signed-in but still-pending accounts
-- (the on_auth_user_created trigger from #17 already made the account rows) and
-- one moderator, needed only for the resolved_by FK.
insert into auth.users (id) values
  ('d9000000-0000-0000-0000-0000000000f1'),
  ('d9000000-0000-0000-0000-0000000000f2'),
  ('d9000000-0000-0000-0000-00000000ad01')
on conflict (id) do nothing;
insert into public.account (id, role, status)
values ('d9000000-0000-0000-0000-00000000ad01', 'moderator', 'active')
on conflict (id) do update set role = excluded.role, status = excluded.status;

-- --- shape ---------------------------------------------------------------

select is(
  (select prosecdef from pg_proc where proname = 'notify_access_requested'),
  true,
  'notify_access_requested is SECURITY DEFINER');

select is(
  (select tgname
   from pg_trigger
   where tgrelid = 'public.access_request'::regclass
     and not tgisinternal),
  'notify_on_access_request',
  'the trigger is wired on access_request');

-- --- the happy path: a pending caller submits their own request ---------

set local role authenticated;
select pg_temp.act_as('d9000000-0000-0000-0000-0000000000f1');
insert into public.access_request (account_id, submitted_name, message)
values (
  'd9000000-0000-0000-0000-0000000000f1',
  'Ada Lovelace',
  'I am Ada, daughter of Byron.'
);
set local role postgres;

select is(
  (select count(*)::int
   from public.notification
   where type = 'access_requested'
     and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f1'),
  1,
  'inserting an access_request raises one access_requested notification');

select is(
  (select payload ->> 'submitted_name'
   from public.notification
   where type = 'access_requested'
     and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f1'),
  'Ada Lovelace',
  'the notification payload carries the submitted name');

select isnt(
  (select payload ->> 'access_request_id'
   from public.notification
   where type = 'access_requested'
     and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f1'),
  null,
  'the notification payload links back to the access_request row');

-- --- dedup: a second open request does not stack a notification --------

set local role authenticated;
select pg_temp.act_as('d9000000-0000-0000-0000-0000000000f1');
insert into public.access_request (account_id, submitted_name)
values ('d9000000-0000-0000-0000-0000000000f1', 'Ada again');
set local role postgres;

select is(
  (select count(*)::int
   from public.notification
   where type = 'access_requested'
     and resolved_at is null
     and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f1'),
  1,
  'a second access_request for the same account does not stack a notification');

-- Resolve the open one, then a new request raises a fresh notification.
update public.notification
set resolved_at = now(),
    resolved_by = 'd9000000-0000-0000-0000-00000000ad01'
where type = 'access_requested'
  and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f1';

set local role authenticated;
select pg_temp.act_as('d9000000-0000-0000-0000-0000000000f1');
insert into public.access_request (account_id, submitted_name)
values ('d9000000-0000-0000-0000-0000000000f1', 'Ada third time');
set local role postgres;

select is(
  (select count(*)::int
   from public.notification
   where type = 'access_requested'
     and resolved_at is null
     and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f1'),
  1,
  'a new request after the first is resolved raises a fresh notification');

select is(
  (select count(*)::int
   from public.notification
   where type = 'access_requested'
     and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f1'),
  2,
  'two access_requested notifications total: one resolved, one open');

-- --- a different account is independent -------------------------------

set local role authenticated;
select pg_temp.act_as('d9000000-0000-0000-0000-0000000000f2');
insert into public.access_request (account_id, submitted_name)
values ('d9000000-0000-0000-0000-0000000000f2', 'Grace Hopper');
set local role postgres;

select is(
  (select count(*)::int
   from public.notification
   where type = 'access_requested'
     and resolved_at is null
     and payload ->> 'account_id' = 'd9000000-0000-0000-0000-0000000000f2'),
  1,
  'a request from another account raises its own notification');

select * from finish();
rollback;
