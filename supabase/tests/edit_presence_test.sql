-- Realtime Authorization: allow/deny for the edit-view `person:{id}` presence
-- channel (issue #32, `20260831230616_edit_presence_authorization.sql`).
--
-- The Realtime server evaluates these `realtime.messages` policies only for a
-- channel joined with `config.private = true`, and always writes the row's
-- `topic` column as the channel actually joined -- so a raw insert/select
-- against that column, as below, is what the policy actually checks. Mirrors
-- the identity-switch shape of `exports_bucket_test.sql`.

begin;
select plan(8);

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

create function pg_temp.exec_count(p_sql text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Fixtures: one moderator, one approved viewer (built as the superuser).
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-0000000000f1'),  -- moderator
  ('a0000000-0000-0000-0000-0000000000f2');  -- approved viewer
-- on_auth_user_created (issue #17) already made a pending viewer per user above.
insert into public.account (id, role, status) values
  ('a0000000-0000-0000-0000-0000000000f1', 'moderator', 'active'),
  ('a0000000-0000-0000-0000-0000000000f2', 'viewer',    'active')
on conflict (id) do update set role = excluded.role, status = excluded.status;

set local role authenticated;

-- Moderator: can track (insert) and read presence on a `person:` topic.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000f1');
select is(
  pg_temp.exec_count(
    $$ insert into realtime.messages (topic, extension) values ('person:b0000000-0000-0000-0000-000000000001', 'presence') $$
  ),
  1,
  'moderator can track presence on a person topic'
);
select is(
  (select count(*)::int from realtime.messages
     where topic = 'person:b0000000-0000-0000-0000-000000000001' and extension = 'presence'),
  1,
  'moderator can read presence on a person topic'
);

-- The topic and extension filters are enforced, not just is_moderator().
select throws_ok(
  $$ insert into realtime.messages (topic, extension) values ('tree:whatever', 'presence') $$,
  '42501',
  null,
  'moderator cannot track presence on a non-person topic'
);
select throws_ok(
  $$ insert into realtime.messages (topic, extension) values ('person:b0000000-0000-0000-0000-000000000001', 'broadcast') $$,
  '42501',
  null,
  'moderator cannot broadcast (non-presence) on a person topic via this policy'
);

-- Approved non-moderator: no read, no write -- matches the edit route's own gate.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000f2');
select is(
  (select count(*)::int from realtime.messages
     where topic = 'person:b0000000-0000-0000-0000-000000000001' and extension = 'presence'),
  0,
  'approved viewer sees no presence on a person topic'
);
select throws_ok(
  $$ insert into realtime.messages (topic, extension) values ('person:b0000000-0000-0000-0000-000000000001', 'presence') $$,
  '42501',
  null,
  'approved viewer cannot track presence on a person topic'
);

-- Anon: no read, no write.
set local role postgres;
set local role anon;
select is(
  (select count(*)::int from realtime.messages
     where topic = 'person:b0000000-0000-0000-0000-000000000001' and extension = 'presence'),
  0,
  'anon sees no presence on a person topic'
);
select throws_ok(
  $$ insert into realtime.messages (topic, extension) values ('person:b0000000-0000-0000-0000-000000000001', 'presence') $$,
  '42501',
  null,
  'anon cannot track presence on a person topic'
);
set local role postgres;

select * from finish();
rollback;
