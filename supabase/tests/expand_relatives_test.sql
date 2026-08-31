-- expand_relatives(person, relation): the scoped one-branch fetch behind the
-- tree view's expand-in-place affordance. Issue #24, migration
-- 20260831201221. Verifies each of the three relations, that a resolved
-- family's child_ids stays scoped (no leaking a sibling / no re-fetching a
-- known parent), that can_expand_up / can_expand_down only ever continue the
-- direction just walked, and that RLS still decides what comes back.
--
-- Same harness style as get_neighborhood_test.sql: fixtures built as the
-- superuser pg_prove connects as, identity switched with a fake JWT.

begin;
select plan(18);

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

create function pg_temp.person_ids(p jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg(v ->> 'id' order by v ->> 'id'), array[]::text[])
  from jsonb_array_elements(p -> 'persons') v
$$;

create function pg_temp.field(p jsonb, p_id uuid, p_field text)
returns text
language sql
as $$
  select v ->> p_field
  from jsonb_array_elements(p -> 'persons') v
  where v ->> 'id' = p_id::text
$$;

create function pg_temp.child_ids(p jsonb, p_family uuid)
returns text[]
language sql
as $$
  select coalesce(array_agg(c order by c), array[]::text[])
  from jsonb_array_elements(p -> 'families') f
  cross join lateral jsonb_array_elements_text(f -> 'child_ids') c
  where f ->> 'id' = p_family::text
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--
--   GDad ── Dad ── Mom (hidden)
--             \
--            Foc ── Spo
--             /  \
--          Kid1  Kid2 ── (no partner)
--           |
--          GGkd
--
-- GDad gives Dad a recorded parent past a 'parents' expansion, so the
-- returned Dad can itself expand further. GGkd gives Kid1 a recorded child
-- past a 'children' expansion, for the same reason on the other axis. Sib is
-- Foc's sibling, kept out of a 'parents' expansion's child_ids. Mom is hidden,
-- for the RLS check.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('30000000-0000-0000-0000-000000000001'),  -- admin
  ('30000000-0000-0000-0000-000000000002'),  -- moderator
  ('30000000-0000-0000-0000-000000000003');  -- viewer

insert into public.person (id, given_name, surname, visibility) values
  ('11000000-0000-0000-0000-000000000001', 'GDad', 'Pat', 'everyone_approved'),
  ('11000000-0000-0000-0000-000000000010', 'Dad',  'Pat', 'everyone_approved'),
  ('11000000-0000-0000-0000-000000000011', 'Mom',  'Mat', 'hidden'),
  ('11000000-0000-0000-0000-000000000020', 'Foc',  'Pat', 'everyone_approved'),
  ('11000000-0000-0000-0000-000000000021', 'Sib',  'Pat', 'everyone_approved'),
  ('11000000-0000-0000-0000-000000000030', 'Spo',  'InLaw', 'everyone_approved'),
  ('11000000-0000-0000-0000-000000000040', 'Kid1', 'Pat', 'everyone_approved'),
  ('11000000-0000-0000-0000-000000000041', 'Kid2', 'Pat', 'everyone_approved'),
  ('11000000-0000-0000-0000-000000000050', 'GGkd', 'Pat', 'everyone_approved');

insert into public.account (id, role, status, person_id) values
  ('30000000-0000-0000-0000-000000000001', 'admin',     'active', null),
  ('30000000-0000-0000-0000-000000000002', 'moderator', 'active', null),
  ('30000000-0000-0000-0000-000000000003', 'viewer',    'active', null)
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status,
  person_id = excluded.person_id;

insert into public.family (id, partner1_id, partner2_id, relationship_type) values
  ('21000000-0000-0000-0000-000000000001',
   '11000000-0000-0000-0000-000000000001', null, null),
  ('21000000-0000-0000-0000-000000000010',
   '11000000-0000-0000-0000-000000000010', '11000000-0000-0000-0000-000000000011', 'married'),
  ('21000000-0000-0000-0000-000000000020',
   '11000000-0000-0000-0000-000000000020', '11000000-0000-0000-0000-000000000030', 'married'),
  ('21000000-0000-0000-0000-000000000040',
   '11000000-0000-0000-0000-000000000040', null, null);

insert into public.family_child (family_id, person_id, sort_order) values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000010', 0),
  ('21000000-0000-0000-0000-000000000010', '11000000-0000-0000-0000-000000000020', 0),
  ('21000000-0000-0000-0000-000000000010', '11000000-0000-0000-0000-000000000021', 1),
  ('21000000-0000-0000-0000-000000000020', '11000000-0000-0000-0000-000000000040', 0),
  ('21000000-0000-0000-0000-000000000020', '11000000-0000-0000-0000-000000000041', 1),
  ('21000000-0000-0000-0000-000000000040', '11000000-0000-0000-0000-000000000050', 0);

set local role authenticated;

-- ===========================================================================
-- 'parents': Foc's parent family, seen by a moderator.
-- ===========================================================================

select pg_temp.act_as('30000000-0000-0000-0000-000000000002');

select is(
  pg_temp.person_ids(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents')
  ),
  array[
    '11000000-0000-0000-0000-000000000010',  -- Dad
    '11000000-0000-0000-0000-000000000011'   -- Mom
  ]::text[],
  'parents: returns both partners of the family Foc is a child in'
);

select is(
  pg_temp.child_ids(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents'),
    '21000000-0000-0000-0000-000000000010'
  ),
  array['11000000-0000-0000-0000-000000000020']::text[],
  'parents: child_ids is Foc only -- Sib does not leak in'
);

select is(
  pg_temp.field(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents'),
    '11000000-0000-0000-0000-000000000010', 'can_expand_up'),
  'true',
  'parents: Dad has a recorded parent (GDad) -- can_expand_up continues the chain'
);
select is(
  pg_temp.field(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents'),
    '11000000-0000-0000-0000-000000000011', 'can_expand_up'),
  'false',
  'parents: Mom has no recorded parents'
);
select is(
  pg_temp.field(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents'),
    '11000000-0000-0000-0000-000000000010', 'can_expand_down'),
  'false',
  'parents: can_expand_down is always false on a parents expansion -- it would just point back at Foc'
);

select is(
  (select array_agg(k order by k)
   from jsonb_object_keys(
     (public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents') -> 'persons') -> 0
   ) as k),
  array['birth_year', 'can_expand_down', 'can_expand_up', 'death_year',
        'given_name', 'id', 'is_living', 'name_prefix', 'name_suffix',
        'nickname', 'sex', 'surname']::text[],
  'persons[] element carries exactly the documented keys (no generation)'
);
select is(
  (select array_agg(k order by k)
   from jsonb_object_keys(
     (public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents') -> 'families') -> 0
   ) as k),
  array['child_ids', 'id', 'partner1_id', 'partner1_role', 'partner2_id',
        'partner2_role', 'relationship_type']::text[],
  'families[] element carries exactly the documented keys'
);

-- ===========================================================================
-- 'children': every child of every family Foc partners in.
-- ===========================================================================

select is(
  pg_temp.person_ids(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'children')
  ),
  array[
    '11000000-0000-0000-0000-000000000040',  -- Kid1
    '11000000-0000-0000-0000-000000000041'   -- Kid2
  ]::text[],
  'children: both children of the Foc + Spo family'
);

select is(
  pg_temp.child_ids(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'children'),
    '21000000-0000-0000-0000-000000000020'
  ),
  array[
    '11000000-0000-0000-0000-000000000040',
    '11000000-0000-0000-0000-000000000041'
  ]::text[],
  'children: family child_ids is unfiltered, unlike get_neighborhood''s window-scoped set'
);

select is(
  pg_temp.field(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'children'),
    '11000000-0000-0000-0000-000000000040', 'can_expand_down'),
  'true',
  'children: Kid1 has a recorded child (GGkd) -- can_expand_down continues the chain'
);
select is(
  pg_temp.field(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'children'),
    '11000000-0000-0000-0000-000000000041', 'can_expand_down'),
  'false',
  'children: Kid2 has no recorded children'
);
select is(
  pg_temp.field(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'children'),
    '11000000-0000-0000-0000-000000000040', 'can_expand_up'),
  'false',
  'children: can_expand_up is always false on a children expansion -- it would just point back at Foc'
);

-- ===========================================================================
-- 'self': resolve one off-window partner. Both flags stay false even though
-- Dad genuinely has a recorded parent -- a resolved partner is a leaf in v1.
-- ===========================================================================

select is(
  pg_temp.person_ids(
    public.expand_relatives('11000000-0000-0000-0000-000000000010', 'self')
  ),
  array['11000000-0000-0000-0000-000000000010']::text[],
  'self: resolves exactly the one requested person'
);
select is(
  (public.expand_relatives('11000000-0000-0000-0000-000000000010', 'self') -> 'families'),
  '[]'::jsonb,
  'self: no family rows'
);
select is(
  pg_temp.field(
    public.expand_relatives('11000000-0000-0000-0000-000000000010', 'self'),
    '11000000-0000-0000-0000-000000000010', 'can_expand_up'),
  'false',
  'self: can_expand_up is always false, even though Dad has a recorded parent'
);

-- Unrecognised relation: no rows, not an error.
select is(
  public.expand_relatives('11000000-0000-0000-0000-000000000020', 'bogus'),
  jsonb_build_object('persons', '[]'::jsonb, 'families', '[]'::jsonb),
  'an unrecognised relation returns empty, not an error'
);

-- ===========================================================================
-- RLS still decides visibility: a plain viewer never sees hidden Mom.
-- ===========================================================================

select pg_temp.act_as('30000000-0000-0000-0000-000000000003');

select is(
  pg_temp.person_ids(
    public.expand_relatives('11000000-0000-0000-0000-000000000020', 'parents')
  ),
  array['11000000-0000-0000-0000-000000000010']::text[],
  'RLS: a viewer resolving Foc''s parents does not see hidden Mom'
);

select is(
  public.expand_relatives('11000000-0000-0000-0000-000000000011', 'self'),
  jsonb_build_object('persons', '[]'::jsonb, 'families', '[]'::jsonb),
  'RLS: a viewer cannot resolve hidden Mom directly either'
);

set local role postgres;

select * from finish();
rollback;
