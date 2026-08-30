-- Row-level security: the access boundary for the whole tree (CLAUDE.md, SPEC §5,
-- decision 6, decision 35). Frontend checks are convenience only -- this file is
-- the real gate.
--
-- Issue #9. Depends on #4-#8 (every table must already exist).
--
-- Shape:
--   1. Helper functions -- all STABLE SECURITY DEFINER, search_path = ''. They
--      run as the owner so they bypass RLS on the tables they read; that is what
--      stops a policy on `person` that calls person_is_visible() from recursing
--      into itself.
--   2. RLS enabled on every table (23 of them).
--   3. SELECT policies -- the visibility ladder.
--   4. Write policies -- genealogy writes are is_moderator(); a few are is_admin().
--
-- Not forced (`force row level security` is deliberately omitted): the table
-- owner and the Supabase service_role keep their BYPASSRLS, so migrations, the
-- audit trigger, and the GEDCOM import/export edge functions are unaffected.
--
-- Deviations from the SPEC §5 draft, all grounded in WAYFINDER decision 6 and
-- recorded in DECISIONS.md -- SPEC §5 is updated to match in the same PR:
--   * is_moderator() / is_admin() also require status = 'active'. A suspended
--     moderator must lose write access or suspension means nothing.
--   * Sensitive facts (is_sensitive) are hidden from non-moderators only while
--     the person is living. Decision 6: "Deceased people: fully visible." An
--     explicit fact.visibility <> 'everyone_approved' is always honoured.
--     person_is_living() is the load-bearing predicate here.
--   * `media` has no SELECT rule in SPEC §5; approved members may read the row
--     (the bytes are behind signed storage URLs -- decision 25).

-- ===========================================================================
-- 1. Helper functions
-- ===========================================================================

-- The caller's account row, or no row. SECURITY DEFINER so a policy may call it
-- while RLS on `account` is active.
create function public.auth_account()
returns public.account
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.account a where a.id = (select auth.uid())
$$;

comment on function public.auth_account() is
  'SPEC §5. The caller''s account row (or null). SECURITY DEFINER -- bypasses RLS.';

-- Approved = an active account exists for the caller.
create function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account
    where id = (select auth.uid()) and status = 'active'
  )
$$;

comment on function public.is_approved() is
  'SPEC §5. True when the caller has an active account.';

-- Moderator = active account with role moderator or admin. The active check is a
-- deliberate addition to the SPEC §5 draft (DECISIONS.md): a suspended moderator
-- keeps no privileges.
create function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account
    where id = (select auth.uid())
      and status = 'active'
      and role in ('moderator', 'admin')
  )
$$;

comment on function public.is_moderator() is
  'SPEC §5. Active account with role moderator or admin.';

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account
    where id = (select auth.uid())
      and status = 'active'
      and role = 'admin'
  )
$$;

comment on function public.is_admin() is
  'SPEC §5. Active account with role admin.';

-- Living? Explicit person.is_living wins. Otherwise: no death event AND
-- (no birth year OR birth year within tree_settings.living_threshold_years).
-- Load-bearing -- the fact SELECT policy hides is_sensitive facts only while the
-- subject is living (SPEC §5, decision 6). Null when the person id is unknown.
create function public.person_is_living(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.is_living is not null then p.is_living
    when exists (
      select 1 from public.event e
      where e.person_id = p.id and e.type = 'death'
    ) then false
    else coalesce(
      (
        select min(e.date_year1)
        from public.event e
        where e.person_id = p.id
          and e.type = 'birth'
          and e.date_year1 is not null
      ) > (
        extract(year from now())::int
          - (select living_threshold_years from public.tree_settings where id = 1)
      ),
      true
    )
  end
  from public.person p
  where p.id = p_person_id
$$;

comment on function public.person_is_living(uuid) is
  'SPEC §5 / §4.2. Explicit is_living override wins; else no death event AND '
  '(no birth year OR born within living_threshold_years). Null year -> living.';

-- The person visibility ladder (SPEC §5). MVP has no close_family rung, so a
-- person whose visibility is close_family / moderators_only / hidden is visible
-- only to moderators or to the linked account itself.
create function public.person_is_visible(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and (
      public.is_moderator()
      or exists (
        select 1 from public.person p
        where p.id = p_person_id and p.visibility = 'everyone_approved'
      )
      or coalesce(
        (select a.person_id from public.account a where a.id = (select auth.uid()))
          = p_person_id,
        false
      )
    )
$$;

comment on function public.person_is_visible(uuid) is
  'SPEC §5 visibility ladder: approved AND (everyone_approved OR moderator OR self).';

-- A family is visible when at least one partner is visible or it has a visible
-- child (SPEC §5). Marriage / divorce events hang off the family, so this is what
-- keeps a family-owned event from either leaking or wrongly denying.
create function public.family_is_visible(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and (
      public.is_moderator()
      or exists (
        select 1 from public.family f
        where f.id = p_family_id
          and (
            (f.partner1_id is not null and public.person_is_visible(f.partner1_id))
            or (f.partner2_id is not null and public.person_is_visible(f.partner2_id))
            or exists (
              select 1 from public.family_child fc
              where fc.family_id = f.id
                and public.person_is_visible(fc.person_id)
            )
          )
      )
    )
$$;

comment on function public.family_is_visible(uuid) is
  'SPEC §5. At least one visible partner, or a visible child.';

-- An event is visible when its owner is. The event_one_owner CHECK guarantees
-- exactly one of person_id / family_id is set, so neither branch falls through
-- to a null (SPEC §5).
create function public.event_is_visible(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.event e
      where e.id = p_event_id
        and (
          (e.owner_type = 'person' and public.person_is_visible(e.person_id))
          or (e.owner_type = 'family' and public.family_is_visible(e.family_id))
        )
    )
$$;

comment on function public.event_is_visible(uuid) is
  'SPEC §5. Person-owned -> person visible; family-owned -> family visible.';

-- A fact is visible when its owner is AND it is not withheld. Withheld =
-- an explicit visibility <> everyone_approved (always), OR is_sensitive while the
-- subject is living (SPEC §5, decision 6). Moderators see everything.
create function public.fact_is_visible(p_fact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.fact f
      where f.id = p_fact_id
        and (
          (f.owner_type = 'person' and public.person_is_visible(f.person_id))
          or (f.owner_type = 'family' and public.family_is_visible(f.family_id))
        )
        and (
          public.is_moderator()
          or (
            f.visibility = 'everyone_approved'
            and (
              f.is_sensitive = false
              or (
                f.owner_type = 'person'
                and public.person_is_living(f.person_id) is not true
              )
            )
          )
        )
    )
$$;

comment on function public.fact_is_visible(uuid) is
  'SPEC §5. Owner visible AND not withheld. Withheld: visibility <> '
  'everyone_approved (always), or is_sensitive while the subject is living.';

-- A citation inherits the visibility of the record it supports (SPEC §5).
create function public.citation_is_visible(p_citation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.citation c
      where c.id = p_citation_id
        and case c.owner_type
          when 'person' then public.person_is_visible(c.owner_id)
          when 'family' then public.family_is_visible(c.owner_id)
          when 'event' then public.event_is_visible(c.owner_id)
          when 'fact' then public.fact_is_visible(c.owner_id)
          when 'person_name' then exists (
            select 1 from public.person_name pn
            where pn.id = c.owner_id
              and public.person_is_visible(pn.person_id)
          )
        end
    )
$$;

comment on function public.citation_is_visible(uuid) is
  'SPEC §5. Inherits the visibility of the cited record, by owner_type.';

-- A media_link inherits the visibility of the record it attaches to (SPEC §5).
-- A source or place target is visible to any approved member.
create function public.media_link_is_visible(p_media_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.media_link ml
      where ml.id = p_media_link_id
        and case ml.owner_type
          when 'person' then public.person_is_visible(ml.owner_id)
          when 'family' then public.family_is_visible(ml.owner_id)
          when 'event' then public.event_is_visible(ml.owner_id)
          when 'fact' then public.fact_is_visible(ml.owner_id)
          when 'source' then true
          when 'place' then true
        end
    )
$$;

comment on function public.media_link_is_visible(uuid) is
  'SPEC §5. Inherits the visibility of the attached record, by owner_type.';

-- A note inherits the visibility of the record it annotates (SPEC §5). A note on
-- a source or a media object is visible to any approved member.
create function public.note_is_visible(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.note n
      where n.id = p_note_id
        and case n.owner_type
          when 'person' then public.person_is_visible(n.owner_id)
          when 'family' then public.family_is_visible(n.owner_id)
          when 'event' then public.event_is_visible(n.owner_id)
          when 'fact' then public.fact_is_visible(n.owner_id)
          when 'family_child' then exists (
            select 1 from public.family_child fc
            where fc.id = n.owner_id
              and public.person_is_visible(fc.person_id)
          )
          when 'citation' then public.citation_is_visible(n.owner_id)
          when 'source' then true
          when 'media' then true
        end
    )
$$;

comment on function public.note_is_visible(uuid) is
  'SPEC §5. Inherits the visibility of the annotated record, by owner_type.';

-- ===========================================================================
-- 2. Enable RLS on every table
-- ===========================================================================

alter table public.person             enable row level security;
alter table public.person_name        enable row level security;
alter table public.family             enable row level security;
alter table public.family_child       enable row level security;
alter table public.place              enable row level security;
alter table public.event              enable row level security;
alter table public.fact               enable row level security;
alter table public.repository         enable row level security;
alter table public.source             enable row level security;
alter table public.citation           enable row level security;
alter table public.media              enable row level security;
alter table public.media_link         enable row level security;
alter table public.note               enable row level security;
alter table public.account            enable row level security;
alter table public.tree_settings      enable row level security;
alter table public.audit_log          enable row level security;
alter table public.invitation         enable row level security;
alter table public.access_request     enable row level security;
alter table public.claim_attempt      enable row level security;
alter table public.notification       enable row level security;
alter table public.notification_read  enable row level security;
alter table public.import_job         enable row level security;
alter table public.export_job         enable row level security;

-- ===========================================================================
-- 3. SELECT policies -- the visibility ladder
-- ===========================================================================

-- Person and its per-person dependents.
create policy person_select on public.person
  for select to authenticated
  using (public.person_is_visible(id));

create policy person_name_select on public.person_name
  for select to authenticated
  using (public.person_is_visible(person_id));

create policy family_select on public.family
  for select to authenticated
  using (public.family_is_visible(id));

-- family_child is visible when the child person is visible (SPEC §5).
create policy family_child_select on public.family_child
  for select to authenticated
  using (public.person_is_visible(person_id));

create policy event_select on public.event
  for select to authenticated
  using (public.event_is_visible(id));

create policy fact_select on public.fact
  for select to authenticated
  using (public.fact_is_visible(id));

-- Reference tables carry no personal data on their own: any approved member.
create policy place_select on public.place
  for select to authenticated
  using (public.is_approved());

create policy repository_select on public.repository
  for select to authenticated
  using (public.is_approved());

create policy source_select on public.source
  for select to authenticated
  using (public.is_approved());

-- Polymorphic dependents inherit the target's visibility.
create policy citation_select on public.citation
  for select to authenticated
  using (public.citation_is_visible(id));

create policy media_link_select on public.media_link
  for select to authenticated
  using (public.media_link_is_visible(id));

create policy note_select on public.note
  for select to authenticated
  using (public.note_is_visible(id));

-- media row: SPEC §5 is silent. The image bytes are behind signed storage URLs
-- (decision 25); the metadata row is readable by any approved member.
create policy media_select on public.media
  for select to authenticated
  using (public.is_approved());

-- account: own row always; moderators read all (SPEC §5).
create policy account_select on public.account
  for select to authenticated
  using (id = (select auth.uid()) or public.is_moderator());

-- tree_settings: any signed-in user, including a still-pending account (the
-- onboarding and login screens show the tree name).
create policy tree_settings_select on public.tree_settings
  for select to authenticated
  using ((select auth.uid()) is not null);

-- audit_log: admins only (SPEC §5).
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- Onboarding / moderation queue.
create policy invitation_select on public.invitation
  for select to authenticated
  using (public.is_moderator());

-- access_request: the requester reads their own; moderators read all (SPEC §5).
create policy access_request_select on public.access_request
  for select to authenticated
  using (account_id = (select auth.uid()) or public.is_moderator());

create policy claim_attempt_select on public.claim_attempt
  for select to authenticated
  using (public.is_moderator());

create policy notification_select on public.notification
  for select to authenticated
  using (public.is_moderator());

-- notification_read: the caller's own read state only (SPEC §5, decision 27).
create policy notification_read_select on public.notification_read
  for select to authenticated
  using (account_id = (select auth.uid()));

create policy import_job_select on public.import_job
  for select to authenticated
  using (public.is_moderator());

create policy export_job_select on public.export_job
  for select to authenticated
  using (public.is_moderator());

-- ===========================================================================
-- 4. Write policies
-- ===========================================================================
-- Genealogy writes are is_moderator(); `for all` covers INSERT / UPDATE /
-- DELETE. The matching SELECT policy above is permissive and OR's with this one
-- -- harmless, a moderator can already see every row.

create policy person_name_write on public.person_name
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy family_write on public.family
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy family_child_write on public.family_child
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy place_write on public.place
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy event_write on public.event
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy fact_write on public.fact
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy repository_write on public.repository
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy source_write on public.source
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy citation_write on public.citation
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy media_write on public.media
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy media_link_write on public.media_link
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy note_write on public.note
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- person: INSERT / UPDATE are is_moderator(); DELETE is is_admin() (decision 18).
create policy person_insert on public.person
  for insert to authenticated
  with check (public.is_moderator());

create policy person_update on public.person
  for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy person_delete on public.person
  for delete to authenticated
  using (public.is_admin());

-- account: only an admin may write; the id and role columns are guarded further
-- in the invite / role-management flows (SPEC §5). No client INSERT (the row is
-- created by the post-sign-in trigger in #17) and no client DELETE (the row goes
-- away with its auth.users row).
create policy account_update on public.account
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- tree_settings: admin UPDATE only. Singleton -- no INSERT / DELETE.
create policy tree_settings_update on public.tree_settings
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- invitation: moderators manage invites; only an admin may grant a non-viewer
-- role (SPEC §4.7, §5).
create policy invitation_insert on public.invitation
  for insert to authenticated
  with check (public.is_moderator() and (role = 'viewer' or public.is_admin()));

create policy invitation_update on public.invitation
  for update to authenticated
  using (public.is_moderator())
  with check (public.is_moderator() and (role = 'viewer' or public.is_admin()));

create policy invitation_delete on public.invitation
  for delete to authenticated
  using (public.is_moderator());

-- access_request: the requester inserts a pending row for their own account;
-- moderators resolve it. The 'access_requested' notification is raised by a
-- SECURITY DEFINER path (SPEC §5), not a client insert into `notification`.
create policy access_request_insert on public.access_request
  for insert to authenticated
  with check (account_id = (select auth.uid()) and status = 'pending');

create policy access_request_update on public.access_request
  for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- notification: moderators read (policy above) and resolve. Rows are created by
-- SECURITY DEFINER triggers / RPCs only -- no client INSERT policy.
create policy notification_update on public.notification
  for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- notification_read: the caller manages only their own read markers.
create policy notification_read_write on public.notification_read
  for all to authenticated
  using (account_id = (select auth.uid()))
  with check (account_id = (select auth.uid()));

-- import_job: moderators create / update / delete; a non-initial job may only be
-- deleted by an admin (decision 18).
create policy import_job_insert on public.import_job
  for insert to authenticated
  with check (public.is_moderator());

create policy import_job_update on public.import_job
  for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy import_job_delete on public.import_job
  for delete to authenticated
  using (
    case when mode = 'initial' then public.is_moderator() else public.is_admin() end
  );

-- export_job: moderators manage.
create policy export_job_write on public.export_job
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- claim_attempt has no write policy: rows are written only by the
-- onboarding-match edge function under the service role (decision 24).
