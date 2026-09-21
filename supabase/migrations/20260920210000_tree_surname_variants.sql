-- Married and maiden surnames on the tree card. A woman recorded under her
-- birth name with a `person_name` row of type `married` (or the reverse: the
-- married name on `person`, a `maiden` / `birth` variant in `person_name`)
-- showed only the primary surname in the tree, so a couple read as two
-- unrelated surnames. Both tree RPCs now carry `married_surname` and
-- `maiden_surname` per person -- null when no such variant is recorded -- and
-- the card composes "Given Married (Maiden)" from them
-- (`apps/web/lib/tree/person-card.ts`). The same shape as `birth_year` /
-- `death_year`: one round trip, no per-card fetch (decision 9).
--
-- The rest of both function bodies is unchanged from migration
-- 20260920114500 -- a shipped migration is never edited, so the whole
-- function is restated (only the two new lines and the function comments
-- differ in each).

-- The surname of one person's first `person_name` variant of the given kind,
-- or null. `p_kind = 'maiden'` also accepts a `birth` variant -- GEDCOM
-- writers use either TYPE for the pre-marriage name, and a `maiden` row wins
-- when both exist. Rows with no surname are skipped. Ties break on
-- `sort_order` (the import's NAME order), then `created_at`. SECURITY
-- INVOKER, so `person_name_select` RLS applies.
create function public.person_surname_variant(
  p_person uuid,
  p_kind public.name_type
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select pn.surname
  from public.person_name pn
  where pn.person_id = p_person
    and pn.surname is not null
    and (
      pn.type = p_kind
      or (p_kind = 'maiden' and pn.type = 'birth')
    )
  order by case when pn.type = p_kind then 0 else 1 end,
           pn.sort_order nulls last,
           pn.created_at
  limit 1;
$$;

comment on function public.person_surname_variant(uuid, public.name_type) is
  'The surname of the first `person_name` variant of `p_kind` for this person, '
  'or null. `maiden` also matches a `birth` variant. SECURITY INVOKER.';

revoke execute on function public.person_surname_variant(uuid, public.name_type) from public;
grant execute on function public.person_surname_variant(uuid, public.name_type) to authenticated;

create or replace function public.get_neighborhood(
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
-- The ancestor / descendant frontier: exactly the generation the recursion
-- stopped at. A person here may have a recorded relative one step further out
-- that the window did not fetch -- issue #24's expand-in-place resolves it.
ancestor_frontier as (
  select distinct person_id from ancestors where gen = (select up from bounds)
),
descendant_frontier as (
  select distinct person_id from descendants where gen = -(select down from bounds)
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
        'married_surname', public.person_surname_variant(p.id, 'married'),
        'maiden_surname', public.person_surname_variant(p.id, 'maiden'),
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
        ),
        -- `bp.gen = up` (resp. `-down`) guards against a pedigree-collapse
        -- false positive: `ancestor_frontier` membership alone only proves a
        -- person is *reachable* at the frontier generation through some path,
        -- not that the frontier is the position `base_persons` actually chose
        -- to display them at (a cousin marriage can make one person reachable
        -- both as a near sibling/partner, gen 0, and, via a different line, as
        -- a frontier ancestor). Their real recorded parents are already fully
        -- inside the window whenever their *displayed* generation is nearer
        -- than the frontier, so the affordance must not appear on that copy.
        'can_expand_up', bp.gen = (select up from bounds) and exists (
          select 1
          from ancestor_frontier af
          join public.family_child fc on fc.person_id = af.person_id
          where af.person_id = p.id
        ),
        'can_expand_down', bp.gen = -(select down from bounds) and exists (
          select 1
          from descendant_frontier df
          join public.family f2
            on f2.partner1_id = df.person_id or f2.partner2_id = df.person_id
          join public.family_child fc2 on fc2.family_id = f2.id
          where df.person_id = p.id
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
        'ended_by', public.family_ended_by(f.id),
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
  'partners; positive up; negative down. `can_expand_up` / `can_expand_down`: '
  'true only for a frontier person (gen = up or gen = -down) with a recorded '
  'relative the window did not fetch -- see `expand_relatives` (#24). '
  '`ended_by` per family: see `family_ended_by` (#122). `married_surname` / '
  '`maiden_surname` per person: see `person_surname_variant`.';

revoke execute on function public.get_neighborhood(uuid, int, int) from public;
grant execute on function public.get_neighborhood(uuid, int, int) to authenticated;

-- expand_relatives: body unchanged from 20260920114500 except the two
-- surname-variant fields.
-- The `p_relation` semantics ('parents' / 'children' / 'self') and the
-- boundary-flag rules are documented in that migration's in-file comment.
create or replace function public.expand_relatives(
  p_person uuid,
  p_relation text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with target_families as (
  select f.id, f.partner1_id, f.partner2_id, f.partner1_role,
         f.partner2_role, f.relationship_type
  from public.family_child fc
  join public.family f on f.id = fc.family_id
  where p_relation = 'parents' and fc.person_id = p_person
  union
  select f.id, f.partner1_id, f.partner2_id, f.partner1_role,
         f.partner2_role, f.relationship_type
  from public.family f
  where p_relation = 'children'
    and (f.partner1_id = p_person or f.partner2_id = p_person)
),
target_persons as (
  select p_person as person_id where p_relation = 'self'
  union
  select tf.partner1_id from target_families tf
  where p_relation = 'parents' and tf.partner1_id is not null
  union
  select tf.partner2_id from target_families tf
  where p_relation = 'parents' and tf.partner2_id is not null
  union
  select fc.person_id
  from target_families tf
  join public.family_child fc on fc.family_id = tf.id
  where p_relation = 'children'
)
select jsonb_build_object(
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
        'married_surname', public.person_surname_variant(p.id, 'married'),
        'maiden_surname', public.person_surname_variant(p.id, 'maiden'),
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
        ),
        'can_expand_up', p_relation = 'parents' and exists (
          select 1 from public.family_child fc where fc.person_id = p.id
        ),
        'can_expand_down', p_relation = 'children' and exists (
          select 1
          from public.family f
          join public.family_child fc2 on fc2.family_id = f.id
          where f.partner1_id = p.id or f.partner2_id = p.id
        )
      )
    )
    from target_persons tp
    join public.person p on p.id = tp.person_id
  ), '[]'::jsonb),
  'families', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', tf.id,
        'partner1_id', tf.partner1_id,
        'partner2_id', tf.partner2_id,
        'partner1_role', tf.partner1_role,
        'partner2_role', tf.partner2_role,
        'relationship_type', tf.relationship_type,
        'ended_by', public.family_ended_by(tf.id),
        'child_ids', case
          when p_relation = 'parents' then jsonb_build_array(p_person)
          when p_relation = 'children' then coalesce((
            select jsonb_agg(fc3.person_id order by fc3.sort_order nulls last, fc3.person_id)
            from public.family_child fc3
            where fc3.family_id = tf.id
          ), '[]'::jsonb)
          else '[]'::jsonb
        end
      )
    )
    from target_families tf
  ), '[]'::jsonb)
);
$$;

comment on function public.expand_relatives(uuid, text) is
  'SPEC §8.2, §10 item 24. The scoped one-branch fetch behind the tree view''s '
  'expand affordance -- `p_relation` is ''parents'', ''children'', or ''self'' '
  '(resolve one off-window partner). SECURITY INVOKER -- RLS decides what the '
  'caller sees. Never pulls in extended family: see the in-file comment in '
  'migration 20260831201221. `ended_by` per family: see `family_ended_by` '
  '(#122). `married_surname` / `maiden_surname` per person: see '
  '`person_surname_variant`.';

revoke execute on function public.expand_relatives(uuid, text) from public;
grant execute on function public.expand_relatives(uuid, text) to authenticated;
