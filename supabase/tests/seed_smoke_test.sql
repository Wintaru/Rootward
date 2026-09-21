-- seed.sql smoke test (issue #38). Confirms `supabase db reset` / `supabase
-- start` produced the demo tree and an active admin account.
--
-- Unlike the other pgTAP suites, this one depends on seed.sql having loaded --
-- that is the point. On a shared local stack the seed is often gone (wiped,
-- re-imported, `--no-seed`), so the whole file skips unless the seed's own
-- root person -- Cornelius Ashby, with the fixed id only seed.sql writes --
-- is present (#109). pg_prove counts a skip as a pass, so CI's "Check the
-- seed loaded" step (`.github/workflows/ci.yml`) asserts that same row
-- before `supabase test db`: there, the seed must load and this file must
-- run. Counts that were exact are scoped to seed ids, so rows other tests
-- or the e2e suite add alongside the seed do not fail it.
--
-- Runs as the superuser pg_prove connects as; no RLS identity switch, so every
-- count is the raw table count.

begin;
select plan(12);

select exists (
  select 1 from public.person
  where id = 'd0000000-0000-4000-8000-000000000001'
) as seeded \gset

\if :seeded

-- --- the Ashby demo tree loaded -------------------------------------------

select cmp_ok((select count(*)::int from public.person), '>=', 28,
  'seed loaded the Ashby persons');
select cmp_ok((select count(*)::int from public.family), '>=', 11,
  'seed loaded the Ashby families');
select cmp_ok((select count(*)::int from public.family_child), '>=', 16,
  'seed loaded the child memberships');
select cmp_ok((select count(*)::int from public.event), '>=', 45,
  'seed loaded birth / death / marriage events');
select cmp_ok((select count(*)::int from public.place), '>=', 3,
  'seed loaded places');
select is(
  (select count(*)::int from public.citation
   where id = 'd6000000-0000-4000-8000-000000000003'),
  1,
  'seed loaded its citation (source + repository + note come with it)');

-- --- RLS fixtures the later phases rely on -------------------------------

select cmp_ok(
  (select count(*)::int from public.person where is_living is true),
  '>=', 1,
  'at least one living person (RLS living-person path, #9)');
select cmp_ok(
  (select count(*)::int
   from public.event where owner_type = 'person' and type = 'death'),
  '>=', 1,
  'at least one person has a death event (RLS deceased path, #9)');
select is(
  (select array_agg(visibility::text order by id)
   from public.person
   where id in ('d0000000-0000-4000-8000-000000000017',
                'd0000000-0000-4000-8000-000000000019')),
  array['moderators_only', 'hidden'],
  'seed includes one moderators_only and one hidden person');

-- --- pedigree collapse: Josiah and Ruth are siblings, so Samuel's line
--     folds back onto Cornelius + Temperance through both parents (#21) ------

-- F1 → Josiah + Ruth (siblings); Josiah → Nathaniel (F2); Ruth → Catherine
-- (F3); Nathaniel + Catherine → Samuel (F4). All four links must hold for the
-- collapse to exist.
select is(
  (select count(*)::int from public.family_child
   where (family_id, person_id) in (values
     ('d2000000-0000-4000-8000-000000000001'::uuid, 'd0000000-0000-4000-8000-000000000003'::uuid),
     ('d2000000-0000-4000-8000-000000000001'::uuid, 'd0000000-0000-4000-8000-000000000004'::uuid),
     ('d2000000-0000-4000-8000-000000000002'::uuid, 'd0000000-0000-4000-8000-000000000007'::uuid),
     ('d2000000-0000-4000-8000-000000000003'::uuid, 'd0000000-0000-4000-8000-000000000008'::uuid),
     ('d2000000-0000-4000-8000-000000000004'::uuid, 'd0000000-0000-4000-8000-000000000009'::uuid))),
  5,
  'the full pedigree-collapse path F1 → {Josiah, Ruth} → {Nathaniel, Catherine} → Samuel is wired');

-- --- tree settings + admin --------------------------------------------------

select is(
  (select exists (
     select 1 from public.person p
     join public.tree_settings ts on ts.default_root_person_id = p.id
     where ts.id = 1)),
  true,
  'tree_settings.default_root_person_id resolves to a real person');

select is(
  (select role::text || '/' || status::text
   from public.account where id = 'da000000-0000-4000-8000-0000000000a1'),
  'admin/active',
  'the demo admin account is an active admin');

\else

select skip(
  'seed.sql is not loaded (no Cornelius Ashby) -- run supabase db reset',
  12
);

\endif

select * from finish();
rollback;
