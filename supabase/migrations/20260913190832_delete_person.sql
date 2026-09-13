-- delete_person(person): the admin-only hard delete behind the edit view's
-- Name & Gender "danger zone" (SPEC §8.3, WAYFINDER decision 18). Issue #59.
--
-- person_name / event / fact / family_child cascade off `person` already
-- (their FKs are `on delete cascade`); `family.partner*_id` and
-- `account.person_id` are already `on delete set null` (SPEC §4.9). None of
-- that needs help here.
--
-- citation / media_link / note are polymorphic (owner_type/owner_id, no FK on
-- owner_id -- SPEC §4.9), so a cascaded person/event/fact/person_name/
-- family_child row leaves them orphaned unless this function removes them
-- first, in dependency order: notes-on-citations, then the direct notes and
-- media_links, then the citations themselves, then the person row (whose own
-- cascade sweeps person_name/event/fact/family_child). `family` and `media`
-- rows are never touched -- SPEC is explicit that a partner slot goes null,
-- not the family row, and a media asset may be linked from more than one
-- owner.
--
-- SECURITY INVOKER (the default): every table this touches already grants
-- `is_moderator()` (admin included) write access, so RLS never blocks a
-- legitimate call. The explicit is_admin() check below is the real boundary,
-- not RLS -- without it, a moderator's call would still run every delete
-- above except the final one (person_delete is is_admin()-only), silently
-- stripping a still-living person's notes/citations/media before failing on
-- the row itself. Raising up front makes the whole call atomic: nothing
-- commits unless the caller is an admin.
create function public.delete_person(p_person_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_ids uuid[];
  v_fact_ids uuid[];
  v_family_child_ids uuid[];
  v_person_name_ids uuid[];
  v_citation_ids uuid[];
begin
  if not public.is_admin() then
    raise insufficient_privilege using message =
      'delete_person: admin role required';
  end if;

  -- Lock the row for the rest of this transaction. Inserting an
  -- event/fact/family_child/person_name row that references p_person_id
  -- takes a FOR KEY SHARE lock on it to enforce the FK, which this FOR
  -- UPDATE blocks until the delete below commits -- without it, a row
  -- inserted between the SELECTs just below and the final DELETE would be
  -- swept up by the person cascade while its own citation/media_link/note
  -- rows (missing from the arrays gathered under the stale snapshot) were
  -- never cleaned up, orphaning them.
  perform 1 from public.person where id = p_person_id for update;
  if not found then
    return false;
  end if;

  select coalesce(array_agg(id), '{}') into v_event_ids
    from public.event where person_id = p_person_id;
  select coalesce(array_agg(id), '{}') into v_fact_ids
    from public.fact where person_id = p_person_id;
  select coalesce(array_agg(id), '{}') into v_family_child_ids
    from public.family_child where person_id = p_person_id;
  select coalesce(array_agg(id), '{}') into v_person_name_ids
    from public.person_name where person_id = p_person_id;

  select coalesce(array_agg(id), '{}') into v_citation_ids
    from public.citation
    where (owner_type = 'person' and owner_id = p_person_id)
       or (owner_type = 'event' and owner_id = any(v_event_ids))
       or (owner_type = 'fact' and owner_id = any(v_fact_ids))
       or (owner_type = 'person_name' and owner_id = any(v_person_name_ids));

  -- Notes about a citation being removed below (note_owner has no 'media'
  -- path here -- media assets are never removed by this function, so no
  -- note-on-media cleanup is needed).
  delete from public.note
    where owner_type = 'citation' and owner_id = any(v_citation_ids);

  delete from public.note
    where (owner_type = 'person' and owner_id = p_person_id)
       or (owner_type = 'event' and owner_id = any(v_event_ids))
       or (owner_type = 'fact' and owner_id = any(v_fact_ids))
       or (owner_type = 'family_child' and owner_id = any(v_family_child_ids));

  delete from public.media_link
    where (owner_type = 'person' and owner_id = p_person_id)
       or (owner_type = 'event' and owner_id = any(v_event_ids))
       or (owner_type = 'fact' and owner_id = any(v_fact_ids));

  delete from public.citation where id = any(v_citation_ids);

  -- Cascades to person_name, event, fact, family_child; sets
  -- family.partner*_id and account.person_id to null.
  delete from public.person where id = p_person_id;

  return true;
end;
$$;

comment on function public.delete_person(uuid) is
  'SPEC §8.3, §4.9, decision 18, issue #59. Admin-only hard delete: removes '
  'the polymorphic citation/media_link/note rows a plain FK cascade cannot '
  'reach, then deletes the person row itself. Returns false if the person was '
  'already gone.';

grant execute on function public.delete_person(uuid) to authenticated;
