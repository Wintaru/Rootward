-- Fixes `wipe_tree()` (`20260913191500_wipe_tree.sql`, issue #60): every
-- unqualified `delete from <table>;` failed with `DELETE requires a WHERE
-- clause` the first time the action ran for real, through PostgREST.
--
-- The `authenticator` role PostgREST always connects as (even after its own
-- `SET LOCAL ROLE authenticated` for RLS) preloads the `safeupdate` extension
-- (`session_preload_libraries` on that role, set by the Supabase platform,
-- not this project) -- a guard against an accidental full-table DELETE/UPDATE
-- that rejects any DELETE/UPDATE with no WHERE clause, for the lifetime of
-- that session, including one issued from inside a `plpgsql` function running
-- on the server. `wipe_tree()`'s whole point is an unfiltered delete of every
-- row in each of these tables, so each statement below gets a tautological
-- `where true` -- syntactically a filter, semantically still "every row" --
-- rather than actually narrowing what gets deleted.
create or replace function public.wipe_tree()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise insufficient_privilege using message =
      'wipe_tree: admin role required';
  end if;

  delete from public.note where true;

  -- Cascades: person_name, family_child, person-owned event/fact; nulls
  -- family.partner*_id, account.person_id, tree_settings.default_root_person_id.
  delete from public.person where true;
  -- Cascades: remaining family_child, family-owned event/fact.
  delete from public.family where true;
  -- Cascades: citation.
  delete from public.source where true;
  -- Cascades: media_link.
  delete from public.media where true;

  delete from public.repository where true;
  -- Last -- see the header comment on `20260913191500_wipe_tree.sql` for why
  -- place must outlive event/fact.
  delete from public.place where true;
end;
$$;

comment on function public.wipe_tree() is
  'SPEC §7, §8.1, decisions 18/33, issue #60. Admin-only hard reset of every '
  'genealogy table. Accounts, tree_settings, notifications, and import/export '
  'jobs survive untouched. Storage objects for media are removed by the '
  'caller before this runs -- see 20260913191500_wipe_tree.sql''s header '
  'comment above. Every delete carries a tautological WHERE clause -- the '
  'authenticator role''s safeupdate guard requires one syntactically, even '
  'though the semantics here are genuinely "every row".';

grant execute on function public.wipe_tree() to authenticated;
