-- One pending access_request per account, and a resolve that cannot miss.
-- Issue #49, migration `20260922180000`, SPEC §5 / §9.3.
--
-- The defect: `notify_access_requested` dedupes by account and stores the
-- FIRST request's id in the payload, while the old
-- `resolve_access_request_notifications` looked the notification up by that
-- id. Approving a SECOND pending request matched nothing, and the moderator
-- queue kept an item nobody could clear.
--
-- Two guards, because each covers a case the other cannot. The partial unique
-- index stops a second pending row appearing at all. The account_id match
-- clears a notification already stranded by the old code, on a deployment that
-- upgrades with the bad row in place.

begin;
select plan(13);

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

-- Two pending accounts and one moderator, for the resolved_by FK.
insert into auth.users (id) values
  ('49000000-0000-0000-0000-0000000000a1'),
  ('49000000-0000-0000-0000-0000000000a2'),
  ('49000000-0000-0000-0000-00000000ad01')
on conflict (id) do nothing;
insert into public.account (id, role, status)
values ('49000000-0000-0000-0000-00000000ad01', 'moderator', 'active')
on conflict (id) do update set role = excluded.role, status = excluded.status;

-- ---------------------------------------------------------------------------
-- the index itself
-- ---------------------------------------------------------------------------

-- The name is a contract. `packages/shared/src/db-constraints.ts` matches on
-- it to tell "already on file" from a real failure, and a rename that skipped
-- that file would turn a handled collision into a 500.
select has_index(
  'public', 'access_request', 'access_request_one_pending_per_account',
  'the one-pending-per-account index exists under the name the app matches on');

select is(
  (select array_agg(a.attname::text order by a.attname)
   from pg_index i
   join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indexrelid = 'public.access_request_one_pending_per_account'::regclass
     and i.indisunique),
  array['account_id'],
  'it is unique on account_id, and on nothing else');

select matches(
  (select pg_get_expr(indpred, indrelid) from pg_index
   where indexrelid = 'public.access_request_one_pending_per_account'::regclass),
  'pending',
  'it is partial on the pending status, so decided requests free the slot');

-- ---------------------------------------------------------------------------
-- what the index allows and refuses
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as('49000000-0000-0000-0000-0000000000a1');
insert into public.access_request (account_id, submitted_name)
values ('49000000-0000-0000-0000-0000000000a1', 'Ada Lovelace');

select throws_ok(
  $$insert into public.access_request (account_id, submitted_name)
    values ('49000000-0000-0000-0000-0000000000a1', 'Ada Again')$$,
  '23505',
  null,
  'a second pending request for the same account is refused');

set local role postgres;

-- A different account is unaffected.
set local role authenticated;
select pg_temp.act_as('49000000-0000-0000-0000-0000000000a2');
insert into public.access_request (account_id, submitted_name)
values ('49000000-0000-0000-0000-0000000000a2', 'Grace Hopper');
set local role postgres;

select is(
  (select count(*)::int from public.access_request where status = 'pending'),
  2,
  'each account may hold its own pending request');

-- ---------------------------------------------------------------------------
-- the regression: approving a LATER request still resolves the notification
-- ---------------------------------------------------------------------------

-- Reproduce the stranded state the old code produced. The account's
-- notification carries an access_request_id that belongs to an earlier,
-- already-resolved request -- exactly what `notify_access_requested`'s dedup
-- leaves behind. Before this migration the resolve matched on that id and
-- missed the row a moderator actually decided.
update public.notification
set payload = payload || jsonb_build_object(
  'access_request_id', '49000000-0000-0000-0000-00000000dead')
where type = 'access_requested'
  and payload ->> 'account_id' = '49000000-0000-0000-0000-0000000000a1';

select is(
  (select payload ->> 'access_request_id' from public.notification
   where type = 'access_requested'
     and payload ->> 'account_id' = '49000000-0000-0000-0000-0000000000a1'),
  '49000000-0000-0000-0000-00000000dead',
  'the notification names a request that is not the one about to be decided');

select isnt(
  (select id::text from public.access_request
   where account_id = '49000000-0000-0000-0000-0000000000a1'),
  '49000000-0000-0000-0000-00000000dead',
  'the live request has a different id, which is the whole defect');

update public.access_request
set status = 'approved', resolved_by = '49000000-0000-0000-0000-00000000ad01'
where account_id = '49000000-0000-0000-0000-0000000000a1';

select is(
  (select count(*)::int from public.notification
   where resolved_at is null
     and payload ->> 'account_id' = '49000000-0000-0000-0000-0000000000a1'),
  0,
  'the notification resolves even though the payload names another request');

select is(
  (select resolved_by::text from public.notification
   where payload ->> 'account_id' = '49000000-0000-0000-0000-0000000000a1'),
  '49000000-0000-0000-0000-00000000ad01',
  'resolved_by still comes from the access_request''s own column');

-- The other account's open notification was not swept up.
select is(
  (select count(*)::int from public.notification
   where resolved_at is null
     and payload ->> 'account_id' = '49000000-0000-0000-0000-0000000000a2'),
  1,
  'a decision on one account leaves another account''s notification open');

-- ---------------------------------------------------------------------------
-- the slot frees up once the request is resolved
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as('49000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$insert into public.access_request (account_id, submitted_name)
    values ('49000000-0000-0000-0000-0000000000a1', 'Ada Once More')$$,
  'a new request is allowed after the previous one was decided');
set local role postgres;

-- ---------------------------------------------------------------------------
-- the migration's one-time backfill predicate
-- ---------------------------------------------------------------------------

-- Step 4 of `20260922180000` releases notifications the OLD code stranded past
-- any future trigger: every request for the account was decided while an
-- 'access_requested' notification stayed open. The statement runs once, at
-- migration time, so what is worth pinning here is the predicate -- it must
-- not sweep up an account that legitimately has a request waiting.
--
-- a2 still has its pending request. a1's are all decided, and gets a stranded
-- notification planted the way the old resolve would have left one.
insert into public.notification (type, payload)
values (
  'access_requested',
  jsonb_build_object(
    'account_id', '49000000-0000-0000-0000-0000000000a1',
    'access_request_id', '49000000-0000-0000-0000-00000000beef')
);

update public.access_request
set status = 'rejected', resolved_by = '49000000-0000-0000-0000-00000000ad01'
where account_id = '49000000-0000-0000-0000-0000000000a1'
  and status = 'pending';

-- The same statement the migration runs.
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

select is(
  (select count(*)::int from public.notification
   where resolved_at is null
     and type = 'access_requested'
     and payload ->> 'account_id' = '49000000-0000-0000-0000-0000000000a1'),
  0,
  'the backfill releases a notification no future decision could reach');

select is(
  (select count(*)::int from public.notification
   where resolved_at is null
     and type = 'access_requested'
     and payload ->> 'account_id' = '49000000-0000-0000-0000-0000000000a2'),
  1,
  'the backfill leaves an account whose request is still pending alone');

select * from finish();
rollback;
