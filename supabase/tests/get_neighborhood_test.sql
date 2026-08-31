-- get_neighborhood(focus, up, down): the tree view's single-round-trip fetch.
-- Issue #10. Verifies the returned relative set (decision 28), the depth
-- clamping, the per-person generation, the family edges, and that RLS still
-- decides what the caller sees.
--
-- Same harness style as rls_test.sql: fixtures built as the superuser pg_prove
-- connects as, identity switched with a fake JWT, every assertion against a
-- fixture row that genuinely exists so a deny never passes vacuously.

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

-- Sorted person / family id lists and per-person generation, pulled out of the
-- jsonb payload so the assertions read as plain array comparisons.
create function pg_temp.person_ids(p jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg(v ->> 'id' order by v ->> 'id'), array[]::text[])
  from jsonb_array_elements(p -> 'persons') v
$$;

create function pg_temp.family_ids(p jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg(v ->> 'id' order by v ->> 'id'), array[]::text[])
  from jsonb_array_elements(p -> 'families') v
$$;

create function pg_temp.gen_of(p jsonb, p_id uuid)
returns int
language sql
as $$
  select (v ->> 'generation')::int
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

create function pg_temp.field(p jsonb, p_id uuid, p_field text)
returns text
language sql
as $$
  select v ->> p_field
  from jsonb_array_elements(p -> 'persons') v
  where v ->> 'id' = p_id::text
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. A five-generation line with one hidden grandparent, plus a
-- descendant's spouse (not a direct relative) and a great-great-grandchild
-- (past the default depth).
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('30000000-0000-0000-0000-000000000001'),  -- admin
  ('30000000-0000-0000-0000-000000000002'),  -- moderator
  ('30000000-0000-0000-0000-000000000003');  -- viewer

insert into public.person (id, given_name, surname, visibility) values
  ('10000000-0000-0000-0000-000000000001', 'Gp1', 'Pat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000002', 'Gp2', 'Pat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000003', 'Gp3', 'Mat',  'hidden'),
  ('10000000-0000-0000-0000-000000000004', 'Gp4', 'Mat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000010', 'Dad', 'Pat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000011', 'Mom', 'Mat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000020', 'Foc', 'Pat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000021', 'Sib', 'Pat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000030', 'Spo', 'InLaw', 'everyone_approved'),
  ('10000000-0000-0000-0000-000000000040', 'Kid', 'Pat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000041', 'KSp', 'InLaw', 'everyone_approved'),
  ('10000000-0000-0000-0000-000000000050', 'Gkd', 'Pat',  'everyone_approved'),
  ('10000000-0000-0000-0000-000000000060', 'Ggk', 'Pat',  'everyone_approved'),
  -- Great-grandparents of Focus, past the default up=2 window -- the one
  -- boundary person in this fixture set with a recorded relative the window
  -- does not fetch (issue #24's can_expand_up).
  ('10000000-0000-0000-0000-000000000070', 'GGp1', 'Pat', 'everyone_approved'),
  ('10000000-0000-0000-0000-000000000071', 'GGp2', 'Pat', 'everyone_approved');

-- The on_auth_user_created trigger (issue #17) already created a pending viewer
-- account for each auth.users row above; upsert to the role/status this suite
-- needs.
insert into public.account (id, role, status, person_id) values
  ('30000000-0000-0000-0000-000000000001', 'admin',     'active', null),
  ('30000000-0000-0000-0000-000000000002', 'moderator', 'active', null),
  ('30000000-0000-0000-0000-000000000003', 'viewer',    'active', null)
on conflict (id) do update set
  role = excluded.role,
  status = excluded.status,
  person_id = excluded.person_id;

insert into public.family (id, partner1_id, partner2_id, relationship_type) values
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'married'),
  ('20000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 'married'),
  ('20000000-0000-0000-0000-000000000010',
   '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000011', 'married'),
  ('20000000-0000-0000-0000-000000000020',
   '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030', 'married'),
  ('20000000-0000-0000-0000-000000000030',
   '10000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000041', 'married'),
  ('20000000-0000-0000-0000-000000000040',
   '10000000-0000-0000-0000-000000000050', null, null),
  ('20000000-0000-0000-0000-000000000070',
   '10000000-0000-0000-0000-000000000070', '10000000-0000-0000-0000-000000000071', 'married');

insert into public.family_child (family_id, person_id, sort_order) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000010', 0),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000011', 0),
  ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000020', 0),
  ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000021', 1),
  ('20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000040', 0),
  ('20000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000050', 0),
  ('20000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000060', 0),
  ('20000000-0000-0000-0000-000000000070', '10000000-0000-0000-0000-000000000001', 0);

insert into public.event (id, owner_type, person_id, type, date_year1) values
  ('40000000-0000-0000-0000-000000000001', 'person', '10000000-0000-0000-0000-000000000020', 'birth', 1985),
  ('40000000-0000-0000-0000-000000000002', 'person', '10000000-0000-0000-0000-000000000001', 'birth', 1890),
  ('40000000-0000-0000-0000-000000000003', 'person', '10000000-0000-0000-0000-000000000001', 'death', 1960);

set local role authenticated;

-- ===========================================================================
-- The full neighborhood, seen by a moderator (RLS lets a moderator see all).
-- ===========================================================================

select pg_temp.act_as('30000000-0000-0000-0000-000000000002');

select is(
  pg_temp.person_ids(
    public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2)
  ),
  array[
    '10000000-0000-0000-0000-000000000001',  -- Gp1
    '10000000-0000-0000-0000-000000000002',  -- Gp2
    '10000000-0000-0000-0000-000000000003',  -- Gp3 (hidden, but moderator sees it)
    '10000000-0000-0000-0000-000000000004',  -- Gp4
    '10000000-0000-0000-0000-000000000010',  -- Dad
    '10000000-0000-0000-0000-000000000011',  -- Mom
    '10000000-0000-0000-0000-000000000020',  -- Focus
    '10000000-0000-0000-0000-000000000021',  -- Sib
    '10000000-0000-0000-0000-000000000030',  -- Spouse
    '10000000-0000-0000-0000-000000000040',  -- Kid
    '10000000-0000-0000-0000-000000000050'   -- Grandkid
  ]::text[],
  'persons: focus + 2 up + 2 down + siblings + partners, nothing else'
);

select is(
  (public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2)) ->> 'focus_id',
  '10000000-0000-0000-0000-000000000020',
  'focus_id echoes the argument'
);

-- Exact key set of each element -- the guard that stops the jsonb payload, the
-- NeighborhoodPerson / NeighborhoodFamily types, and the neighborhood.ts parser
-- from drifting apart (three copies of one field list, issue #10 review).
select is(
  (select array_agg(k order by k)
   from jsonb_object_keys(
     (public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2) -> 'persons') -> 0
   ) as k),
  array['birth_year', 'can_expand_down', 'can_expand_up', 'death_year',
        'generation', 'given_name', 'id', 'is_living', 'name_prefix',
        'name_suffix', 'nickname', 'sex', 'surname']::text[],
  'persons[] element carries exactly the documented keys'
);
select is(
  (select array_agg(k order by k)
   from jsonb_object_keys(
     (public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2) -> 'families') -> 0
   ) as k),
  array['child_ids', 'id', 'partner1_id', 'partner1_role', 'partner2_id',
        'partner2_role', 'relationship_type']::text[],
  'families[] element carries exactly the documented keys'
);

-- Per-person generation: 0 focus/sibling/partner, positive up, negative down.
select is(pg_temp.gen_of(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000020'), 0, 'generation: focus is 0');
select is(pg_temp.gen_of(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000021'), 0, 'generation: sibling is 0');
select is(pg_temp.gen_of(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000030'), 0, 'generation: partner is 0');
select is(pg_temp.gen_of(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000010'), 1, 'generation: parent is 1');
select is(pg_temp.gen_of(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000001'), 2, 'generation: grandparent is 2');
select is(pg_temp.gen_of(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000040'), -1, 'generation: child is -1');
select is(pg_temp.gen_of(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000050'), -2, 'generation: grandchild is -2');

-- Boundary flags (issue #24): true only for a frontier person with a recorded
-- relative the window did not fetch.
select is(pg_temp.field(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000001', 'can_expand_up'), 'true',
  'can_expand_up: Gp1 is at the up=2 frontier and has recorded parents');
select is(pg_temp.field(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000002', 'can_expand_up'), 'false',
  'can_expand_up: Gp2 is at the frontier but has no recorded parents');
select is(pg_temp.field(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000010', 'can_expand_up'), 'false',
  'can_expand_up: Dad is not at the frontier -- his parents are already in view');
select is(pg_temp.field(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000050', 'can_expand_down'), 'true',
  'can_expand_down: Gkd is at the down=2 frontier and has a recorded child');
select is(pg_temp.field(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000040', 'can_expand_down'), 'false',
  'can_expand_down: Kid is not at the frontier -- his child is already in view');

-- Birth / death year come from the person's birth / death events.
select is(pg_temp.field(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000001', 'death_year'), '1960',
  'death_year: read from the death event');
select is(pg_temp.field(
  public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
  '10000000-0000-0000-0000-000000000020', 'birth_year'), '1985',
  'birth_year: read from the birth event');

-- Family edges: a family is returned when a partner is in the person set, and
-- child_ids is limited to children that are also in the set.
select is(
  pg_temp.child_ids(
    public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
    '20000000-0000-0000-0000-000000000010'),
  array[
    '10000000-0000-0000-0000-000000000020',
    '10000000-0000-0000-0000-000000000021'
  ]::text[],
  'families: the parents'' family lists focus and sibling as children'
);
select is(
  pg_temp.child_ids(
    public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2),
    '20000000-0000-0000-0000-000000000040'),
  array[]::text[],
  'families: a grandchild''s family drops the out-of-window great-grandchild'
);

-- ===========================================================================
-- Depth clamping.
-- ===========================================================================

select is(
  pg_temp.person_ids(
    public.get_neighborhood('10000000-0000-0000-0000-000000000020', 0, 0)
  ),
  array[
    '10000000-0000-0000-0000-000000000020',
    '10000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000030'
  ]::text[],
  'depth 0/0: only the focus, its siblings, and its partners'
);

select ok(
  pg_temp.person_ids(
    public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 3)
  ) @> array['10000000-0000-0000-0000-000000000060']::text[],
  'depth _/3: the great-great-grandchild now appears'
);

-- ===========================================================================
-- RLS still decides visibility: a plain viewer never sees the hidden
-- grandparent, even though the recursion walked through them to reach Gp4.
-- ===========================================================================

select pg_temp.act_as('30000000-0000-0000-0000-000000000003');

select is(
  pg_temp.person_ids(
    public.get_neighborhood('10000000-0000-0000-0000-000000000020', 2, 2)
  ),
  array[
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000004',  -- Gp3 gone, Gp4 still reached
    '10000000-0000-0000-0000-000000000010',
    '10000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000020',
    '10000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000030',
    '10000000-0000-0000-0000-000000000040',
    '10000000-0000-0000-0000-000000000050'
  ]::text[],
  'RLS: a viewer sees the neighborhood minus the hidden grandparent'
);

set local role postgres;

select * from finish();
rollback;
