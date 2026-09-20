-- search_persons(words): the one query behind the header search box, every
-- PersonPicker, and the /people filter (SPEC §8.1, issue #62). Issue #111.
--
-- The app used to resolve a name filter to a list of matching person ids on
-- the client and re-query with `id=in.(…)`. That list rides in the request
-- URI, so past ~209 matches the gateway answered "URI too long" and /people
-- returned 500 -- for the family's own surname, the likeliest search of all.
-- Doing the match here means the ids never leave Postgres: PostgREST pages,
-- orders, and counts the function's rows like a table's.
--
-- Match rule: every word must appear (case-insensitive substring) in some
-- name column -- given_name, surname, or nickname -- of the person row, OR
-- every word must appear in some column of one person_name variant (maiden
-- name, AKA). The AND is per row, so a word list can straddle columns of one
-- row ("Gideon Qatestsson", #113) but not two rows. An empty word list
-- matches everyone: the unfiltered /people browse. LIKE wildcards in a word
-- are escaped here, where nothing re-parses the value afterwards (#112).
--
-- SECURITY INVOKER: person_select / person_name_select RLS run against the
-- caller, so a hidden person is not found by name.

create function public.search_persons(p_words text[] default '{}')
returns setof public.person
language sql
stable
security invoker
set search_path = ''
as $$
with patterns as (
  select '%' || replace(replace(replace(btrim(w), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  from unnest(coalesce(p_words, '{}'::text[])) as w
  where btrim(w) <> ''
)
select p.*
from public.person p
where not exists (
  select 1 from patterns
  where not (
    coalesce(p.given_name, '') ilike patterns.pat
    or coalesce(p.surname, '') ilike patterns.pat
    or coalesce(p.nickname, '') ilike patterns.pat
  )
)
or exists (
  select 1 from public.person_name pn
  where pn.person_id = p.id
    and not exists (
      select 1 from patterns
      where not (
        coalesce(pn.given_name, '') ilike patterns.pat
        or coalesce(pn.surname, '') ilike patterns.pat
        or coalesce(pn.nickname, '') ilike patterns.pat
      )
    )
);
$$;

comment on function public.search_persons(text[]) is
  'SPEC §8.1, issues #62/#111. Persons where every word is a substring of '
  'some name column of the person row or of one person_name variant. Empty '
  'words = everyone. Wildcards escaped. SECURITY INVOKER: RLS applies.';

revoke all on function public.search_persons(text[]) from public, anon;
grant execute on function public.search_persons(text[]) to authenticated;
