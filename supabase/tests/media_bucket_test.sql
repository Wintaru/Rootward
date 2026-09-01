-- Storage: allow/deny for the private `media` bucket (issue #33).
--
-- The media-process function reads/writes under the service role (BYPASSRLS);
-- these assertions cover the staging-upload path a moderator's own session
-- uses, plus the defense-in-depth object policy: only an active moderator may
-- see or write a `media` object; approved members and anon get nothing.
-- Mirrors imports_bucket_test.sql / exports_bucket_test.sql.

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
  ('a0000000-0000-0000-0000-0000000000e1'),  -- moderator
  ('a0000000-0000-0000-0000-0000000000e2'),  -- approved viewer
  ('a0000000-0000-0000-0000-0000000000e3');  -- suspended moderator
-- on_auth_user_created (issue #17) already made a pending viewer per user above.
insert into public.account (id, role, status) values
  ('a0000000-0000-0000-0000-0000000000e1', 'moderator', 'active'),
  ('a0000000-0000-0000-0000-0000000000e2', 'viewer',    'active'),
  ('a0000000-0000-0000-0000-0000000000e3', 'moderator', 'suspended')
on conflict (id) do update set role = excluded.role, status = excluded.status;

-- A pre-existing object so the SELECT-deny assertions target a real row.
insert into storage.objects (bucket_id, name)
values ('media', 'staging/seed.jpg');

select is(
  (select public from storage.buckets where id = 'media'),
  false,
  'media bucket is private'
);

set local role authenticated;

-- Moderator: can see and upload media objects.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000e1');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'media'),
  1,
  'moderator sees the media object'
);
select is(
  pg_temp.exec_count(
    $$ insert into storage.objects (bucket_id, name)
       values ('media', 'staging/upload-1.jpg') $$
  ),
  1,
  'moderator can upload a media staging object'
);
select is(
  pg_temp.exec_count(
    $$ insert into storage.objects (bucket_id, name)
       values ('media', 'd0000000-0000-0000-0000-000000000001/original.jpg') $$
  ),
  1,
  'moderator can write a processed media object'
);

-- Suspended moderator: is_moderator() is false, so no access.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000e3');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'media'),
  0,
  'suspended moderator sees no media objects'
);

-- Approved non-moderator: no read, no write.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000e2');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'media'),
  0,
  'approved viewer sees no media objects'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('media', 'hack.jpg') $$,
  '42501',
  null,
  'approved viewer cannot upload a media object'
);

-- Anon.
set local role postgres;
set local role anon;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'media'),
  0,
  'anon sees no media objects'
);
set local role postgres;

select * from finish();
rollback;
