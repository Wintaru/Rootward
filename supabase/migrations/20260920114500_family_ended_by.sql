-- Ended unions (issue #122). A divorce or annulment is an `event` on the
-- family (SPEC §8.3, #57); nothing read it back, so a divorced couple still
-- showed as "Married" everywhere. `family_ended_by(family)` is the one place
-- that derives "this union ended" from those events, and both tree RPCs now
-- carry it per family as `ended_by` (`'divorce'` / `'annulment'` / null) --
-- the same shape as `birth_year` / `death_year` on persons, so the tree and
-- the edit shell's relatives strip need no second fetch (decision 9).
--
-- `family.relationship_type` is deliberately not touched: it is the kind of
-- union, not its state, and GEDCOM round-trips the event (`DIV` / `ANUL`)
-- as-is.
--
-- The rest of both function bodies is unchanged from migration
-- 20260831201221 -- a shipped migration is never edited, so the whole
-- function is restated (only the `'ended_by'` line differs in each).

-- Which event, if any, ended this union. `annulment` wins over `divorce` when
-- both exist (an annulment voids the marriage itself). Event order is not
-- considered: a family row with marriage, divorce, then a second marriage
-- still reads as ended -- a remarriage is a second `family` row (how GEDCOM
-- models it, and what "Start a new union" creates). SECURITY INVOKER, so
-- `event_select` RLS applies -- a caller who cannot see the event does not
-- learn the union ended. The `in (...)` list below is mirrored by
-- `UNION_ENDING_EVENT_TYPES` in `apps/web/lib/db/types.ts`; a value added
-- here without the TS side throws at parse time on every read.
create function public.family_ended_by(p_family uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select e.type::text
  from public.event e
  where e.owner_type = 'family'
    and e.family_id = p_family
    and e.type in ('divorce', 'annulment')
  order by case e.type when 'annulment' then 0 else 1 end
  limit 1;
$$;

comment on function public.family_ended_by(uuid) is
  'Issue #122. The event type that ended this union -- ''divorce'' or '
  '''annulment'' (annulment wins when both exist) -- or null while it stands. '
  'Derived from `event` rows with owner_type = family; there is no stored '
  'status column. SECURITY INVOKER.';

revoke execute on function public.family_ended_by(uuid) from public;
grant execute on function public.family_ended_by(uuid) to authenticated;

-- The same rule as a PostgREST computed field on `family` (a function whose
-- only argument is the table's row type is selectable as a column:
-- `select=id,ended_by`). The Relationships section reads `family` rows
-- directly rather than through the tree RPCs, and this keeps it on the one
-- evaluator instead of re-deriving "ended" from the events in TypeScript.
create function public.ended_by(f public.family)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select public.family_ended_by(f.id);
$$;

comment on function public.ended_by(public.family) is
  'Issue #122. PostgREST computed field: `family_ended_by(id)` selectable as '
  '`ended_by` on a family row.';

revoke execute on function public.ended_by(public.family) from public;
grant execute on function public.ended_by(public.family) to authenticated;

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
  '`ended_by` per family: see `family_ended_by` (#122).';

revoke execute on function public.get_neighborhood(uuid, int, int) from public;
grant execute on function public.get_neighborhood(uuid, int, int) to authenticated;

-- expand_relatives: body unchanged from 20260831201221 except 'ended_by'.
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
  '(#122).';

revoke execute on function public.expand_relatives(uuid, text) from public;
grant execute on function public.expand_relatives(uuid, text) to authenticated;
