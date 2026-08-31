-- Row-level security: allow and deny for every helper and every §5 policy.
-- Issue #9. This is the guard that stops a policy regression from shipping
-- (SPEC §5 "Tests").
--
-- Layout:
--   * fixtures -- built as the superuser pg_prove connects as (BYPASSRLS)
--   * pg_temp.act_as(uuid) -- switch the caller identity via a fake JWT
--   * pg_temp.exec_count(sql) -- run a write, return the affected row count
--   * helper-function tests
--   * SELECT-policy tests (allow + deny) per table
--   * write-policy tests (allow + deny) per table
--
-- Roles at the SQL level are only `authenticated` (RLS applies) and `postgres`
-- (superuser, for fixture edits). The persona differs by the `sub` claim.

begin;

-- This suite asserts absolute row counts (e.g. "a moderator sees every
-- person"), so its fixtures must be the only rows present. supabase/seed.sql
-- (issue #38) populates the genealogy tables on `db reset` / `supabase start`,
-- and `supabase test db` runs against that seeded database. Clear every data
-- table for the length of the transaction; the final `rollback` restores the
-- seed. Runs as the BYPASSRLS superuser pg_prove connects as, before any
-- identity switch.
--
-- Every table listed explicitly (not left to `cascade`) so a future seed that
-- populates a table with no FK path to `person` cannot leave stale rows behind
-- a new count assertion. `cascade` is kept only as a safety net. `tree_settings`
-- is truncated too (the singleton is re-seeded below) -- the anon/pending
-- assertions expect exactly one row or zero via RLS.
set client_min_messages to warning;
truncate table
  public.person, public.person_name, public.family, public.family_child,
  public.place, public.event, public.fact,
  public.repository, public.source, public.citation,
  public.media, public.media_link, public.note,
  public.account, public.tree_settings, public.audit_log,
  public.invitation, public.access_request, public.claim_attempt,
  public.notification, public.notification_read,
  public.import_job, public.export_job
  restart identity cascade;
insert into public.tree_settings (id) values (1);
reset client_min_messages;

select plan(117);

-- ---------------------------------------------------------------------------
-- Identity switch. set_config(..., is_local => true) lasts to end of the
-- transaction, which is exactly the test lifetime.
-- ---------------------------------------------------------------------------
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

create function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Run a write statement with the caller's privileges (SECURITY INVOKER, so RLS
-- applies) and return the number of rows it changed. A USING-based denial
-- returns 0 without raising; a WITH CHECK / grant denial raises 42501. Every
-- deny assertion that expects 0 targets a fixture row that genuinely exists --
-- if the target id were wrong the test would pass vacuously.
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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- auth.users only needs an id; account.person_id has an FK so persons come first.
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'),  -- admin
  ('a0000000-0000-0000-0000-000000000002'),  -- moderator
  ('a0000000-0000-0000-0000-000000000003'),  -- viewer, linked to p_self
  ('a0000000-0000-0000-0000-000000000004'),  -- viewer2, linked to p_hidden
  ('a0000000-0000-0000-0000-000000000005');  -- pending

insert into public.person (id, given_name, surname, visibility, is_living) values
  ('b0000000-0000-0000-0000-000000000001', 'Ada',   'Public',   'everyone_approved', null),  -- deceased (death event)
  ('b0000000-0000-0000-0000-000000000002', 'Bo',    'Living',   'everyone_approved', null),  -- living (born 2010)
  ('b0000000-0000-0000-0000-000000000003', 'Cleo',  'Hidden',   'hidden',            null),  -- hidden, deceased
  ('b0000000-0000-0000-0000-000000000004', 'Della', 'Self',     'everyone_approved', null),  -- the viewer's own node
  ('b0000000-0000-0000-0000-000000000005', 'Ezra',  'Override', 'everyone_approved', false), -- explicit is_living=false
  ('b0000000-0000-0000-0000-000000000006', 'Fin',   'Nodata',   'everyone_approved', null);  -- no events at all

-- The on_auth_user_created trigger (issue #17) already created a pending viewer
-- account for each auth.users row above; upsert to the role/status this suite
-- needs.
insert into public.account (id, role, status, person_id) values
  ('a0000000-0000-0000-0000-000000000001', 'admin',     'active',  null),
  ('a0000000-0000-0000-0000-000000000002', 'moderator', 'active',  null),
  ('a0000000-0000-0000-0000-000000000003', 'viewer',    'active',  'b0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000004', 'viewer',    'active',  'b0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000005', 'viewer',    'pending', null)
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status,
  person_id = excluded.person_id;

insert into public.family (id, partner1_id, partner2_id) values
  ('c0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),  -- both partners visible
  ('c0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', null);                                    -- only a hidden partner

insert into public.event (id, owner_type, person_id, family_id, type, date_year1) values
  ('e0000000-0000-0000-0000-000000000001', 'person', 'b0000000-0000-0000-0000-000000000001', null, 'death', 1970),
  ('e0000000-0000-0000-0000-000000000002', 'person', 'b0000000-0000-0000-0000-000000000001', null, 'birth', 1900),
  ('e0000000-0000-0000-0000-000000000003', 'person', 'b0000000-0000-0000-0000-000000000002', null, 'birth', 2010),
  ('e0000000-0000-0000-0000-000000000004', 'person', 'b0000000-0000-0000-0000-000000000003', null, 'birth', 1880),
  ('e0000000-0000-0000-0000-000000000005', 'person', 'b0000000-0000-0000-0000-000000000003', null, 'death', 1950),
  ('e0000000-0000-0000-0000-000000000006', 'person', 'b0000000-0000-0000-0000-000000000005', null, 'birth', 2015),
  ('e0000000-0000-0000-0000-000000000007', 'family', null, 'c0000000-0000-0000-0000-000000000001', 'marriage', 1925);

-- Additional names: one on a visible person, one on the hidden person.
insert into public.person_name (id, person_id, type, given_name) values
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'birth',  'Bocephus'),
  ('b1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'maiden', 'Cleopatra');

-- Child membership: one visible child, one hidden child.
insert into public.family_child (id, family_id, person_id) values
  ('b2000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000005'),
  ('b2000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003');

insert into public.fact
  (id, owner_type, person_id, family_id, type, value, visibility) values
  ('f0000000-0000-0000-0000-000000000001', 'person', 'b0000000-0000-0000-0000-000000000002', null, 'occupation', 'Engineer', 'everyone_approved'),
  ('f0000000-0000-0000-0000-000000000002', 'person', 'b0000000-0000-0000-0000-000000000002', null, 'ssn',        '111-11',   'everyone_approved'),
  ('f0000000-0000-0000-0000-000000000003', 'person', 'b0000000-0000-0000-0000-000000000001', null, 'ssn',        '222-22',   'everyone_approved'),
  ('f0000000-0000-0000-0000-000000000004', 'person', 'b0000000-0000-0000-0000-000000000002', null, 'religion',   'Quaker',   'moderators_only'),
  -- family-owned: a plain fact (visible via family_is_visible) and a sensitive
  -- one (hidden from non-moderators -- the owner_type='person' guard in
  -- fact_is_visible fails, so person_is_living can never re-expose it).
  ('f0000000-0000-0000-0000-000000000005', 'family', null, 'c0000000-0000-0000-0000-000000000001', 'number_of_children', '3', 'everyone_approved'),
  ('f0000000-0000-0000-0000-000000000006', 'family', null, 'c0000000-0000-0000-0000-000000000001', 'medical',            'x', 'everyone_approved');

insert into public.place (id, name) values
  ('d0000000-0000-0000-0000-000000000001', 'Boston, Massachusetts');
insert into public.repository (id, name) values
  ('d0000000-0000-0000-0000-000000000002', 'State Archive');
insert into public.source (id, title) values
  ('d0000000-0000-0000-0000-000000000003', '1900 Census');

insert into public.citation (id, source_id, owner_type, owner_id) values
  ('c1000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000003', 'person', 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000003', 'person', 'b0000000-0000-0000-0000-000000000003');

insert into public.note (id, owner_type, owner_id, text) values
  ('c2000000-0000-0000-0000-000000000001', 'person', 'b0000000-0000-0000-0000-000000000002', 'A note on Bo.'),
  ('c2000000-0000-0000-0000-000000000002', 'person', 'b0000000-0000-0000-0000-000000000003', 'A note on the hidden person.');

insert into public.media (id, original_filename) values
  ('c3000000-0000-0000-0000-000000000001', 'bo.jpg');
insert into public.media_link (id, media_id, owner_type, owner_id, is_primary) values
  ('c4000000-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000001', 'person', 'b0000000-0000-0000-0000-000000000002', true),
  ('c4000000-0000-0000-0000-000000000002',
   'c3000000-0000-0000-0000-000000000001', 'person', 'b0000000-0000-0000-0000-000000000003', false);

insert into public.invitation (id, email, person_id, role) values
  ('a1000000-0000-0000-0000-000000000001', 'new@example.com',
   'b0000000-0000-0000-0000-000000000002', 'viewer');

-- Inserted before the access_request below: the notify_access_requested trigger
-- (migration 20260831162624) dedups against an open access_requested for the
-- same account, so this pre-seeded row keeps the count at one.
insert into public.notification (id, type, payload) values
  ('a4000000-0000-0000-0000-000000000001', 'access_requested',
   jsonb_build_object('account_id', 'a0000000-0000-0000-0000-000000000003'));

insert into public.access_request (id, account_id, submitted_name) values
  ('a2000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000003', 'Della Self');

insert into public.claim_attempt (id, account_id, succeeded) values
  ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', false);

insert into public.notification_read (notification_id, account_id) values
  ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003');

insert into public.import_job (id, mode) values
  ('a5000000-0000-0000-0000-000000000001', 'initial'),
  ('a5000000-0000-0000-0000-000000000002', 'replace_all');

insert into public.export_job (id, type) values
  ('a6000000-0000-0000-0000-000000000001', 'manual_gedcom');

-- Persona ids: admin a…1  moderator a…2  viewer a…3  viewer2 a…4  pending a…5

set local role authenticated;

-- ===========================================================================
-- Helper functions
-- ===========================================================================

select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select ok(public.is_approved(), 'is_approved: active viewer is approved');
select ok(not public.is_moderator(), 'is_moderator: viewer is not a moderator');
select ok(not public.is_admin(), 'is_admin: viewer is not an admin');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000005');  -- pending
select ok(not public.is_approved(), 'is_approved: pending account is not approved');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select ok(public.is_moderator(), 'is_moderator: moderator is a moderator');
select ok(not public.is_admin(), 'is_admin: moderator is not an admin');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');  -- admin
select ok(public.is_moderator(), 'is_moderator: admin counts as a moderator');
select ok(public.is_admin(), 'is_admin: admin is an admin');

-- A suspended moderator keeps no privileges (deviation from the SPEC §5 draft).
set local role postgres;
update public.account set status = 'suspended'
  where id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
select ok(not public.is_moderator(), 'is_moderator: suspended moderator is not a moderator');
set local role postgres;
update public.account set status = 'active'
  where id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;

-- person_is_living (SECURITY DEFINER -- identity does not matter, but be someone)
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
select ok(not public.person_is_living('b0000000-0000-0000-0000-000000000001'),
  'person_is_living: false when a death event exists');
select ok(public.person_is_living('b0000000-0000-0000-0000-000000000002'),
  'person_is_living: true when born within the threshold and no death');
select ok(not public.person_is_living('b0000000-0000-0000-0000-000000000005'),
  'person_is_living: explicit is_living=false override wins');
select ok(public.person_is_living('b0000000-0000-0000-0000-000000000006'),
  'person_is_living: true when there is no birth year and no death');

-- person_is_visible
select ok(public.person_is_visible('b0000000-0000-0000-0000-000000000002'),
  'person_is_visible: viewer sees an everyone_approved person');
select ok(not public.person_is_visible('b0000000-0000-0000-0000-000000000003'),
  'person_is_visible: viewer does not see a hidden person');
select ok(public.person_is_visible('b0000000-0000-0000-0000-000000000004'),
  'person_is_visible: viewer sees their own linked node');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');  -- viewer2 == hidden person
select ok(public.person_is_visible('b0000000-0000-0000-0000-000000000003'),
  'person_is_visible: the linked account sees its own hidden node');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select ok(public.person_is_visible('b0000000-0000-0000-0000-000000000003'),
  'person_is_visible: a moderator sees a hidden person');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000005');  -- pending
select ok(not public.person_is_visible('b0000000-0000-0000-0000-000000000002'),
  'person_is_visible: a pending account sees nobody');

-- family_is_visible
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select ok(public.family_is_visible('c0000000-0000-0000-0000-000000000001'),
  'family_is_visible: viewer sees a family with a visible partner');
select ok(not public.family_is_visible('c0000000-0000-0000-0000-000000000002'),
  'family_is_visible: viewer does not see a family of only a hidden partner');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select ok(public.family_is_visible('c0000000-0000-0000-0000-000000000002'),
  'family_is_visible: a moderator sees every family');

-- ===========================================================================
-- SELECT policies
-- ===========================================================================

select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer

select is((select count(*)::int from public.person), 5,
  'person SELECT: viewer sees 5 of 6 (the hidden person is filtered)');
select is((select count(*)::int from public.family), 1,
  'family SELECT: viewer sees only the visible family');
select is((select count(*)::int from public.event), 5,
  'event SELECT: viewer sees 5 of 7 (the two hidden-person events are filtered)');
select is(
  (select count(*)::int from public.event
   where id = 'e0000000-0000-0000-0000-000000000007'),
  1,
  'event SELECT: a family-owned marriage event is visible via family_is_visible, not a null person_id fall-through');
select is((select count(*)::int from public.person_name), 1,
  'person_name SELECT: viewer sees the additional name on a visible person, not the hidden one');
select is((select count(*)::int from public.family_child), 1,
  'family_child SELECT: viewer sees the visible child membership, not the hidden one');
select is((select count(*)::int from public.fact), 3,
  'fact SELECT: viewer sees the plain fact, the deceased SSN, and the plain family fact -- not the living SSN, the moderators_only fact, or the family medical fact');
select is(
  (select count(*)::int from public.fact
   where id = 'f0000000-0000-0000-0000-000000000003'),
  1,
  'fact SELECT: a sensitive fact on a deceased person is visible (decision 6)');
select is(
  (select count(*)::int from public.fact
   where id = 'f0000000-0000-0000-0000-000000000002'),
  0,
  'fact SELECT: a sensitive fact on a living person is hidden');
select is(
  (select count(*)::int from public.fact
   where id = 'f0000000-0000-0000-0000-000000000005'),
  1,
  'fact SELECT: a plain family-owned fact is visible via family_is_visible');
select is(
  (select count(*)::int from public.fact
   where id = 'f0000000-0000-0000-0000-000000000006'),
  0,
  'fact SELECT: a sensitive family-owned fact is hidden from non-moderators');
select is((select count(*)::int from public.place), 1,
  'place SELECT: any approved member sees places');
select is((select count(*)::int from public.source), 1,
  'source SELECT: any approved member sees sources');
select is((select count(*)::int from public.repository), 1,
  'repository SELECT: any approved member sees repositories');
select is((select count(*)::int from public.citation), 1,
  'citation SELECT: viewer sees the citation on a visible person, not the one on a hidden person');
select is((select count(*)::int from public.note), 1,
  'note SELECT: viewer sees the note on a visible person, not the one on a hidden person');
select is((select count(*)::int from public.media), 1,
  'media SELECT: any approved member sees the media row');
select is((select count(*)::int from public.media_link), 1,
  'media_link SELECT: viewer sees the link to a visible person, not the one to a hidden person');
select is((select count(*)::int from public.account), 1,
  'account SELECT: viewer sees only their own account row');
select is((select count(*)::int from public.tree_settings), 1,
  'tree_settings SELECT: any signed-in user reads the singleton');
select is((select count(*)::int from public.audit_log), 0,
  'audit_log SELECT: a non-admin sees nothing');
select is((select count(*)::int from public.invitation), 0,
  'invitation SELECT: a non-moderator sees nothing');
select is((select count(*)::int from public.access_request), 1,
  'access_request SELECT: the requester sees their own row');
select is((select count(*)::int from public.claim_attempt), 0,
  'claim_attempt SELECT: a non-moderator sees nothing');
select is((select count(*)::int from public.notification), 0,
  'notification SELECT: a non-moderator sees nothing');
select is((select count(*)::int from public.notification_read), 1,
  'notification_read SELECT: the caller sees their own read marker');
select is((select count(*)::int from public.import_job), 0,
  'import_job SELECT: a non-moderator sees nothing');
select is((select count(*)::int from public.export_job), 0,
  'export_job SELECT: a non-moderator sees nothing');

-- viewer2 is the hidden person: sees themselves plus every everyone_approved
-- person, so all 6.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.person), 6,
  'person SELECT: the hidden person sees themselves and every public person');
select is((select count(*)::int from public.access_request), 0,
  'access_request SELECT: viewer2 does not see the other viewer''s request');
select is((select count(*)::int from public.notification_read), 0,
  'notification_read SELECT: viewer2 does not see the other viewer''s marker');

-- pending account: no reads at all through the visibility ladder.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.person), 0,
  'person SELECT: a pending account sees no people');
select is((select count(*)::int from public.place), 0,
  'place SELECT: a pending account sees no places');
select is((select count(*)::int from public.tree_settings), 1,
  'tree_settings SELECT: even a pending account reads the singleton');

-- moderator: sees everything the ladder gates.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.person), 6,
  'person SELECT: a moderator sees every person');
select is((select count(*)::int from public.person_name), 2,
  'person_name SELECT: a moderator sees every additional name');
select is((select count(*)::int from public.family), 2,
  'family SELECT: a moderator sees every family');
select is((select count(*)::int from public.family_child), 2,
  'family_child SELECT: a moderator sees every child membership');
select is(
  (select count(*)::int from public.family
   where id = 'c0000000-0000-0000-0000-000000000002'),
  1,
  'family SELECT: a moderator sees a family whose only partner is hidden');
select is((select count(*)::int from public.event), 7,
  'event SELECT: a moderator sees every event');
select is((select count(*)::int from public.fact), 6,
  'fact SELECT: a moderator sees every fact including sensitive, moderators_only, and family-owned');
select is((select count(*)::int from public.citation), 2,
  'citation SELECT: a moderator sees every citation');
select is((select count(*)::int from public.note), 2,
  'note SELECT: a moderator sees every note');
select is((select count(*)::int from public.media_link), 2,
  'media_link SELECT: a moderator sees every link');
select is((select count(*)::int from public.access_request), 1,
  'access_request SELECT: a moderator reads every request');
select is((select count(*)::int from public.invitation), 1,
  'invitation SELECT: a moderator sees invitations');
select is((select count(*)::int from public.notification), 1,
  'notification SELECT: a moderator sees the queue');
select is((select count(*)::int from public.claim_attempt), 1,
  'claim_attempt SELECT: a moderator sees claim attempts');
select is((select count(*)::int from public.import_job), 2,
  'import_job SELECT: a moderator sees every job');
select is((select count(*)::int from public.export_job), 1,
  'export_job SELECT: a moderator sees every job');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');  -- admin
select cmp_ok((select count(*)::int from public.audit_log), '>=', 1,
  'audit_log SELECT: an admin reads the trail');

-- anon: the policies are `to authenticated`, so nothing matches.
set local role postgres;
set local role anon;
select pg_temp.act_as_anon();
select is((select count(*)::int from public.person), 0,
  'person SELECT: an unauthenticated caller sees nothing');
select is((select count(*)::int from public.tree_settings), 0,
  'tree_settings SELECT: an unauthenticated caller sees nothing');
set local role postgres;
set local role authenticated;

-- ===========================================================================
-- Write policies
-- ===========================================================================

-- person: INSERT/UPDATE moderator, DELETE admin.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select throws_ok(
  $$ insert into public.person (given_name) values ('Nope') $$,
  '42501', null,
  'person INSERT: a viewer is refused');
select is(
  pg_temp.exec_count($$ update public.person set surname = 'Changed'
    where id = 'b0000000-0000-0000-0000-000000000002' $$),
  0,
  'person UPDATE: a viewer changes no rows');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select lives_ok(
  $$ insert into public.person (id, given_name)
     values ('b0000000-0000-0000-0000-0000000000ff', 'Mod Made') $$,
  'person INSERT: a moderator may create a person');
select is(
  pg_temp.exec_count($$ delete from public.person
    where id = 'b0000000-0000-0000-0000-0000000000ff' $$),
  0,
  'person DELETE: a moderator deletes no rows (admin only)');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');  -- admin
select is(
  pg_temp.exec_count($$ delete from public.person
    where id = 'b0000000-0000-0000-0000-0000000000ff' $$),
  1,
  'person DELETE: an admin may delete a person');

-- Genealogy write policies (the 12 identical `X_write for all` moderator
-- policies). insert_allowed() returns false on a 42501 and re-raises anything
-- else, so a bad fixture payload fails loudly rather than passing as a deny.
set local role postgres;
create function pg_temp.insert_allowed(p_sql text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return true;
exception
  when insufficient_privilege then return false;
end;
$$;

-- one representative INSERT per genealogy table, valid FKs against the fixtures.
create temp table genealogy_write_probe (tbl text, sql text);
insert into genealogy_write_probe values
  ('person_name', $$ insert into public.person_name (person_id, given_name)
     values ('b0000000-0000-0000-0000-000000000002', 'W') $$),
  ('family',       $$ insert into public.family default values $$),
  ('family_child', $$ insert into public.family_child (family_id, person_id)
     values ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001') $$),
  ('place',        $$ insert into public.place (name) values ('W') $$),
  ('event',        $$ insert into public.event (owner_type, person_id, type)
     values ('person', 'b0000000-0000-0000-0000-000000000002', 'residence') $$),
  ('fact',         $$ insert into public.fact (owner_type, person_id, type)
     values ('person', 'b0000000-0000-0000-0000-000000000002', 'education') $$),
  ('repository',   $$ insert into public.repository (name) values ('W') $$),
  ('source',       $$ insert into public.source (title) values ('W') $$),
  ('citation',     $$ insert into public.citation (source_id, owner_type, owner_id)
     values ('d0000000-0000-0000-0000-000000000003', 'person', 'b0000000-0000-0000-0000-000000000002') $$),
  ('media',        $$ insert into public.media (original_filename) values ('w.jpg') $$),
  ('media_link',   $$ insert into public.media_link (media_id, owner_type, owner_id)
     values ('c3000000-0000-0000-0000-000000000001', 'person', 'b0000000-0000-0000-0000-000000000002') $$),
  ('note',         $$ insert into public.note (owner_type, owner_id, text)
     values ('person', 'b0000000-0000-0000-0000-000000000002', 'W') $$);
grant select on genealogy_write_probe to authenticated;
set local role authenticated;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select is(
  (select count(*)::int from genealogy_write_probe
   where pg_temp.insert_allowed(sql)),
  0,
  'genealogy INSERT: a viewer is refused on every genealogy table');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select is(
  (select count(*)::int from genealogy_write_probe
   where not pg_temp.insert_allowed(sql)),
  0,
  'genealogy INSERT: a moderator is allowed on every genealogy table');

-- UPDATE / DELETE on the same policy: place stands in.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select is(
  pg_temp.exec_count($$ update public.place set name = 'x'
    where id = 'd0000000-0000-0000-0000-000000000001' $$),
  0,
  'genealogy UPDATE: a viewer changes no rows');
select is(
  pg_temp.exec_count($$ delete from public.note
    where id = 'c2000000-0000-0000-0000-000000000001' $$),
  0,
  'genealogy DELETE: a viewer deletes no rows');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select is(
  pg_temp.exec_count($$ update public.place set name = 'Renamed'
    where id = 'd0000000-0000-0000-0000-000000000001' $$),
  1,
  'genealogy UPDATE: a moderator may update');
select is(
  pg_temp.exec_count($$ delete from public.note
    where id = 'c2000000-0000-0000-0000-000000000001' $$),
  1,
  'genealogy DELETE: a moderator may delete');

-- person: UPDATE is a moderator (allow path; the deny path is above).
select is(
  pg_temp.exec_count($$ update public.person set surname = 'Renamed'
    where id = 'b0000000-0000-0000-0000-000000000002' $$),
  1,
  'person UPDATE: a moderator may update a person');

-- tree_settings: admin UPDATE only.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select is(
  pg_temp.exec_count($$ update public.tree_settings set tree_name = 'Nope' where id = 1 $$),
  0,
  'tree_settings UPDATE: a moderator changes no rows');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');  -- admin
select is(
  pg_temp.exec_count($$ update public.tree_settings set tree_name = 'Our Tree' where id = 1 $$),
  1,
  'tree_settings UPDATE: an admin may update settings');

-- account: admin UPDATE only.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select is(
  pg_temp.exec_count($$ update public.account set display_name = 'Me'
    where id = 'a0000000-0000-0000-0000-000000000003' $$),
  0,
  'account UPDATE: a viewer cannot update even their own row');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');  -- admin
select is(
  pg_temp.exec_count($$ update public.account set role = 'moderator'
    where id = 'a0000000-0000-0000-0000-000000000003' $$),
  1,
  'account UPDATE: an admin may change a role');
set local role postgres;
update public.account set role = 'viewer'
  where id = 'a0000000-0000-0000-0000-000000000003';
set local role authenticated;

-- invitation: moderator manages; only an admin may grant a non-viewer role.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select lives_ok(
  $$ insert into public.invitation (email, person_id, role)
     values ('a@example.com', 'b0000000-0000-0000-0000-000000000002', 'viewer') $$,
  'invitation INSERT: a moderator may invite a viewer');
select throws_ok(
  $$ insert into public.invitation (email, person_id, role)
     values ('b@example.com', 'b0000000-0000-0000-0000-000000000002', 'admin') $$,
  '42501', null,
  'invitation INSERT: a moderator may not grant an admin role');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');  -- admin
select lives_ok(
  $$ insert into public.invitation (email, person_id, role)
     values ('c@example.com', 'b0000000-0000-0000-0000-000000000002', 'admin') $$,
  'invitation INSERT: an admin may grant an admin role');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select is(
  pg_temp.exec_count($$ update public.invitation set status = 'expired'
    where id = 'a1000000-0000-0000-0000-000000000001' $$),
  0,
  'invitation UPDATE: a viewer changes no rows');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select is(
  pg_temp.exec_count($$ update public.invitation set status = 'expired'
    where id = 'a1000000-0000-0000-0000-000000000001' $$),
  1,
  'invitation UPDATE: a moderator may update an invitation');
select is(
  pg_temp.exec_count($$ delete from public.invitation
    where id = 'a1000000-0000-0000-0000-000000000001' $$),
  1,
  'invitation DELETE: a moderator may delete an invitation');

-- access_request: the caller inserts a pending row for their own account only.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');  -- viewer2
select lives_ok(
  $$ insert into public.access_request (account_id, submitted_name)
     values ('a0000000-0000-0000-0000-000000000004', 'Cleo') $$,
  'access_request INSERT: a caller may file their own request');
select throws_ok(
  $$ insert into public.access_request (account_id, submitted_name)
     values ('a0000000-0000-0000-0000-000000000002', 'Not me') $$,
  '42501', null,
  'access_request INSERT: a caller may not file for another account');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer (owns the fixture request)
select is(
  pg_temp.exec_count($$ update public.access_request set status = 'approved'
    where id = 'a2000000-0000-0000-0000-000000000001' $$),
  0,
  'access_request UPDATE: the requester cannot resolve their own request');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select is(
  pg_temp.exec_count($$ update public.access_request set status = 'approved'
    where id = 'a2000000-0000-0000-0000-000000000001' $$),
  1,
  'access_request UPDATE: a moderator may resolve a request');

-- notification: no client INSERT policy at all.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select is(
  pg_temp.exec_count($$ update public.notification set resolved_at = now()
    where id = 'a4000000-0000-0000-0000-000000000001' $$),
  0,
  'notification UPDATE: a non-moderator changes no rows');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select throws_ok(
  $$ insert into public.notification (type) values ('hide_request') $$,
  '42501', null,
  'notification INSERT: even a moderator cannot insert directly');
select is(
  pg_temp.exec_count($$ update public.notification set resolved_at = now()
    where id = 'a4000000-0000-0000-0000-000000000001' $$),
  1,
  'notification UPDATE: a moderator may resolve a notification');

-- notification_read: only the caller's own markers.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select lives_ok(
  $$ insert into public.notification_read (notification_id, account_id)
     values ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002') $$,
  'notification_read INSERT: a caller may mark their own read state');
select throws_ok(
  $$ insert into public.notification_read (notification_id, account_id)
     values ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'notification_read INSERT: a caller may not write another account''s marker');

-- claim_attempt: no client write policy (service role only).
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select throws_ok(
  $$ insert into public.claim_attempt (account_id, succeeded)
     values ('a0000000-0000-0000-0000-000000000002', true) $$,
  '42501', null,
  'claim_attempt INSERT: no client may write');

-- import_job: moderator creates; only an admin deletes a non-initial job.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select throws_ok(
  $$ insert into public.import_job (mode) values ('initial') $$,
  '42501', null,
  'import_job INSERT: a viewer is refused');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select lives_ok(
  $$ insert into public.import_job (id, mode)
     values ('a5000000-0000-0000-0000-0000000000ff', 'initial') $$,
  'import_job INSERT: a moderator may create a job');
select is(
  pg_temp.exec_count($$ update public.import_job set status = 'parsing'
    where id = 'a5000000-0000-0000-0000-000000000001' $$),
  1,
  'import_job UPDATE: a moderator may update a job');
select is(
  pg_temp.exec_count($$ delete from public.import_job
    where id = 'a5000000-0000-0000-0000-0000000000ff' $$),
  1,
  'import_job DELETE: a moderator may delete an initial job');
select is(
  pg_temp.exec_count($$ delete from public.import_job
    where id = 'a5000000-0000-0000-0000-000000000002' $$),
  0,
  'import_job DELETE: a moderator may not delete a replace_all job');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');  -- admin
select is(
  pg_temp.exec_count($$ delete from public.import_job
    where id = 'a5000000-0000-0000-0000-000000000002' $$),
  1,
  'import_job DELETE: an admin may delete a replace_all job');

-- export_job: moderators manage.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- viewer
select throws_ok(
  $$ insert into public.export_job (type) values ('manual_full') $$,
  '42501', null,
  'export_job INSERT: a viewer is refused');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- moderator
select lives_ok(
  $$ insert into public.export_job (type) values ('manual_full') $$,
  'export_job INSERT: a moderator may create a job');
select is(
  pg_temp.exec_count($$ delete from public.export_job
    where id = 'a6000000-0000-0000-0000-000000000001' $$),
  1,
  'export_job DELETE: a moderator may delete a job');

-- anon: no writes.
set local role postgres;
set local role anon;
select pg_temp.act_as_anon();
select throws_ok(
  $$ insert into public.person (given_name) values ('Anon') $$,
  '42501', null,
  'person INSERT: an unauthenticated caller is refused');
set local role postgres;

select * from finish();
rollback;
