-- search_persons(words): the name match behind the header search, the
-- pickers, and the /people filter. Issues #111/#112/#113, migration
-- 20260920090000.
--
-- Same harness style as request_hide_test.sql: fixtures built as the
-- superuser pg_prove connects as, identity switched with a fake JWT.

begin;
select plan(19);

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

-- Only this file's own fixtures count (#109): a shared local stack holds
-- whatever tree was last imported, and the demo tree has a "Bud" of its own.
create function pg_temp.found(p_words text[])
returns text[]
language sql
as $$
  select coalesce(
    array_agg(coalesce(given_name, '') || '|' || coalesce(surname, '')
              order by surname nulls last, given_name nulls last),
    '{}'::text[])
  from public.search_persons(p_words)
  where id::text like '65000000-%';
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Ids in the 64…/65… range, unused by the seed and other tests.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('64000000-0000-0000-0000-000000000001'),  -- viewer
  ('64000000-0000-0000-0000-000000000002');  -- moderator

insert into public.person (id, given_name, surname, nickname, visibility) values
  ('65000000-0000-0000-0000-000000000001', 'Gideon', 'Qatestsson', null,   'everyone_approved'),
  ('65000000-0000-0000-0000-000000000002', 'Greta',  'Qatestsson', 'Gigi', 'everyone_approved'),
  ('65000000-0000-0000-0000-000000000003', null,     null,         'Bud',  'everyone_approved'),
  ('65000000-0000-0000-0000-000000000004', 'Vera',   'Qatestsson', null,   'everyone_approved'),
  ('65000000-0000-0000-0000-000000000005', 'Hilda',  'Qatestsson', null,   'moderators_only'),
  ('65000000-0000-0000-0000-000000000006', '100%',   'Sure_thing', null,   'everyone_approved'),
  ('65000000-0000-0000-0000-000000000007', 'Back\slash', 'Qatestsson', null, 'everyone_approved');

-- Vera's maiden name lives only on a person_name variant.
insert into public.person_name (id, person_id, type, given_name, surname) values
  ('66000000-0000-0000-0000-000000000001',
   '65000000-0000-0000-0000-000000000004', 'maiden', 'Vera', 'Maidenly');

insert into public.account (id, role, status, person_id) values
  ('64000000-0000-0000-0000-000000000001', 'viewer',    'active', null),
  ('64000000-0000-0000-0000-000000000002', 'moderator', 'active', null)
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status,
  person_id = excluded.person_id;

set local role authenticated;

-- --- shape -----------------------------------------------------------------

select is(
  (select prosecdef from pg_proc where proname = 'search_persons'),
  false,
  'search_persons is SECURITY INVOKER (RLS applies to the caller)');

-- --- matching, as a viewer -------------------------------------------------

select pg_temp.act_as('64000000-0000-0000-0000-000000000001');

select is(
  pg_temp.found(array['Gideon']),
  array['Gideon|Qatestsson'],
  'one word matches the given name');

select is(
  pg_temp.found(array['Gideon', 'Qatestsson']),
  array['Gideon|Qatestsson'],
  'a full name matches across given name and surname of one row (#113)');

select is(
  pg_temp.found(array['qATESTsson', 'gRETA']),
  array['Greta|Qatestsson'],
  'matching is case-insensitive');

select is(
  pg_temp.found(array['gigi']),
  array['Greta|Qatestsson'],
  'a word matches the nickname');

select is(
  pg_temp.found(array['bud']),
  array['|'],
  'a nickname-only person (null given name and surname) is found');

select is(
  pg_temp.found(array['Maidenly']),
  array['Vera|Qatestsson'],
  'a person_name variant (maiden name) finds its person');

select is(
  pg_temp.found(array['Vera', 'Maidenly']),
  array['Vera|Qatestsson'],
  'a full name matches across the columns of one person_name row');

select is(
  pg_temp.found(array['Gideon', 'Maidenly']),
  '{}'::text[],
  'the per-word AND does not straddle two people');

select is(
  pg_temp.found(array['Nobody']),
  '{}'::text[],
  'no match -> no rows');

-- Compared against the RLS-visible `person` count rather than a literal, so
-- the test holds on a shared local stack that already has people in it.
select is(
  (select count(*) from public.search_persons('{}'::text[])),
  (select count(*) from public.person),
  'an empty word list matches everyone the caller may see');

select is(
  (select count(*) from public.search_persons(array['', '  '])),
  (select count(*) from public.person),
  'blank words are ignored, not matched against');

select ok(
  (select count(*) from public.search_persons('{}'::text[])) >= 6,
  'the unfiltered result includes the fixtures');

-- --- wildcards are literal (#112) ------------------------------------------

select is(
  pg_temp.found(array['%']),
  array['100%|Sure_thing'],
  '"%" matches only a name that contains a percent sign');

select is(
  pg_temp.found(array['_']),
  array['100%|Sure_thing'],
  '"_" matches only a name that contains an underscore');

select is(
  pg_temp.found(array['\']),
  array['Back\slash|Qatestsson'],
  'a backslash is escaped before the wildcards are, so it stays literal');

select is(
  pg_temp.found(array[' Gideon ']),
  array['Gideon|Qatestsson'],
  'a word is trimmed before it becomes a pattern');

-- --- visibility ------------------------------------------------------------

select is(
  pg_temp.found(array['Hilda']),
  '{}'::text[],
  'a viewer does not find a moderators_only person by name');

select pg_temp.act_as('64000000-0000-0000-0000-000000000002');
select is(
  pg_temp.found(array['Hilda']),
  array['Hilda|Qatestsson'],
  'a moderator does');

select * from finish();
rollback;
