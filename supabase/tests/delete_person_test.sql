-- delete_person(person): the admin-only cascade delete behind the edit
-- view's Name & Gender "danger zone" (SPEC §8.3, decision 18). Issue #59,
-- migration 20260913190832.
--
-- Same harness style as expand_relatives_test.sql: isolated fixtures built as
-- the superuser pg_prove connects as, identity switched with a fake JWT.

begin;
select plan(23);

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
-- Fixtures.
--
--   Dead (to delete) ── Spouse           Parent1 ── Parent2
--        |                                    |
--     (person_name, event+citation+note,      |
--      fact+media_link, direct note,     Dead (family_child)
--      direct media_link, linked account)
--
--   Other -- a fully unrelated person with its own note/citation/media_link,
--   to prove delete_person does not over-delete.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('50000000-0000-0000-0000-000000000001'),  -- admin
  ('50000000-0000-0000-0000-000000000002'),  -- moderator
  ('50000000-0000-0000-0000-000000000003');  -- account linked to Dead

insert into public.person (id, given_name, surname) values
  ('51000000-0000-0000-0000-000000000001', 'Dead',    'Pat'),
  ('51000000-0000-0000-0000-000000000002', 'Spouse',  'Mat'),
  ('51000000-0000-0000-0000-000000000003', 'Parent1', 'Pat'),
  ('51000000-0000-0000-0000-000000000004', 'Parent2', 'Mat'),
  ('51000000-0000-0000-0000-000000000005', 'Other',   'Unrelated');

-- on_auth_user_created (#17) already inserted a pending/viewer row per
-- auth.users id above; upsert it into shape rather than a bare insert.
insert into public.account (id, role, status, person_id) values
  ('50000000-0000-0000-0000-000000000001', 'admin',     'active', null),
  ('50000000-0000-0000-0000-000000000002', 'moderator', 'active', null),
  ('50000000-0000-0000-0000-000000000003', 'viewer',    'active',
   '51000000-0000-0000-0000-000000000001')
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status,
  person_id = excluded.person_id;

-- Dead + Spouse's family (partner1 = Dead) and Parent1 + Parent2's family
-- (Dead is their child).
insert into public.family (id, partner1_id, partner2_id, relationship_type) values
  ('52000000-0000-0000-0000-000000000001',
   '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002', 'married'),
  ('52000000-0000-0000-0000-000000000002',
   '51000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000004', 'married');

insert into public.family_child (id, family_id, person_id) values
  ('53000000-0000-0000-0000-000000000001',
   '52000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001');

insert into public.person_name (id, person_id, type, given_name) values
  ('54000000-0000-0000-0000-000000000001',
   '51000000-0000-0000-0000-000000000001', 'nickname', 'Deadeye');

insert into public.event (id, owner_type, person_id, type) values
  ('55000000-0000-0000-0000-000000000001', 'person',
   '51000000-0000-0000-0000-000000000001', 'birth');

insert into public.fact (id, owner_type, person_id, type) values
  ('56000000-0000-0000-0000-000000000001', 'person',
   '51000000-0000-0000-0000-000000000001', 'eye_color');

insert into public.source (id, title) values
  ('57000000-0000-0000-0000-000000000001', 'Dead''s source'),
  ('57000000-0000-0000-0000-000000000002', 'Other''s source');

-- Citations owned by Dead directly, by Dead's birth event, and by Dead's
-- alternate name -- the three citation_owner values that can point at rows
-- this delete touches.
insert into public.citation (id, source_id, owner_type, owner_id) values
  ('58000000-0000-0000-0000-000000000001',
   '57000000-0000-0000-0000-000000000001', 'person',
   '51000000-0000-0000-0000-000000000001'),
  ('58000000-0000-0000-0000-000000000002',
   '57000000-0000-0000-0000-000000000001', 'event',
   '55000000-0000-0000-0000-000000000001'),
  ('58000000-0000-0000-0000-000000000003',
   '57000000-0000-0000-0000-000000000001', 'person_name',
   '54000000-0000-0000-0000-000000000001'),
  ('58000000-0000-0000-0000-000000000010',
   '57000000-0000-0000-0000-000000000002', 'person',
   '51000000-0000-0000-0000-000000000005');  -- Other's own citation

insert into public.media (id, original_filename) values
  ('59000000-0000-0000-0000-000000000001', 'dead.jpg'),
  ('59000000-0000-0000-0000-000000000002', 'other.jpg');

-- media_link owned by Dead directly and by Dead's fact.
insert into public.media_link (id, media_id, owner_type, owner_id) values
  ('5a000000-0000-0000-0000-000000000001',
   '59000000-0000-0000-0000-000000000001', 'person',
   '51000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000002',
   '59000000-0000-0000-0000-000000000001', 'fact',
   '56000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000010',
   '59000000-0000-0000-0000-000000000002', 'person',
   '51000000-0000-0000-0000-000000000005');  -- Other's own media_link

-- note directly on Dead, on Dead's birth event, on Dead's family_child row,
-- and on one of Dead's citations (the recursive notes-on-citation leg) --
-- plus one on Other, to prove it survives.
insert into public.note (id, owner_type, owner_id, text) values
  ('5b000000-0000-0000-0000-000000000001', 'person',
   '51000000-0000-0000-0000-000000000001', 'about Dead'),
  ('5b000000-0000-0000-0000-000000000002', 'event',
   '55000000-0000-0000-0000-000000000001', 'about Dead''s birth'),
  ('5b000000-0000-0000-0000-000000000003', 'family_child',
   '53000000-0000-0000-0000-000000000001', 'about Dead as a child'),
  ('5b000000-0000-0000-0000-000000000004', 'citation',
   '58000000-0000-0000-0000-000000000002', 'about the birth citation'),
  ('5b000000-0000-0000-0000-000000000010', 'person',
   '51000000-0000-0000-0000-000000000005', 'about Other');

set local role authenticated;

-- ===========================================================================
-- A moderator may not call it -- and the whole call is atomic, not
-- partially applied (SPEC "Done when": a moderator cannot).
-- ===========================================================================

select pg_temp.act_as('50000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.delete_person('51000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'delete_person: a moderator is refused'
);
select is(
  (select count(*)::int from public.person
     where id = '51000000-0000-0000-0000-000000000001'),
  1,
  'delete_person: Dead still exists after a refused moderator call'
);
select is(
  (select count(*)::int from public.note
     where owner_type = 'person'
       and owner_id = '51000000-0000-0000-0000-000000000001'),
  1,
  'delete_person: a refused call left Dead''s direct note untouched too -- no partial delete'
);

-- ===========================================================================
-- An admin deleting an already-gone person is a no-op, not an error.
-- ===========================================================================

select pg_temp.act_as('50000000-0000-0000-0000-000000000001');
select is(
  public.delete_person('5f000000-0000-0000-0000-000000000000'),
  false,
  'delete_person: a nonexistent person returns false'
);

-- ===========================================================================
-- An admin deleting Dead cascades and cleans up correctly.
-- ===========================================================================

select is(
  public.delete_person('51000000-0000-0000-0000-000000000001'),
  true,
  'delete_person: an admin deletes Dead'
);

select is(
  (select count(*)::int from public.person
     where id = '51000000-0000-0000-0000-000000000001'),
  0,
  'person row is gone'
);
select is(
  (select count(*)::int from public.person_name
     where id = '54000000-0000-0000-0000-000000000001'),
  0,
  'person_name cascaded'
);
select is(
  (select count(*)::int from public.event
     where id = '55000000-0000-0000-0000-000000000001'),
  0,
  'event cascaded'
);
select is(
  (select count(*)::int from public.fact
     where id = '56000000-0000-0000-0000-000000000001'),
  0,
  'fact cascaded'
);
select is(
  (select count(*)::int from public.family_child
     where id = '53000000-0000-0000-0000-000000000001'),
  0,
  'family_child cascaded'
);

select is(
  (select partner1_id from public.family
     where id = '52000000-0000-0000-0000-000000000001'),
  null,
  'family row survives with the partner slot nulled, not deleted'
);
select is(
  (select partner2_id from public.family
     where id = '52000000-0000-0000-0000-000000000001'),
  '51000000-0000-0000-0000-000000000002'::uuid,
  'the other partner (Spouse) is untouched'
);
select is(
  (select count(*)::int from public.family
     where id = '52000000-0000-0000-0000-000000000002'),
  1,
  'Parent1 + Parent2''s family row survives (Dead was only a child there)'
);

select is(
  (select person_id from public.account
     where id = '50000000-0000-0000-0000-000000000003'),
  null,
  'the linked account is unlinked, not deleted'
);
select is(
  (select status from public.account
     where id = '50000000-0000-0000-0000-000000000003'),
  'active'::public.account_status,
  'the unlinked account keeps its status'
);

select is(
  (select count(*)::int from public.citation
     where id in (
       '58000000-0000-0000-0000-000000000001',
       '58000000-0000-0000-0000-000000000002',
       '58000000-0000-0000-0000-000000000003'
     )),
  0,
  'every citation owned by Dead, Dead''s event, or Dead''s alternate name is gone'
);
select is(
  (select count(*)::int from public.note
     where id in (
       '5b000000-0000-0000-0000-000000000001',
       '5b000000-0000-0000-0000-000000000002',
       '5b000000-0000-0000-0000-000000000003',
       '5b000000-0000-0000-0000-000000000004'
     )),
  0,
  'every note on Dead, Dead''s event, Dead''s family_child row, and Dead''s '
  'own citation is gone'
);
select is(
  (select count(*)::int from public.media_link
     where id in (
       '5a000000-0000-0000-0000-000000000001',
       '5a000000-0000-0000-0000-000000000002'
     )),
  0,
  'every media_link owned by Dead or Dead''s fact is gone'
);

select is(
  (select count(*)::int from public.source
     where id = '57000000-0000-0000-0000-000000000001'),
  1,
  'the shared source row survives -- only the citation rows were removed'
);
select is(
  (select count(*)::int from public.media
     where id = '59000000-0000-0000-0000-000000000001'),
  1,
  'the shared media asset survives -- only the media_link rows were removed'
);

select is(
  (select count(*)::int from public.citation
     where id = '58000000-0000-0000-0000-000000000010'),
  1,
  'Other''s unrelated citation is untouched'
);
select is(
  (select count(*)::int from public.media_link
     where id = '5a000000-0000-0000-0000-000000000010'),
  1,
  'Other''s unrelated media_link is untouched'
);
select is(
  (select count(*)::int from public.note
     where id = '5b000000-0000-0000-0000-000000000010'),
  1,
  'Other''s unrelated note is untouched'
);

set local role postgres;

select * from finish();
rollback;
