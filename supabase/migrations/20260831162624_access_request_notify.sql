-- Onboarding: raise an 'access_requested' notification when a signed-in visitor
-- with no node match asks for access.
-- Spec: docs/SPEC.md §5 (notification writes), §7 (onboarding-match last bullet),
-- §9.3 (self-claim path). Issue #19.
-- Depends on #8 (access_request / notification tables, notification_type enum),
-- #18 (the onboarding-match cap path also inserts access_request).
--
-- SPEC §5: `notification` takes no client INSERT -- the moderator-only queue is
-- fed by SECURITY DEFINER paths. The self-claim request-access form (#19) lets
-- the caller INSERT their own `pending` access_request (RLS
-- `access_request_insert`); this trigger is the SECURITY DEFINER path that turns
-- that row into a moderator notification. The onboarding-match attempt-cap path
-- (#18) also inserts an access_request, so this fires for that case too -- it
-- already writes its own `claim_attempt_cap` notification, and the extra
-- `access_requested` row is the actionable "there is a pending request" queue
-- item, so both are wanted.

-- ---------------------------------------------------------------------------
-- notify_access_requested -- AFTER INSERT on access_request
--
-- SECURITY DEFINER so it can write `public.notification` (no role holds an
-- INSERT grant there). search_path = '' so every reference is schema-qualified
-- and the definer's rights cannot be abused through a hijacked search_path.
--
-- Deduped: one unresolved 'access_requested' notification per account is enough
-- for the queue. A second pending request, or the cap path inserting its own
-- access_request, does not stack another row.
-- ---------------------------------------------------------------------------

create function public.notify_access_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.notification
    where type = 'access_requested'
      and resolved_at is null
      and payload ->> 'account_id' = new.account_id::text
  ) then
    return new;
  end if;

  insert into public.notification (type, payload)
  values (
    'access_requested',
    jsonb_build_object(
      'account_id', new.account_id,
      'access_request_id', new.id,
      'submitted_name', new.submitted_name,
      'message', new.message
    )
  );

  return new;
end;
$$;

comment on function public.notify_access_requested() is
  'SPEC §5 / §9.3. AFTER INSERT on access_request: raise one unresolved '
  '''access_requested'' notification per account for the moderator queue.';

create trigger notify_on_access_request
  after insert on public.access_request
  for each row execute function public.notify_access_requested();
