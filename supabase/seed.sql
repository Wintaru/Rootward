-- Local seed data, loaded by `supabase db reset` and the first `supabase start`
-- (see [db.seed] in config.toml). Issue #38.
--
-- Contents:
--   1. A demo admin account you can sign in as locally.
--   2. `tree_settings`: a tree name + the default root person.
--   3. "The Ashby Family" — a fictional 9-generation tree that exercises the
--      tree view (#21-#24), the pg_trgm onboarding match (#18), and the RLS
--      visibility ladder (#9).
--
-- The Ashby tree is deliberately NOT the same family as the demo GEDCOM
-- (`docs/reference/demo-tree.ged`, the Marsh family). Each has one job: this
-- seed is the always-present tree for a fresh local database; the GEDCOM is a
-- file to test import/export with. Keeping them independent avoids a SQL tree
-- and a GEDCOM tree of the same people drifting apart.
--
-- Only data insertions here (no schema) — schema is migrations.
-- Not idempotent: the genealogy inserts have no `on conflict`, so this runs
-- against an EMPTY database only (a fresh `db reset` / first `start`). It is
-- not written to survive a re-run against a persisted volume.
-- Seeding fires `write_audit_log` once per row, so a fresh DB starts with
-- ~130 `audit_log` rows — expected, not a leak.
-- All ids use the `d…` range so they never collide with the pgTAP fixture
-- ranges (`a…` users, `b…` persons, `c…` families).

-- ===========================================================================
-- 1. Demo admin
-- ===========================================================================
-- Local dev only. Sign in at /login with:
--   email:    admin@rootward.test
--   password: rootward-admin
-- Password sign-in is not a product feature (decision 11 is magic link + Google)
-- — it is just the quickest way to get an active admin session on a local box.
-- `on_auth_user_created` (#17) creates the matching `public.account` row; the
-- upsert below promotes it to an active admin. In a real deployment the
-- ADMIN_EMAIL bootstrap in the web tier does this instead (SPEC §9.1).

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'da000000-0000-4000-8000-0000000000a1',
  'authenticated', 'authenticated', 'admin@rootward.test',
  extensions.crypt('rootward-admin', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Demo Admin"}'::jsonb,
  now(), now(),
  '', '', '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values (
  'da000000-0000-4000-8000-0000000000a1',
  'da000000-0000-4000-8000-0000000000a1',
  jsonb_build_object(
    'sub', 'da000000-0000-4000-8000-0000000000a1',
    'email', 'admin@rootward.test',
    'email_verified', true
  ),
  'email',
  now(), now(), now()
)
on conflict (provider_id, provider) do nothing;

insert into public.account (id, role, status, display_name)
values (
  'da000000-0000-4000-8000-0000000000a1', 'admin', 'active', 'Demo Admin'
)
on conflict (id) do update
  set role = excluded.role,
      status = excluded.status,
      display_name = excluded.display_name;

-- ===========================================================================
-- 2. Places
-- ===========================================================================

insert into public.place (id, name, normalized_name, locality, county, state, country) values
  ('d5000000-0000-4000-8000-000000000001', 'Salem, Essex, Massachusetts, USA',
   'salem, essex, massachusetts, usa', 'Salem', 'Essex', 'Massachusetts', 'USA'),
  ('d5000000-0000-4000-8000-000000000002', 'Danvers, Essex, Massachusetts, USA',
   'danvers, essex, massachusetts, usa', 'Danvers', 'Essex', 'Massachusetts', 'USA'),
  ('d5000000-0000-4000-8000-000000000003', 'Lowell, Middlesex, Massachusetts, USA',
   'lowell, middlesex, massachusetts, usa', 'Lowell', 'Middlesex', 'Massachusetts', 'USA');

-- ===========================================================================
-- 3. The Ashby family
-- ===========================================================================
-- The pedigree-collapse case for #21 (F4 is a first-cousin marriage, so
-- Samuel's ancestry folds back onto Cornelius + Temperance through BOTH of his
-- parents). Person / family numbers below are the last hex digit of the id.
--
--   Cornelius Ashby (1) ── Temperance Blackwood (2)          [family 1]
--     ├─ Josiah Ashby (3) ── Harriet Vance (5)               [family 2]
--     │    └─ Nathaniel Ashby (7) ─┐
--     │                            ├── Samuel Ashby (9)      [family 4]
--     └─ Ruth Ashby (4) ── Elias Crane (6)     [family 3]  ─┘
--          └─ Catherine Crane (8) ┘
--
-- Below Samuel the tree runs one main line to the present:
--   Samuel (9) ─ Katherine Doyle (a)  [f5]  → John Ashby (b), Margaret (c)
--   John (b)   ─ Alice Warren (d)      [f6]  → Robert Ashby (e)
--   Robert (e) ─ Dorothy Vaughn (f)    [f7]  → Susan Ashby (10), Thomas Ashby (11)
--   Susan (10) ─ Michael Hart (12)     [f8]  → Emily Hart (13), Daniel Hart (14)   [living]
--   Thomas (11)─ Linda Osei (15)       [f9]  → Grace Ashby (16), Wendell Ashby (17) [living; Wendell moderators_only]
--   Emily (13) ─ John Piper (18)       [fa]  → Iris Hart (19)   [living; hidden]
--
-- Walter Ashby (1a) ── Florence Gray (1b) [fb] → Harold Ashby (1c) is a
-- separate Ashby line with no link to the main tree — a deliberate
-- shared-surname false positive for the #18 name match.

insert into public.person
  (id, given_name, surname, name_prefix, nickname, sex, is_living, visibility) values
  ('d0000000-0000-4000-8000-000000000001', 'Cornelius', 'Ashby', null, null, 'male',   false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000002', 'Temperance', 'Blackwood', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000003', 'Josiah',    'Ashby', null, null, 'male',   false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000004', 'Ruth',      'Ashby', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000005', 'Harriet',   'Vance', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000006', 'Elias',     'Crane', null, null, 'male',   false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000007', 'Nathaniel', 'Ashby', null, null, 'male',   false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000008', 'Catherine', 'Crane', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000009', 'Samuel',    'Ashby', null, null, 'male',   false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000000a', 'Katherine', 'Doyle', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000000b', 'John',      'Ashby', null, 'Jack', 'male',  false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000000c', 'Margaret',  'Ashby', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000000d', 'Alice',     'Warren', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000000e', 'Robert',    'Ashby', null, null, 'male',   false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000000f', 'Dorothy',   'Vaughn', null, null, 'female', false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000010', 'Susan',     'Ashby', null, null, 'female', null,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000011', 'Thomas',    'Ashby', null, null, 'male',   null,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000012', 'Michael',   'Hart', null, null, 'male',    null,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000013', 'Emily',     'Hart', null, null, 'female',  true,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000014', 'Daniel',    'Hart', null, null, 'male',    true,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000015', 'Linda',     'Osei', null, null, 'female',  true,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000016', 'Grace',     'Ashby', null, null, 'female', true,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000017', 'Wendell',   'Ashby', null, null, 'male',   true,  'moderators_only'),
  ('d0000000-0000-4000-8000-000000000018', 'John',      'Piper', null, null, 'male',   true,  'everyone_approved'),
  ('d0000000-0000-4000-8000-000000000019', 'Iris',      'Hart', null, null, 'female',  true,  'hidden'),
  ('d0000000-0000-4000-8000-00000000001a', 'Walter',    'Ashby', null, null, 'male',   false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000001b', 'Florence',  'Gray', null, null, 'female',  false, 'everyone_approved'),
  ('d0000000-0000-4000-8000-00000000001c', 'Harold',    'Ashby', null, null, 'male',   false, 'everyone_approved');

-- Two additional (married-surname) names, so the tree view and #18 search both
-- have a person_name row to match against.
insert into public.person_name (id, person_id, type, given_name, surname) values
  ('d1000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002', 'married', 'Temperance', 'Ashby'),
  ('d1000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-00000000000a', 'married', 'Katherine', 'Ashby');

-- ---------------------------------------------------------------------------
-- Families
-- ---------------------------------------------------------------------------

insert into public.family
  (id, partner1_id, partner2_id, partner1_role, partner2_role, relationship_type) values
  ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000005', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000004', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000008', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-00000000000a', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000000d', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-00000000000e', 'd0000000-0000-4000-8000-00000000000f', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000010', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000015', 'husband', 'wife', 'married'),
  ('d2000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000000018', 'd0000000-0000-4000-8000-000000000013', 'husband', 'wife', 'partnership'),
  ('d2000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000001a', 'd0000000-0000-4000-8000-00000000001b', 'husband', 'wife', 'married');

insert into public.family_child (id, family_id, person_id, relation_to_partner1, relation_to_partner2, sort_order) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'biological', 'biological', 1),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000007', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000008', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000009', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-00000000000b', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-00000000000c', 'biological', 'biological', 1),
  ('d3000000-0000-4000-8000-000000000008', 'd2000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-00000000000e', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000010', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-00000000000a', 'd2000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000011', 'biological', 'biological', 1),
  ('d3000000-0000-4000-8000-00000000000b', 'd2000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000013', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-00000000000c', 'd2000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000014', 'biological', 'biological', 1),
  ('d3000000-0000-4000-8000-00000000000d', 'd2000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000016', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-00000000000e', 'd2000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000017', 'biological', 'biological', 1),
  ('d3000000-0000-4000-8000-00000000000f', 'd2000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000000019', 'biological', 'biological', 0),
  ('d3000000-0000-4000-8000-000000000010', 'd2000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000001c', 'biological', 'biological', 0);

-- ---------------------------------------------------------------------------
-- Events — a birth for everyone, a death for the older generations, plus the
-- family marriages. `date_kind` values span exact / about / before / between;
-- an occupation fact carries a from_to range. `date_sort_key` is generated and
-- `event.sort_key` is trigger-populated (migration #5).
-- ---------------------------------------------------------------------------

insert into public.event
  (id, owner_type, person_id, type, place_id,
   date_value_raw, date_kind, date_year1, date_month1, date_day1, date_year2) values
  -- births
  ('d4000000-0000-4000-8000-000000000001', 'person', 'd0000000-0000-4000-8000-000000000001', 'birth', 'd5000000-0000-4000-8000-000000000001', 'about 1780', 'about', 1780, null, null, null),
  ('d4000000-0000-4000-8000-000000000002', 'person', 'd0000000-0000-4000-8000-000000000002', 'birth', null, 'about 1784', 'about', 1784, null, null, null),
  ('d4000000-0000-4000-8000-000000000003', 'person', 'd0000000-0000-4000-8000-000000000003', 'birth', 'd5000000-0000-4000-8000-000000000001', '9 Feb 1806', 'exact', 1806, 2, 9, null),
  ('d4000000-0000-4000-8000-000000000004', 'person', 'd0000000-0000-4000-8000-000000000004', 'birth', 'd5000000-0000-4000-8000-000000000001', '14 Aug 1809', 'exact', 1809, 8, 14, null),
  ('d4000000-0000-4000-8000-000000000005', 'person', 'd0000000-0000-4000-8000-000000000005', 'birth', null, '1810', 'exact', 1810, null, null, null),
  ('d4000000-0000-4000-8000-000000000006', 'person', 'd0000000-0000-4000-8000-000000000006', 'birth', null, '1804', 'exact', 1804, null, null, null),
  ('d4000000-0000-4000-8000-000000000007', 'person', 'd0000000-0000-4000-8000-000000000007', 'birth', 'd5000000-0000-4000-8000-000000000001', '3 May 1834', 'exact', 1834, 5, 3, null),
  ('d4000000-0000-4000-8000-000000000008', 'person', 'd0000000-0000-4000-8000-000000000008', 'birth', 'd5000000-0000-4000-8000-000000000002', '21 Nov 1837', 'exact', 1837, 11, 21, null),
  ('d4000000-0000-4000-8000-000000000009', 'person', 'd0000000-0000-4000-8000-000000000009', 'birth', 'd5000000-0000-4000-8000-000000000001', '12 Jun 1863', 'exact', 1863, 6, 12, null),
  ('d4000000-0000-4000-8000-00000000000a', 'person', 'd0000000-0000-4000-8000-00000000000a', 'birth', null, '1867', 'exact', 1867, null, null, null),
  ('d4000000-0000-4000-8000-00000000000b', 'person', 'd0000000-0000-4000-8000-00000000000b', 'birth', 'd5000000-0000-4000-8000-000000000003', '4 Jul 1890', 'exact', 1890, 7, 4, null),
  ('d4000000-0000-4000-8000-00000000000c', 'person', 'd0000000-0000-4000-8000-00000000000c', 'birth', 'd5000000-0000-4000-8000-000000000003', '2 Sep 1893', 'exact', 1893, 9, 2, null),
  ('d4000000-0000-4000-8000-00000000000d', 'person', 'd0000000-0000-4000-8000-00000000000d', 'birth', null, '1895', 'exact', 1895, null, null, null),
  ('d4000000-0000-4000-8000-00000000000e', 'person', 'd0000000-0000-4000-8000-00000000000e', 'birth', 'd5000000-0000-4000-8000-000000000003', '30 Jan 1923', 'exact', 1923, 1, 30, null),
  ('d4000000-0000-4000-8000-00000000000f', 'person', 'd0000000-0000-4000-8000-00000000000f', 'birth', null, '1928', 'exact', 1928, null, null, null),
  ('d4000000-0000-4000-8000-000000000010', 'person', 'd0000000-0000-4000-8000-000000000010', 'birth', 'd5000000-0000-4000-8000-000000000003', '17 Apr 1955', 'exact', 1955, 4, 17, null),
  ('d4000000-0000-4000-8000-000000000011', 'person', 'd0000000-0000-4000-8000-000000000011', 'birth', 'd5000000-0000-4000-8000-000000000003', '8 Oct 1958', 'exact', 1958, 10, 8, null),
  ('d4000000-0000-4000-8000-000000000012', 'person', 'd0000000-0000-4000-8000-000000000012', 'birth', null, '1953', 'exact', 1953, null, null, null),
  ('d4000000-0000-4000-8000-000000000013', 'person', 'd0000000-0000-4000-8000-000000000013', 'birth', 'd5000000-0000-4000-8000-000000000003', '25 Mar 1985', 'exact', 1985, 3, 25, null),
  ('d4000000-0000-4000-8000-000000000014', 'person', 'd0000000-0000-4000-8000-000000000014', 'birth', 'd5000000-0000-4000-8000-000000000003', '6 Jun 1988', 'exact', 1988, 6, 6, null),
  ('d4000000-0000-4000-8000-000000000015', 'person', 'd0000000-0000-4000-8000-000000000015', 'birth', null, '1961', 'exact', 1961, null, null, null),
  ('d4000000-0000-4000-8000-000000000016', 'person', 'd0000000-0000-4000-8000-000000000016', 'birth', 'd5000000-0000-4000-8000-000000000003', '19 Sep 1990', 'exact', 1990, 9, 19, null),
  ('d4000000-0000-4000-8000-000000000017', 'person', 'd0000000-0000-4000-8000-000000000017', 'birth', null, '12 Feb 1992', 'exact', 1992, 2, 12, null),
  ('d4000000-0000-4000-8000-000000000018', 'person', 'd0000000-0000-4000-8000-000000000018', 'birth', null, '1983', 'exact', 1983, null, null, null),
  ('d4000000-0000-4000-8000-000000000019', 'person', 'd0000000-0000-4000-8000-000000000019', 'birth', null, '2012', 'exact', 2012, null, null, null),
  ('d4000000-0000-4000-8000-00000000001a', 'person', 'd0000000-0000-4000-8000-00000000001a', 'birth', null, '1901', 'exact', 1901, null, null, null),
  ('d4000000-0000-4000-8000-00000000001b', 'person', 'd0000000-0000-4000-8000-00000000001b', 'birth', null, '1905', 'exact', 1905, null, null, null),
  ('d4000000-0000-4000-8000-00000000001c', 'person', 'd0000000-0000-4000-8000-00000000001c', 'birth', null, '1929', 'exact', 1929, null, null, null),
  -- deaths
  ('d4000000-0000-4000-8000-000000000030', 'person', 'd0000000-0000-4000-8000-000000000001', 'death', 'd5000000-0000-4000-8000-000000000001', '1849', 'exact', 1849, null, null, null),
  ('d4000000-0000-4000-8000-000000000031', 'person', 'd0000000-0000-4000-8000-000000000002', 'death', null, 'before 1850', 'before', 1850, null, null, null),
  ('d4000000-0000-4000-8000-000000000032', 'person', 'd0000000-0000-4000-8000-00000000000b', 'death', 'd5000000-0000-4000-8000-000000000003', '11 Mar 1961', 'exact', 1961, 3, 11, null),
  ('d4000000-0000-4000-8000-000000000033', 'person', 'd0000000-0000-4000-8000-00000000000e', 'death', null, '2001', 'exact', 2001, null, null, null),
  ('d4000000-0000-4000-8000-000000000034', 'person', 'd0000000-0000-4000-8000-00000000000f', 'death', null, '2015', 'exact', 2015, null, null, null),
  ('d4000000-0000-4000-8000-000000000035', 'person', 'd0000000-0000-4000-8000-00000000001a', 'death', null, '1974', 'exact', 1974, null, null, null),
  ('d4000000-0000-4000-8000-000000000036', 'person', 'd0000000-0000-4000-8000-00000000001b', 'death', null, '1980', 'exact', 1980, null, null, null),
  ('d4000000-0000-4000-8000-000000000037', 'person', 'd0000000-0000-4000-8000-00000000001c', 'death', null, 'between 2003 and 2005', 'between', 2003, null, null, 2005);

insert into public.event
  (id, owner_type, family_id, type, place_id,
   date_value_raw, date_kind, date_year1, date_month1, date_day1) values
  ('d4000000-0000-4000-8000-000000000050', 'family', 'd2000000-0000-4000-8000-000000000001', 'marriage', 'd5000000-0000-4000-8000-000000000001', '6 May 1804', 'exact', 1804, 5, 6),
  ('d4000000-0000-4000-8000-000000000051', 'family', 'd2000000-0000-4000-8000-000000000002', 'marriage', null, 'about 1832', 'about', 1832, null, null),
  ('d4000000-0000-4000-8000-000000000052', 'family', 'd2000000-0000-4000-8000-000000000003', 'marriage', null, '11 Jun 1835', 'exact', 1835, 6, 11),
  ('d4000000-0000-4000-8000-000000000053', 'family', 'd2000000-0000-4000-8000-000000000004', 'marriage', 'd5000000-0000-4000-8000-000000000002', '24 Dec 1861', 'exact', 1861, 12, 24),
  ('d4000000-0000-4000-8000-000000000054', 'family', 'd2000000-0000-4000-8000-000000000005', 'marriage', null, '3 Oct 1888', 'exact', 1888, 10, 3),
  ('d4000000-0000-4000-8000-000000000055', 'family', 'd2000000-0000-4000-8000-000000000006', 'marriage', null, '2 Apr 1921', 'exact', 1921, 4, 2),
  ('d4000000-0000-4000-8000-000000000056', 'family', 'd2000000-0000-4000-8000-000000000007', 'marriage', null, '1952', 'exact', 1952, null, null),
  ('d4000000-0000-4000-8000-000000000057', 'family', 'd2000000-0000-4000-8000-000000000008', 'marriage', null, '1983', 'exact', 1983, null, null),
  ('d4000000-0000-4000-8000-000000000058', 'family', 'd2000000-0000-4000-8000-000000000009', 'marriage', null, '1988', 'exact', 1988, null, null),
  ('d4000000-0000-4000-8000-000000000059', 'family', 'd2000000-0000-4000-8000-00000000000a', 'marriage', null, '2010', 'exact', 2010, null, null),
  ('d4000000-0000-4000-8000-00000000005a', 'family', 'd2000000-0000-4000-8000-00000000000b', 'marriage', null, '1927', 'exact', 1927, null, null);

-- ---------------------------------------------------------------------------
-- One fact with a from_to date range, plus a source / repository / citation
-- and a note — enough for the Sources and Notes sections (#30, #31) and the
-- #15 export path to have something to serialise.
-- ---------------------------------------------------------------------------

insert into public.fact
  (id, owner_type, person_id, type, value,
   date_value_raw, date_kind, date_year1, date_year2) values
  ('d4000000-0000-4000-8000-000000000070', 'person', 'd0000000-0000-4000-8000-000000000003',
   'occupation', 'Shipwright', 'from 1830 to 1865', 'from_to', 1830, 1865);

insert into public.repository (id, name, address, website) values
  ('d6000000-0000-4000-8000-000000000001', 'American Antiquarian Society',
   '185 Salisbury Street, Worcester, Massachusetts', 'https://www.americanantiquarian.org');

insert into public.source (id, title, author, publication_info, repository_id) values
  ('d6000000-0000-4000-8000-000000000002', 'Vital Records of Salem, Massachusetts, to the End of the Year 1849',
   'Essex Institute', 'Salem, Mass.: The Essex Institute, 1916',
   'd6000000-0000-4000-8000-000000000001');

insert into public.citation (id, source_id, owner_type, owner_id, page, quality) values
  ('d6000000-0000-4000-8000-000000000003', 'd6000000-0000-4000-8000-000000000002',
   'person', 'd0000000-0000-4000-8000-000000000009', 'vol. 1, p. 214', 3);

insert into public.note (id, owner_type, owner_id, text) values
  ('d6000000-0000-4000-8000-000000000004', 'person', 'd0000000-0000-4000-8000-000000000001',
   'Family tradition holds the Ashbys came from Yorkshire around 1750. Unverified. Demo data.');

-- ===========================================================================
-- 4. Tree settings — name the tree and point the default root at Samuel Ashby
--    (mid-tree, so the hourglass view shows both ancestors and descendants).
-- ===========================================================================

update public.tree_settings
  set tree_name = 'The Ashby Family (demo)',
      tree_description = 'Fictional demo data shipped with Rootward. Reset with `supabase db reset`.',
      default_root_person_id = 'd0000000-0000-4000-8000-000000000009'
  where id = 1;
