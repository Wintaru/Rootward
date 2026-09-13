-- request_hide(person, reason): the RPC behind "Ask a moderator to hide this
-- record" (SPEC §5/§7, decisions 7/14/27). Issue #61, migration 20260913193000.
--
-- Same harness style as access_request_notify_test.sql / delete_person_test.sql:
-- isolated fixtures built as the superuser pg_prove connects as, identity
-- switched with a fake JWT.

begin;
select plan(15);

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
--   Parent1 ── Parent2         Unrelated
--        |
--   Kid1        Kid2
--
--   viewer_self  -- account linked to Kid1 (asks to hide their own record)
--   viewer_parent -- account linked to Parent1 (asks to hide Kid2's record)
--   viewer_other -- account linked to Unrelated (no relation to Kid1/Kid2)
--   viewer_no_person -- active account with no linked person
--   viewer_pending -- account not yet approved
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('60000000-0000-0000-0000-000000000001'),  -- viewer_self
  ('60000000-0000-0000-0000-000000000002'),  -- viewer_parent
  ('60000000-0000-0000-0000-000000000003'),  -- viewer_other
  ('60000000-0000-0000-0000-000000000004'),  -- viewer_no_person
  ('60000000-0000-0000-0000-000000000005');  -- viewer_pending

insert into public.person (id, given_name, surname) values
  ('61000000-0000-0000-0000-000000000001', 'Parent1',   'Pat'),
  ('61000000-0000-0000-0000-000000000002', 'Parent2',   'Mat'),
  ('61000000-0000-0000-0000-000000000003', 'Kid1',      'Pat'),
  ('61000000-0000-0000-0000-000000000004', 'Kid2',      'Pat'),
  ('61000000-0000-0000-0000-000000000005', 'Unrelated', 'Nun');

insert into public.family (id, partner1_id, partner2_id, relationship_type)
values (
  '62000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002',
  'married'
);

insert into public.family_child (id, family_id, person_id) values
  ('63000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000003'),
  ('63000000-0000-0000-0000-000000000002',
   '62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000004');

-- on_auth_user_created (#17) already inserted a pending/viewer row per
-- auth.users id above; upsert it into shape rather than a bare insert.
insert into public.account (id, role, status, person_id) values
  ('60000000-0000-0000-0000-000000000001', 'viewer', 'active',
   '61000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000002', 'viewer', 'active',
   '61000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000003', 'viewer', 'active',
   '61000000-0000-0000-0000-000000000005'),
  ('60000000-0000-0000-0000-000000000004', 'viewer', 'active', null),
  ('60000000-0000-0000-0000-000000000005', 'viewer', 'pending', null)
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status,
  person_id = excluded.person_id;

set local role authenticated;

-- --- shape -----------------------------------------------------------------

select is(
  (select prosecdef from pg_proc where proname = 'request_hide'),
  true,
  'request_hide is SECURITY DEFINER');

-- --- happy path: a viewer asks to hide their own record --------------------

select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.request_hide(
       '61000000-0000-0000-0000-000000000003', 'I would like some privacy') $$,
  'request_hide: a self-linked viewer may ask for their own record');

-- notification_select RLS is is_moderator()-only; switch to postgres (bypasses
-- RLS) to verify the row a viewer's own call just wrote.
set local role postgres;

select is(
  (select count(*)::int from public.notification
     where type = 'hide_request'
       and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000003'),
  1,
  'exactly one hide_request notification for Kid1');

select is(
  (select payload ->> 'requested_by' from public.notification
     where type = 'hide_request'
       and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000003'),
  '60000000-0000-0000-0000-000000000001',
  'the notification names the requesting account');

select is(
  (select payload ->> 'message' from public.notification
     where type = 'hide_request'
       and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000003'),
  'I would like some privacy',
  'the notification carries the free-text reason');

-- --- happy path: a linked parent asks to hide their child's record ---------

set local role authenticated;
select pg_temp.act_as('60000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.request_hide('61000000-0000-0000-0000-000000000004') $$,
  'request_hide: a linked parent may ask to hide their child''s record');

set local role postgres;

select is(
  (select count(*)::int from public.notification
     where type = 'hide_request'
       and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000004'),
  1,
  'exactly one hide_request notification for Kid2');

select is(
  (select payload ->> 'message' from public.notification
     where type = 'hide_request'
       and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000004'),
  null,
  'an omitted reason leaves the message field null');

-- --- dedup: a second open request for the same person doesn't stack -------

set local role authenticated;
select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.request_hide(
       '61000000-0000-0000-0000-000000000003', 'again') $$,
  'request_hide: calling a second time does not raise');

set local role postgres;

select is(
  (select count(*)::int from public.notification
     where type = 'hide_request'
       and resolved_at is null
       and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000003'),
  1,
  'a second request for the same person does not stack a notification');

-- Resolve it, then a new request raises a fresh one.
set local role postgres;
update public.notification
set resolved_at = now(), resolved_by = '60000000-0000-0000-0000-000000000002'
where type = 'hide_request'
  and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000003';
set local role authenticated;

select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.request_hide('61000000-0000-0000-0000-000000000003') $$,
  'request_hide: a fresh request after resolution is allowed');

set local role postgres;

select is(
  (select count(*)::int from public.notification
     where type = 'hide_request'
       and resolved_at is null
       and payload ->> 'person_id' = '61000000-0000-0000-0000-000000000003'),
  1,
  'a new request after resolution raises exactly one open notification');

-- --- unauthorized: unrelated, unlinked, and pending callers are refused ----

set local role authenticated;
select pg_temp.act_as('60000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.request_hide('61000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'request_hide: an unrelated viewer is refused');

select pg_temp.act_as('60000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ select public.request_hide('61000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'request_hide: a not-yet-approved account is refused');

select pg_temp.act_as('60000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.request_hide('61000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'request_hide: an account with no linked person is refused');

select * from finish();
rollback;
