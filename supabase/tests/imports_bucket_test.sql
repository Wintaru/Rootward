-- Storage: allow/deny for the private `imports` bucket (issue #16).
--
-- The gedcom-import function reads under the service role (BYPASSRLS); these
-- assertions cover the upload path the `/import` UI uses with the moderator's
-- own session, plus the defense-in-depth object policy: only an active
-- moderator may see or write an `imports` object; approved members and anon get
-- nothing. Mirrors exports_bucket_test.sql.

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
  ('a0000000-0000-0000-0000-0000000000f2'),  -- approved viewer
  ('a0000000-0000-0000-0000-0000000000f3');  -- suspended moderator
-- on_auth_user_created (issue #17) already made a pending viewer per user above.
insert into public.account (id, role, status) values
  ('a0000000-0000-0000-0000-0000000000f1', 'moderator', 'active'),
  ('a0000000-0000-0000-0000-0000000000f2', 'viewer',    'active'),
  ('a0000000-0000-0000-0000-0000000000f3', 'moderator', 'suspended')
on conflict (id) do update set role = excluded.role, status = excluded.status;

-- A pre-existing object so the SELECT-deny assertions target a real row.
insert into storage.objects (bucket_id, name) values ('imports', 'seed.ged');

select is(
  (select public from storage.buckets where id = 'imports'),
  false,
  'imports bucket is private'
);

set local role authenticated;

-- Moderator: can see and upload import objects.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000f1');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'imports'),
  1,
  'moderator sees the imports object'
);
select is(
  pg_temp.exec_count(
    $$ insert into storage.objects (bucket_id, name) values ('imports', 'job-1.ged') $$
  ),
  1,
  'moderator can upload an imports object'
);
-- The UI uploads with upsert, so a retry is an UPDATE on the same object.
select is(
  pg_temp.exec_count(
    $$ update storage.objects set updated_at = now()
       where bucket_id = 'imports' and name = 'job-1.ged' $$
  ),
  1,
  'moderator can overwrite an imports object (upsert retry)'
);

-- Suspended moderator: is_moderator() is false, so no access.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000f3');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'imports'),
  0,
  'suspended moderator sees no imports objects'
);

-- Approved non-moderator: no read, no write.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000f2');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'imports'),
  0,
  'approved viewer sees no imports objects'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('imports', 'hack.ged') $$,
  '42501',
  null,
  'approved viewer cannot upload an imports object'
);

-- Anon.
set local role postgres;
set local role anon;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'imports'),
  0,
  'anon sees no imports objects'
);
set local role postgres;

select * from finish();
rollback;
