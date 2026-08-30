-- Storage: allow/deny for the private `exports` bucket (issue #15).
--
-- The gedcom-export function writes under the service role (BYPASSRLS), so these
-- assertions cover the defense-in-depth object policy: only an active moderator
-- may see or write an `exports` object; approved members and anon get nothing.
-- Mirrors the identity-switch shape of rls_test.sql -- `set local role` is what
-- makes RLS apply (pg_prove connects as the superuser).

begin;
select plan(6);

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
  ('a0000000-0000-0000-0000-0000000000e1'),  -- moderator
  ('a0000000-0000-0000-0000-0000000000e2');  -- approved viewer
insert into public.account (id, role, status) values
  ('a0000000-0000-0000-0000-0000000000e1', 'moderator', 'active'),
  ('a0000000-0000-0000-0000-0000000000e2', 'viewer',    'active');

-- A pre-existing object so the SELECT-deny assertions target a real row.
insert into storage.objects (bucket_id, name) values ('exports', 'seed.ged');

select is(
  (select public from storage.buckets where id = 'exports'),
  false,
  'exports bucket is private'
);

set local role authenticated;

-- Moderator: can see and write export objects.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000e1');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'exports'),
  1,
  'moderator sees the exports object'
);
select is(
  pg_temp.exec_count(
    $$ insert into storage.objects (bucket_id, name) values ('exports', 'job-1.ged') $$
  ),
  1,
  'moderator can write an exports object'
);

-- Approved non-moderator: no read, no write.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000e2');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'exports'),
  0,
  'approved viewer sees no exports objects'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('exports', 'hack.ged') $$,
  '42501',
  null,
  'approved viewer cannot write an exports object'
);

-- Anon.
set local role postgres;
set local role anon;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'exports'),
  0,
  'anon sees no exports objects'
);
set local role postgres;

select * from finish();
rollback;
