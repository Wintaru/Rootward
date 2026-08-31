-- onboarding_match_search(): the trigram candidate search behind the self-claim
-- flow. Issue #18, SPEC §7 (onboarding-match), decision 24.
--
-- Verifies fuzzy name matching, the exact-year / month +/-1 birth filter, the
-- score threshold, the "no identifying data" return shape, and that the
-- function is SECURITY DEFINER with the intended grants.

begin;
select plan(13);

-- --- fixtures ----------------------------------------------------------
-- Two people born 1901: a target ("Katherine Ashby") and an unrelated
-- near-name ("Catherine Ashby") born a different year. Plus a person_name
-- variant and a no-birth-event person that must never match.

insert into public.person (id, given_name, surname) values
  ('d1000000-0000-0000-0000-000000000001', 'Katherine', 'Ashby'),
  ('d1000000-0000-0000-0000-000000000002', 'Catherine', 'Ashby'),
  ('d1000000-0000-0000-0000-000000000003', 'Margaret',  'Ashby'),
  ('d1000000-0000-0000-0000-000000000004', 'No',        'Birthdate');

insert into public.person_name (id, person_id, type, given_name, surname) values
  ('d1000000-0000-0000-0000-0000000000a1',
   'd1000000-0000-0000-0000-000000000003', 'maiden', 'Peggy', 'Ashby');

insert into public.event
  (id, owner_type, person_id, type, date_year1, date_month1) values
  ('d1000000-0000-0000-0000-0000000000e1', 'person',
   'd1000000-0000-0000-0000-000000000001', 'birth', 1901, 6),  -- target
  ('d1000000-0000-0000-0000-0000000000e2', 'person',
   'd1000000-0000-0000-0000-000000000002', 'birth', 1875, 6),  -- wrong year
  ('d1000000-0000-0000-0000-0000000000e3', 'person',
   'd1000000-0000-0000-0000-000000000003', 'birth', 1901, 9);  -- wrong month

-- --- shape -----------------------------------------------------------

select function_returns(
  'public', 'onboarding_match_search',
  array['text', 'text', 'integer', 'integer', 'real'],
  'setof record',
  'onboarding_match_search returns a set of records');

select is(
  (select array_agg(a.attname order by a.attname)::text[]
   from pg_proc p
   join lateral unnest(p.proargnames, p.proargmodes) as a(attname, mode) on true
   where p.proname = 'onboarding_match_search'
     and a.mode = 't'),
  array['person_id', 'score']::text[],
  'the OUT columns are person_id + score only -- nothing identifying');

select is(
  (select prosecdef from pg_proc where proname = 'onboarding_match_search'),
  true,
  'onboarding_match_search is SECURITY DEFINER');

select function_privs_are(
  'public', 'onboarding_match_search',
  array['text', 'text', 'integer', 'integer', 'real'],
  'authenticated', array['EXECUTE'],
  'a not-yet-approved (authenticated) caller may execute it');

select function_privs_are(
  'public', 'onboarding_match_search',
  array['text', 'text', 'integer', 'integer', 'real'],
  'service_role', array['EXECUTE'],
  'the edge function (service_role) may execute it');

select function_privs_are(
  'public', 'onboarding_match_search',
  array['text', 'text', 'integer', 'integer', 'real'],
  'anon', array[]::text[],
  'an anonymous visitor may not execute it');

-- --- matching -------------------------------------------------------

select is(
  (select person_id
   from public.onboarding_match_search('Katherine', 'Ashby', 1901, 6)
   limit 1),
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'exact name + birth year/month returns the target');

select ok(
  exists(
    select 1 from public.onboarding_match_search('Kathryn', 'Ashby', 1901, 6)
    where person_id = 'd1000000-0000-0000-0000-000000000001'),
  'a fuzzy given name (Kathryn ~ Katherine) still matches');

select ok(
  exists(
    select 1 from public.onboarding_match_search('Katherine', 'Ashby', 1901, 7)
    where person_id = 'd1000000-0000-0000-0000-000000000001'),
  'birth month within +/- 1 still matches');

select ok(
  not exists(
    select 1 from public.onboarding_match_search('Katherine', 'Ashby', 1901, 3)
    where person_id = 'd1000000-0000-0000-0000-000000000001'),
  'birth month more than 1 off does not match');

select ok(
  not exists(
    select 1 from public.onboarding_match_search('Catherine', 'Ashby', 1901, 6)
    where person_id = 'd1000000-0000-0000-0000-000000000002'),
  'a candidate whose birth year does not match is never returned');

select ok(
  exists(
    select 1 from public.onboarding_match_search('Peggy', 'Ashby', 1901, 9)
    where person_id = 'd1000000-0000-0000-0000-000000000003'),
  'a person_name variant (maiden "Peggy") is searched too');

select ok(
  not exists(
    select 1 from public.onboarding_match_search('Zzzzzz', 'Qqqqqq', 1901, 6)),
  'a name nothing resembles scores below the threshold and returns nothing');

select * from finish();
rollback;
