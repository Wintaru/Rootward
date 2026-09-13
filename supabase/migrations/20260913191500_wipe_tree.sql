-- wipe_tree(): the admin-only "Wipe tree" action behind `/settings` (SPEC §7,
-- §8.1, decisions 18, 33), issue #60.
--
-- Removes every genealogy row so the tree can be re-imported from scratch:
-- person, person_name, family, family_child, event, fact, place, source,
-- repository, citation, media, media_link, note. Accounts, tree_settings,
-- notifications, and import/export jobs are untouched -- the person FKs
-- already "on delete set null" (SPEC §4.6, §4.9) unlink every account and
-- clear tree_settings.default_root_person_id on their own the moment `person`
-- rows disappear below, so there is nothing left to do for those explicitly.
--
-- Only `person` / `family` / `source` / `media` need an explicit delete --
-- deleting them cascades away every dependent row (person_name, family_child,
-- person/family-owned event+fact, citation, media_link) through the FKs each
-- already carries (SPEC §4.2-§4.4). `note` and `place` carry no FK to
-- anything this touches (SPEC §4.9's polymorphic owner_id, and place is
-- simply independent reference data), so they need their own explicit delete.
-- `repository` outlives `source` (source.repository_id is "on delete set
-- null"), so it needs its own delete too.
--
-- `place` is deleted *last*, after person/family (and the event/fact rows
-- they cascade away) are already gone. `event.place_id` / `fact.place_id` are
-- "on delete set null", and event carries a BEFORE UPDATE trigger
-- (`event_set_sort_key`) that recomputes `sort_key` through an unqualified
-- call to `genealogy_date_sort_key` -- which fails under this function's own
-- `search_path = ''` if that trigger ever fires here. Deleting place after
-- every event/fact row is already gone means the cascading UPDATE touches
-- zero rows, so the trigger never runs in the first place.
--
-- Storage objects for uploaded media live outside Postgres (SPEC §4.4) --
-- `WipeTreeSection.tsx` removes them from the `media` bucket itself, reading
-- their paths off the `media` table, before calling this function. That read
-- would come back empty afterwards, which is why the order matters there and
-- not here: nothing in this function depends on storage state.
--
-- SECURITY INVOKER (the default), same posture as `delete_person`
-- (`20260913190832_delete_person.sql`): every table this touches already
-- grants `is_moderator()` (admin included) full write access via its own
-- `for all` RLS policy, so RLS never blocks a legitimate call. The explicit
-- is_admin() check below is the real boundary, not RLS -- without it, a
-- moderator's call would strip every genealogy table before failing on
-- nothing (`person`'s own delete policy is the only one of these tables that
-- is admin-only), which is not what "refused" should look like. Raising up
-- front keeps the whole call atomic: nothing commits unless the caller is an
-- admin.
create function public.wipe_tree()
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

  delete from public.note;

  -- Cascades: person_name, family_child, person-owned event/fact; nulls
  -- family.partner*_id, account.person_id, tree_settings.default_root_person_id.
  delete from public.person;
  -- Cascades: remaining family_child, family-owned event/fact.
  delete from public.family;
  -- Cascades: citation.
  delete from public.source;
  -- Cascades: media_link.
  delete from public.media;

  delete from public.repository;
  -- Last -- see the header comment on why place must outlive event/fact.
  delete from public.place;
end;
$$;

comment on function public.wipe_tree() is
  'SPEC §7, §8.1, decisions 18/33, issue #60. Admin-only hard reset of every '
  'genealogy table. Accounts, tree_settings, notifications, and import/export '
  'jobs survive untouched. Storage objects for media are removed by the '
  'caller before this runs -- see the header comment above.';

grant execute on function public.wipe_tree() to authenticated;
