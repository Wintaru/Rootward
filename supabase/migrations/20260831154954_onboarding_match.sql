-- pg_trgm + the onboarding self-claim search function.
-- Spec: docs/SPEC.md §7 (onboarding-match), §9.3, decision 24. Issue #18.
--
-- The `onboarding-match` edge function does the whole claim flow, but only the
-- fuzzy name search needs raw SQL: supabase-js cannot express `similarity()`,
-- so it lives here and the function calls it with `.rpc()`. Everything else the
-- flow touches -- challenge metadata, answer checks, and the
-- `claim_attempt` / `account` / `notification` / `access_request` writes -- is
-- plain table access through the function's service-role gateway.
--
-- `onboarding_match_search` is SECURITY DEFINER (SPEC §7): the caller is a
-- signed-in but not-yet-approved account, so it runs before RLS would let them
-- read `person`. It returns only opaque person ids and a score -- never a name,
-- a date, or any other identifying value (decision 24).

create extension if not exists pg_trgm with schema extensions;

-- The search narrows on the exact birth year first (the `born` CTE), then scores
-- only those people, so `similarity()` is never a scan over all names and needs
-- no trigram index. What it does need is a fast `born` lookup: a partial index
-- matching that predicate exactly.
create index event_person_birth_year_idx
  on public.event (date_year1)
  where owner_type = 'person' and type = 'birth';

-- ---------------------------------------------------------------------------
-- onboarding_match_search -- fuzzy name + birth match for the self-claim flow.
--
-- Matches the submitted given/surname against the primary name on `person` and
-- every `person_name` variant (maiden, nickname, ...). Birth year is exact,
-- birth month is exact or +/- 1 (decision 24); a candidate with no dated birth
-- event, or a birth year that does not match, is never returned.
--
-- Score is the trigram similarity of the best-matching name row, 0..1: the mean
-- of the given-name and surname similarities, or just one side when the caller
-- supplied only one. Candidates scoring below `p_threshold` are dropped.
-- ---------------------------------------------------------------------------
create function public.onboarding_match_search(
  p_given_name text,
  p_surname text,
  p_birth_year integer,
  p_birth_month integer default null,
  p_threshold real default 0.3
)
returns table (person_id uuid, score real)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select
      lower(nullif(btrim(p_given_name), '')) as given,
      lower(nullif(btrim(p_surname), '')) as surname
  ),
  born as (
    -- People whose dated birth event matches: year exact, month exact or +/- 1.
    select distinct e.person_id
    from public.event e
    where e.owner_type = 'person'
      and e.type = 'birth'
      and e.person_id is not null
      and e.date_year1 = p_birth_year
      and (
        p_birth_month is null
        or e.date_month1 is null
        or abs(e.date_month1 - p_birth_month) <= 1
      )
  ),
  names as (
    -- Every name row for a birth-year match: the primary name on `person` plus
    -- each `person_name` variant. Joined off `born`, so this is a handful of
    -- rows, not a scan of the whole tree.
    select b.person_id, lower(p.given_name) as given, lower(p.surname) as surname
    from born b
    join public.person p on p.id = b.person_id
    union all
    select b.person_id, lower(pn.given_name), lower(pn.surname)
    from born b
    join public.person_name pn on pn.person_id = b.person_id
  ),
  scored as (
    select
      n.person_id,
      max(
        case
          when q.given is null then coalesce(extensions.similarity(n.surname, q.surname), 0)
          when q.surname is null then coalesce(extensions.similarity(n.given, q.given), 0)
          else (
            coalesce(extensions.similarity(n.given, q.given), 0)
            + coalesce(extensions.similarity(n.surname, q.surname), 0)
          ) / 2.0
        end
      )::real as score
    from names n
    cross join q
    group by n.person_id
  )
  select s.person_id, s.score
  from scored s
  where s.score >= p_threshold
  order by s.score desc, s.person_id
  limit 25;
$$;

comment on function public.onboarding_match_search(text, text, integer, integer, real) is
  'SPEC §7 onboarding-match / decision 24. Fuzzy name + birth candidate search '
  'for the self-claim flow. SECURITY DEFINER -- returns only opaque person ids '
  'and a score, no identifying data.';

-- The self-claim flow runs it directly (a not-yet-approved account) and the
-- edge function runs it under the service role. Supabase's default privileges
-- grant EXECUTE straight to anon / authenticated / service_role on every new
-- `public` function, so revoke from `anon` explicitly -- a `revoke from public`
-- would not touch those direct grants.
revoke all on function public.onboarding_match_search(text, text, integer, integer, real)
  from public, anon;
grant execute on function public.onboarding_match_search(text, text, integer, integer, real)
  to authenticated, service_role;
