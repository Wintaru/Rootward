-- get_neighborhood(focus, up, down): the tree view's single-round-trip fetch.
-- Spec: docs/SPEC.md §8.2, §8.4, §10 item 10. WAYFINDER decisions 9, 28.
-- Issue #10. Depends on #4 (person, family, family_child) and #5 (event).
--
-- Returns the focus person, direct ancestors to `up` generations, direct
-- descendants to `down` generations, the focus person's siblings, and the focus
-- person's partners -- decision 28's v1 relative set -- plus the family rows that
-- link them. One query, so a re-center never fans out into a query per node
-- (decision 9). SECURITY INVOKER: RLS on person / family / family_child / event
-- is enforced against the caller, so a hidden branch stays hidden.

create function public.get_neighborhood(
  p_focus uuid,
  p_up int default 2,
  p_down int default 2
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with recursive
-- Clamp the depth arguments: never negative, never past a sane ceiling.
bounds as (
  select least(greatest(coalesce(p_up, 0), 0), 10) as up,
         least(greatest(coalesce(p_down, 0), 0), 10) as down
),
-- Focus + ancestors. gen 0 is the focus, gen N is N generations up. Each step
-- adds both partners of every family the current person is a child of. `union`
-- (not `union all`) dedupes the working set, so pedigree collapse expands each
-- node once per band; the `gen < up` guard bounds the recursion, so a data cycle
-- still terminates.
ancestors as (
  select p_focus as person_id, 0 as gen
  union
  select parents.parent_id, a.gen + 1
  from ancestors a
  join public.family_child fc on fc.person_id = a.person_id
  join public.family f on f.id = fc.family_id
  cross join lateral (values (f.partner1_id), (f.partner2_id)) as parents(parent_id)
  where parents.parent_id is not null
    and a.gen < (select up from bounds)
),
-- Focus + descendants. gen 0 is the focus, gen -N is N generations down. Each
-- step adds every child of every family the current person partners in.
descendants as (
  select p_focus as person_id, 0 as gen
  union
  select fc.person_id, d.gen - 1
  from descendants d
  join public.family f
    on f.partner1_id = d.person_id or f.partner2_id = d.person_id
  join public.family_child fc on fc.family_id = f.id
  where d.gen > -(select down from bounds)
),
-- The focus person's siblings: co-children of any family the focus is a child of.
siblings as (
  select distinct fc2.person_id
  from public.family_child fc1
  join public.family_child fc2 on fc2.family_id = fc1.family_id
  where fc1.person_id = p_focus
    and fc2.person_id <> p_focus
),
-- The focus person's partners.
partners as (
  select distinct pr.partner_id as person_id
  from public.family f
  cross join lateral (values (f.partner1_id), (f.partner2_id)) as pr(partner_id)
  where (f.partner1_id = p_focus or f.partner2_id = p_focus)
    and pr.partner_id is not null
    and pr.partner_id <> p_focus
),
-- One row per person id. When pedigree collapse makes a person reachable at more
-- than one depth, keep the band nearest the focus, ties resolved toward the
-- ancestor side.
base_persons as (
  select distinct on (person_id) person_id, gen
  from (
    select person_id, gen from ancestors
    union all
    select person_id, gen from descendants
    union all
    select person_id, 0 as gen from siblings
    union all
    select person_id, 0 as gen from partners
  ) all_ids
  order by person_id, abs(gen), gen desc
),
-- Every family with a partner in the person set, plus the focus person's own
-- parent families (which catch a sibling link when both parents are unrecorded).
-- A returned family may still name a partner id that is not in `persons` -- a
-- descendant's spouse, say -- which the tree renderer expands on demand (#24).
fam as (
  select f.id, f.partner1_id, f.partner2_id, f.partner1_role,
         f.partner2_role, f.relationship_type
  from public.family f
  where f.partner1_id in (select person_id from base_persons)
     or f.partner2_id in (select person_id from base_persons)
     -- The focus person's own parent families, always: this is the only edge
     -- that links a sibling to the focus, and it is one row.
     or f.id in (
       select fc.family_id from public.family_child fc
       where fc.person_id = p_focus
     )
)
select jsonb_build_object(
  'focus_id', p_focus,
  'persons', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'given_name', p.given_name,
        'surname', p.surname,
        'name_prefix', p.name_prefix,
        'name_suffix', p.name_suffix,
        'nickname', p.nickname,
        'sex', p.sex,
        'is_living', p.is_living,
        'generation', bp.gen,
        'birth_year', (
          select min(e.date_year1) from public.event e
          where e.owner_type = 'person'
            and e.person_id = p.id
            and e.type = 'birth'
        ),
        'death_year', (
          select min(e.date_year1) from public.event e
          where e.owner_type = 'person'
            and e.person_id = p.id
            and e.type = 'death'
        )
      )
      order by bp.gen desc, p.surname nulls last, p.given_name nulls last
    )
    from base_persons bp
    join public.person p on p.id = bp.person_id
  ), '[]'::jsonb),
  'families', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'partner1_id', f.partner1_id,
        'partner2_id', f.partner2_id,
        'partner1_role', f.partner1_role,
        'partner2_role', f.partner2_role,
        'relationship_type', f.relationship_type,
        'child_ids', coalesce((
          select jsonb_agg(fc.person_id order by fc.sort_order nulls last, fc.person_id)
          from public.family_child fc
          where fc.family_id = f.id
            and fc.person_id in (select person_id from base_persons)
        ), '[]'::jsonb)
      )
    )
    from fam f
  ), '[]'::jsonb)
);
$$;

comment on function public.get_neighborhood(uuid, int, int) is
  'SPEC §8.2 / decision 28. Focus + ancestors to `up` + descendants to `down` + '
  'the focus person''s siblings and partners, with the family rows that link '
  'them, as one jsonb payload. SECURITY INVOKER -- RLS decides what the caller '
  'sees. `up` / `down` are clamped to 0..10. `generation`: 0 focus, siblings, '
  'partners; positive up; negative down.';

revoke execute on function public.get_neighborhood(uuid, int, int) from public;
grant execute on function public.get_neighborhood(uuid, int, int) to authenticated;
