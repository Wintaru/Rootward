-- account.theme / account.color_mode + set_appearance(theme, mode): the
-- per-member appearance preference (SPEC §8.1, decision 38). Issue #80,
-- migration 20260920184900.
--
-- Same harness style as request_hide_test.sql: isolated fixtures built as
-- the superuser pg_prove connects as, identity switched with a fake JWT.
-- Every deny assertion targets a fixture row that genuinely exists, so a
-- 0-row result cannot pass vacuously.

begin;
select plan(16);

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

-- Runs a write as the current role (RLS applies) and returns its row count.
create function pg_temp.exec_count(p_sql text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: a viewer, a pending viewer, and an admin.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('70000000-0000-0000-0000-000000000001'),  -- viewer
  ('70000000-0000-0000-0000-000000000002'),  -- pending
  ('70000000-0000-0000-0000-000000000003');  -- admin

-- on_auth_user_created (#17) already inserted a pending/viewer row per
-- auth.users id above; upsert it into shape rather than a bare insert.
insert into public.account (id, role, status) values
  ('70000000-0000-0000-0000-000000000001', 'viewer', 'active'),
  ('70000000-0000-0000-0000-000000000002', 'viewer', 'pending'),
  ('70000000-0000-0000-0000-000000000003', 'admin',  'active')
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status;

-- --- shape -----------------------------------------------------------------

select is(
  (select prosecdef from pg_proc where proname = 'set_appearance'),
  true,
  'set_appearance is SECURITY DEFINER');

select is(
  (select theme from public.account
     where id = '70000000-0000-0000-0000-000000000001'),
  'flexoki',
  'a new account starts on the default theme');

select is(
  (select color_mode from public.account
     where id = '70000000-0000-0000-0000-000000000001'),
  'system',
  'a new account starts in system mode');

-- --- happy path: a viewer sets their own theme and mode --------------------

set local role authenticated;
select pg_temp.act_as('70000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.set_appearance('rosepine', 'dark') $$,
  'set_appearance: an active viewer may set their own preference');

select is(
  (select theme || '/' || color_mode from public.account
     where id = '70000000-0000-0000-0000-000000000001'),
  'rosepine/dark',
  'the viewer''s own row carries the new theme and mode');

-- A pending member may also pick -- the preference is theirs, not the tree's.
select pg_temp.act_as('70000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.set_appearance('gruvbox', 'light') $$,
  'set_appearance: a pending member may set their own preference');

set local role postgres;
select is(
  (select theme || '/' || color_mode from public.account
     where id = '70000000-0000-0000-0000-000000000002'),
  'gruvbox/light',
  'the pending member''s own row carries the new theme and mode');

-- The RPC never reaches another account's row.
select is(
  (select theme || '/' || color_mode from public.account
     where id = '70000000-0000-0000-0000-000000000003'),
  'flexoki/system',
  'no other account changed');

-- --- value guard: the CHECK constraints -----------------------------------

set local role authenticated;
select pg_temp.act_as('70000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ select public.set_appearance('solarized', 'dark') $$,
  '23514',
  null,
  'set_appearance: an unknown theme id is a check_violation');

select throws_ok(
  $$ select public.set_appearance('flexoki', 'auto') $$,
  '23514',
  null,
  'set_appearance: an unknown colour mode is a check_violation');

-- --- deny: no direct UPDATE for a viewer, even on their own row -----------

select is(
  pg_temp.exec_count($$
    update public.account set theme = 'hearth'
     where id = '70000000-0000-0000-0000-000000000001' $$),
  0,
  'a viewer cannot UPDATE theme on their own row directly (account_update is is_admin)');

select is(
  pg_temp.exec_count($$
    update public.account set role = 'admin'
     where id = '70000000-0000-0000-0000-000000000001' $$),
  0,
  'a viewer cannot UPDATE role on their own row');

select is(
  pg_temp.exec_count($$
    update public.account set theme = 'hearth'
     where id = '70000000-0000-0000-0000-000000000003' $$),
  0,
  'a viewer cannot UPDATE theme on another account''s row');

-- --- an admin keeps the direct path and may set their own too -------------

select pg_temp.act_as('70000000-0000-0000-0000-000000000003');

select is(
  pg_temp.exec_count($$
    update public.account set theme = 'orchard'
     where id = '70000000-0000-0000-0000-000000000001' $$),
  1,
  'an admin may still UPDATE any account row (account_update)');

select lives_ok(
  $$ select public.set_appearance('kodachrome', 'light') $$,
  'set_appearance: an admin sets their own preference the same way');

-- --- deny: anon has no grant ---------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select public.set_appearance('flexoki', 'dark') $$,
  '42501',
  null,
  'set_appearance: anon has no execute grant');

select * from finish();
rollback;
