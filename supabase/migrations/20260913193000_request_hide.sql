-- request_hide(person, reason): a linked viewer (or a parent of the person,
-- per decision 14's "hide my child") asks a moderator to hide a record.
-- SPEC §5, §7, decisions 7/14/27. Issue #61.
--
-- SPEC §5 "Writes": `notification` takes no client INSERT -- the moderator
-- queue is fed by SECURITY DEFINER paths. `notify_access_requested`
-- (migration 20260831162624) is that path for `access_requested`; this
-- function is the equivalent for `hide_request`, called directly as an RPC
-- (there is no table write to hang a trigger off -- "ask to hide" is not
-- itself an insert into anything else).
--
-- The authorization check is the real boundary, not RLS: it runs as the
-- function owner (bypasses RLS), so it must re-derive the caller's linked
-- person itself rather than relying on a policy. Deduped like
-- notify_access_requested: one unresolved hide_request per person is enough
-- for the queue.
create function public.request_hide(p_person_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_account_id uuid := (select auth.uid());
  v_caller_person_id uuid;
  v_authorized boolean;
begin
  if not public.is_approved() then
    raise insufficient_privilege using message =
      'request_hide: an active account is required';
  end if;

  v_caller_person_id := (public.auth_account()).person_id;
  if v_caller_person_id is null then
    raise insufficient_privilege using message =
      'request_hide: caller is not linked to a person';
  end if;

  v_authorized := v_caller_person_id = p_person_id or exists (
    select 1
    from public.family_child fc
    join public.family f on f.id = fc.family_id
    where fc.person_id = p_person_id
      and v_caller_person_id in (f.partner1_id, f.partner2_id)
  );

  if not v_authorized then
    raise insufficient_privilege using message =
      'request_hide: caller is not linked to this person or a parent of them';
  end if;

  if exists (
    select 1 from public.notification
    where type = 'hide_request'
      and resolved_at is null
      and payload ->> 'person_id' = p_person_id::text
  ) then
    return;
  end if;

  insert into public.notification (type, payload)
  values (
    'hide_request',
    jsonb_build_object(
      'person_id', p_person_id,
      'requested_by', v_caller_account_id,
      'message', nullif(trim(both from coalesce(p_reason, '')), '')
    )
  );
end;
$$;

comment on function public.request_hide(uuid, text) is
  'SPEC §5/§7, decisions 7/14/27, issue #61. A linked viewer, or a parent of '
  'the person, asks a moderator to hide a record -- raises one unresolved '
  'hide_request notification per person.';

revoke all on function public.request_hide(uuid, text) from public, anon;
grant execute on function public.request_hide(uuid, text) to authenticated;
