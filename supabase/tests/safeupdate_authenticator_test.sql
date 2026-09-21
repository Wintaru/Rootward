-- The `safeupdate` gap (#100): PostgREST connects as `authenticator`, whose
-- role config preloads `safeupdate` -- an unqualified DELETE/UPDATE, even one
-- inside a plpgsql function, is rejected for that session. pg_prove connects
-- as `postgres`, which does not load it, so `wipe_tree()` (#60) passed every
-- pgTAP test and failed the first real click (#99). This file opens a real
-- `authenticator` connection through `dblink` and runs the unfiltered-write
-- functions through it, the way the app does.
--
-- The connection targets the server's own bridge address, not loopback:
-- local `pg_hba` trusts loopback, and `dblink_connect` refuses a connection
-- whose password went unused ("Non-superusers may only connect using
-- credentials they provide"). `password=postgres` is the local stack's
-- default, so the connect below only ever succeeds against a local stack --
-- and it runs *before* anything is committed, so a `--linked` / `--db-url`
-- run against a real project stops here (psql runs with ON_ERROR_STOP) and
-- never writes the admin fixture into it.
--
-- The remote session cannot see this file's transaction, and neither
-- `authenticator` nor `service_role` may insert into `auth.users`, so the
-- admin it acts as is committed around the test: cleaned up first (a
-- previous run that aborted), inserted, and removed again after `rollback`.
-- Every remote call after the one that can legitimately fail passes
-- `fail_on_error := false`, so a failing assertion still reaches that
-- cleanup. A leftover row would be an `auth.users` row with no email and no
-- credentials -- nothing can sign in as it.

create extension if not exists dblink;
select dblink_connect(
  'pgrst',
  format(
    'host=%s port=%s dbname=postgres user=authenticator password=postgres',
    host(inet_server_addr()),
    inet_server_port()
  )
);

-- `account.id` cascades from `auth.users`; the account delete is for a row a
-- crashed run left without its user.
delete from public.account where id = '70000000-0000-0000-0000-000000000100';
delete from auth.users   where id = '70000000-0000-0000-0000-000000000100';
insert into auth.users (id) values ('70000000-0000-0000-0000-000000000100');
-- The auth.users trigger already made a pending viewer account; promote it.
insert into public.account (id, role, status)
values ('70000000-0000-0000-0000-000000000100', 'admin', 'active')
on conflict (id) do update set role = 'admin', status = 'active';

begin;
select plan(6);

-- ---------------------------------------------------------------------------
-- The guard is really there. Without this, every assertion below could pass
-- on a connection that quietly loaded nothing.
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select dblink_exec(
       'pgrst',
       'begin; set local role service_role; delete from public.place'
     ) $$,
  '%DELETE requires a WHERE clause%',
  'an unqualified DELETE is rejected on the authenticator session'
);
select dblink_exec('pgrst', 'rollback', false);

select throws_like(
  $$ select dblink_exec(
       'pgrst',
       'begin; set local role service_role; update public.place set name = name'
     ) $$,
  '%UPDATE requires a WHERE clause%',
  'an unqualified UPDATE is rejected on the authenticator session'
);
select dblink_exec('pgrst', 'rollback', false);

-- ---------------------------------------------------------------------------
-- wipe_tree(): the one function whose job is an unfiltered delete. Run as the
-- admin, through the guarded session, over rows the session can see; rolled
-- back on the remote side, so the local tree is untouched.
-- ---------------------------------------------------------------------------
select dblink_exec('pgrst', 'begin');
select dblink_exec('pgrst', 'set local role service_role');
select dblink_exec(
  'pgrst',
  $$ insert into public.person (id, given_name, surname)
     values ('71000000-0000-0000-0000-000000000001', 'Wiped', 'Person');
     insert into public.place (name) values ('Wipeville, safeupdate') $$
);
select dblink_exec('pgrst', 'set local role authenticated');
-- `dblink_exec` refuses a statement that returns rows; `dblink` runs it.
select * from dblink(
  'pgrst',
  $$ select set_config(
       'request.jwt.claims',
       '{"sub":"70000000-0000-0000-0000-000000000100","role":"authenticated"}',
       true
     ) $$
) as claims(value text);

-- The after-counts below read under RLS as this admin; show the session
-- sees rows first, so a zero afterwards means "deleted", not "hidden".
select cmp_ok(
  (select n from dblink('pgrst', 'select count(*)::int from public.person')
     as t(n int)),
  '>', 0,
  'the admin session sees people before the wipe'
);

select lives_ok(
  $$ select * from dblink('pgrst', 'select public.wipe_tree()') as t(x text) $$,
  'wipe_tree() runs to completion under safeupdate'
);
select is(
  (select n from dblink(
     'pgrst', 'select count(*)::int from public.person', false
   ) as t(n int)),
  0,
  'every person is gone afterwards'
);
select is(
  (select n from dblink(
     'pgrst', 'select count(*)::int from public.place', false
   ) as t(n int)),
  0,
  'every place is gone afterwards'
);
select dblink_exec('pgrst', 'rollback', false);
select dblink_disconnect('pgrst');

select * from finish();
rollback;

delete from auth.users where id = '70000000-0000-0000-0000-000000000100';
