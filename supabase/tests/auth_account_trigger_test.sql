-- on_auth_user_created: every new auth.users row gets exactly one account row.
-- Issue #17, SPEC §9.1. Covers the "exactly one account row" Done-when bullet;
-- the ADMIN_EMAIL promotion is web-tier and tested in apps/web.
--
-- Built as the superuser pg_prove connects as. Inserts into auth.users the same
-- way the storage-bucket suites do -- GoTrue is not running under pg_prove, so
-- the trigger is the only thing that reacts to the insert.

begin;
select plan(6);

-- ---------------------------------------------------------------------------
-- A bare insert (no metadata, no email) -- the shape the other pgTAP suites use.
-- ---------------------------------------------------------------------------
insert into auth.users (id) values ('c1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.account
     where id = 'c1000000-0000-0000-0000-000000000001'),
  1,
  'one account row is created for a new auth.users row');

select is(
  (select role::text from public.account
     where id = 'c1000000-0000-0000-0000-000000000001'),
  'viewer',
  'the new account defaults to role = viewer');

select is(
  (select status::text from public.account
     where id = 'c1000000-0000-0000-0000-000000000001'),
  'pending',
  'the new account defaults to status = pending');

select is(
  (select display_name from public.account
     where id = 'c1000000-0000-0000-0000-000000000001'),
  null,
  'display_name is null when the user carries no name metadata or email');

-- ---------------------------------------------------------------------------
-- display_name is taken from metadata, falling back to email.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000002', 'ada@example.com',
   '{"full_name": "Ada Lovelace"}'::jsonb),
  ('c1000000-0000-0000-0000-000000000003', 'bo@example.com', '{}'::jsonb);

select is(
  (select display_name from public.account
     where id = 'c1000000-0000-0000-0000-000000000002'),
  'Ada Lovelace',
  'display_name comes from raw_user_meta_data.full_name');

select is(
  (select display_name from public.account
     where id = 'c1000000-0000-0000-0000-000000000003'),
  'bo@example.com',
  'display_name falls back to the email when no name metadata is present');

select * from finish();
rollback;
