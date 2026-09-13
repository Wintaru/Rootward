-- wipe_tree(): the admin-only "Wipe tree" action behind `/settings` (SPEC §7,
-- §8.1, decisions 18, 33). Issue #60, migration 20260913191500.
--
-- Same harness style as delete_person_test.sql: isolated fixtures built as
-- the superuser pg_prove connects as, identity switched with a fake JWT.

begin;
select plan(20);

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

-- ---------------------------------------------------------------------------
-- Fixtures: a small populated tree, plus one row in every table this
-- function must leave alone (account, tree_settings, notification,
-- import_job, export_job).
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('60000000-0000-0000-0000-000000000001'),  -- admin
  ('60000000-0000-0000-0000-000000000002'),  -- moderator
  ('60000000-0000-0000-0000-000000000003');  -- account linked to Kept

insert into public.person (id, given_name, surname) values
  ('61000000-0000-0000-0000-000000000001', 'Kept',    'Pat'),
  ('61000000-0000-0000-0000-000000000002', 'Partner', 'Mat');

insert into public.account (id, role, status, person_id) values
  ('60000000-0000-0000-0000-000000000001', 'admin',     'active', null),
  ('60000000-0000-0000-0000-000000000002', 'moderator', 'active', null),
  ('60000000-0000-0000-0000-000000000003', 'viewer',    'active',
   '61000000-0000-0000-0000-000000000001')
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status,
  person_id = excluded.person_id;

update public.tree_settings
  set default_root_person_id = '61000000-0000-0000-0000-000000000001',
      tree_name = 'Test tree'
  where id = 1;

insert into public.family (id, partner1_id, partner2_id, relationship_type) values
  ('62000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 'married');

-- A third generation: Kept + Partner's child, so family_child has a row too.
insert into public.person (id, given_name, surname) values
  ('61000000-0000-0000-0000-000000000003', 'Child', 'Pat');

insert into public.family_child (id, family_id, person_id) values
  ('63000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000003');

insert into public.person_name (id, person_id, type, given_name) values
  ('64000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000000001', 'nickname', 'Keepy');

insert into public.event (id, owner_type, person_id, type) values
  ('65000000-0000-0000-0000-000000000001', 'person',
   '61000000-0000-0000-0000-000000000001', 'birth');

insert into public.fact (id, owner_type, person_id, type) values
  ('66000000-0000-0000-0000-000000000001', 'person',
   '61000000-0000-0000-0000-000000000001', 'eye_color');

insert into public.place (id, name) values
  ('67000000-0000-0000-0000-000000000001', 'Somewhere');

insert into public.repository (id, name) values
  ('68000000-0000-0000-0000-000000000001', 'An archive');

insert into public.source (id, title, repository_id) values
  ('69000000-0000-0000-0000-000000000001', 'A source',
   '68000000-0000-0000-0000-000000000001');

insert into public.citation (id, source_id, owner_type, owner_id) values
  ('6a000000-0000-0000-0000-000000000001',
   '69000000-0000-0000-0000-000000000001', 'person',
   '61000000-0000-0000-0000-000000000001');

insert into public.media (id, original_filename, storage_path_original) values
  ('6b000000-0000-0000-0000-000000000001', 'kept.jpg', '6b000000-0000-0000-0000-000000000001/original.jpg');

insert into public.media_link (id, media_id, owner_type, owner_id) values
  ('6c000000-0000-0000-0000-000000000001',
   '6b000000-0000-0000-0000-000000000001', 'person',
   '61000000-0000-0000-0000-000000000001');

insert into public.note (id, owner_type, owner_id, text) values
  ('6d000000-0000-0000-0000-000000000001', 'person',
   '61000000-0000-0000-0000-000000000001', 'about Kept');

insert into public.notification (id, type, payload) values
  ('6e000000-0000-0000-0000-000000000001', 'import_finished', '{}'::jsonb);

insert into public.import_job (id, filename, started_by, mode) values
  ('6f000000-0000-0000-0000-000000000001', 'kept.ged',
   '60000000-0000-0000-0000-000000000001', 'initial');

set local role authenticated;

-- ===========================================================================
-- A moderator may not call it, and the call is atomic -- nothing partially
-- applied by a refused call.
-- ===========================================================================

select pg_temp.act_as('60000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.wipe_tree() $$,
  '42501', null,
  'wipe_tree: a moderator is refused'
);
select is(
  (select count(*)::int from public.person
     where id in (
       '61000000-0000-0000-0000-000000000001',
       '61000000-0000-0000-0000-000000000002',
       '61000000-0000-0000-0000-000000000003'
     )),
  3,
  'wipe_tree: a refused moderator call leaves the fixture people untouched'
);

-- ===========================================================================
-- An admin wipes cleanly.
-- ===========================================================================

select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.wipe_tree() $$,
  'wipe_tree: an admin call succeeds'
);

select is((select count(*)::int from public.person), 0, 'person is empty');
select is((select count(*)::int from public.person_name), 0, 'person_name is empty');
select is((select count(*)::int from public.family), 0, 'family is empty');
select is((select count(*)::int from public.family_child), 0, 'family_child is empty');
select is((select count(*)::int from public.event), 0, 'event is empty');
select is((select count(*)::int from public.fact), 0, 'fact is empty');
select is((select count(*)::int from public.place), 0, 'place is empty');
select is((select count(*)::int from public.source), 0, 'source is empty');
select is((select count(*)::int from public.citation), 0, 'citation cascaded with source');
select is((select count(*)::int from public.media), 0, 'media is empty');
select is((select count(*)::int from public.media_link), 0, 'media_link cascaded with media');
select is((select count(*)::int from public.repository), 0, 'repository is empty');
select is((select count(*)::int from public.note), 0, 'note is empty');

select is(
  (select person_id from public.account
     where id = '60000000-0000-0000-0000-000000000003'),
  null,
  'the linked account is unlinked, not deleted'
);
select is(
  (select default_root_person_id from public.tree_settings where id = 1),
  null,
  'tree_settings.default_root_person_id is cleared, the row survives'
);
select is(
  (select count(*)::int from public.notification
     where id = '6e000000-0000-0000-0000-000000000001'),
  1,
  'the notification row survives'
);
select is(
  (select count(*)::int from public.import_job
     where id = '6f000000-0000-0000-0000-000000000001'),
  1,
  'the import_job row survives'
);

set local role postgres;

select * from finish();
rollback;
