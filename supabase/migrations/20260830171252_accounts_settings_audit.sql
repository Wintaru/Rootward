-- Accounts, the settings singleton, the audit trail, and the two shared triggers.
-- Spec: docs/SPEC.md §4.6 (account / tree_settings / audit_log), §5 (writes).
-- Issue #7. Depends on #4 (person), #5 (event, fact), #6 (media).
--
-- This migration also closes the deferrals left open by #4-#6:
--   * the account foreign key for created_by / updated_by on person / event /
--     fact and uploaded_by on media (could not exist until account did);
--   * the shared updated_at bump trigger over every editable table so far.
--
-- Still out of scope (later issues own them, migrations are additive):
--   * RLS enable + policies on every table -- issue #9;
--   * applying the shared updated_at trigger to the #8 tables -- issue #8
--     (its "Done when" asks for updated_at coverage consistent with §4);
--   * a schema sync-guard for the repeated date_* column set -- issue #9.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type account_role as enum ('viewer', 'moderator', 'admin');

-- pending = signed in but not yet approved/linked (SPEC §4.6).
create type account_status as enum ('active', 'pending', 'suspended');

create type audit_action as enum ('insert', 'update', 'delete');

-- Post-MVP (decision 29); the settings column exists in MVP, the scheduled path
-- does not. Values are the plausible cadences; revisit when #29 lands.
create type backup_frequency as enum ('daily', 'weekly', 'monthly');

-- ---------------------------------------------------------------------------
-- account -- one row per auth.users row (SPEC §4.6, decisions 12, 14, 18)
-- ---------------------------------------------------------------------------

create table account (
  id uuid primary key references auth.users (id) on delete cascade,
  role account_role not null default 'viewer',
  -- The linked node. Decision 14: at most one account per person, so unique.
  -- Deleting the person unlinks the account rather than deleting it.
  person_id uuid unique references person (id) on delete set null,
  status account_status not null default 'pending',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Deferred account foreign keys from #4-#6.
-- on delete set null: removing an account must not cascade away the genealogy
-- rows that account authored or uploaded.
-- ---------------------------------------------------------------------------

alter table person
  add constraint person_created_by_fkey
    foreign key (created_by) references account (id) on delete set null,
  add constraint person_updated_by_fkey
    foreign key (updated_by) references account (id) on delete set null;

alter table event
  add constraint event_created_by_fkey
    foreign key (created_by) references account (id) on delete set null,
  add constraint event_updated_by_fkey
    foreign key (updated_by) references account (id) on delete set null;

alter table fact
  add constraint fact_created_by_fkey
    foreign key (created_by) references account (id) on delete set null,
  add constraint fact_updated_by_fkey
    foreign key (updated_by) references account (id) on delete set null;

alter table media
  add constraint media_uploaded_by_fkey
    foreign key (uploaded_by) references account (id) on delete set null;

-- ---------------------------------------------------------------------------
-- tree_settings -- one-row configuration table (SPEC §4.6, decision 20)
-- ---------------------------------------------------------------------------

create table tree_settings (
  id smallint primary key default 1,
  tree_name text,
  tree_description text,
  allow_self_signup boolean not null default true,
  living_threshold_years smallint not null default 100,
  default_root_person_id uuid references person (id) on delete set null,
  default_generations_up smallint not null default 2,
  default_generations_down smallint not null default 2,
  media_max_bytes bigint not null default 10485760,
  media_allowed_mime text[] not null default array[
    'image/jpeg', 'image/png', 'image/webp',
    'image/gif', 'image/heic', 'application/pdf'
  ],
  strip_exif_gps boolean not null default true,
  backup_enabled boolean not null default false,
  backup_frequency backup_frequency not null default 'daily',
  backup_retention smallint not null default 14,
  updated_by uuid references account (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tree_settings_singleton check (id = 1)
);

-- Seed the singleton so the app always has a row to read and update. Every
-- value comes from the column defaults above.
insert into tree_settings (id) values (1);

-- ---------------------------------------------------------------------------
-- audit_log -- append-only change history (SPEC §4.6, decision 21)
-- Written only by the write_audit_log() trigger below. No client writes
-- (SPEC §5); issue #9 adds the is_admin() read policy.
-- ---------------------------------------------------------------------------

create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid not null,
  action audit_action not null,
  -- on delete set null is deliberate: an account delete cascades from
  -- auth.users (a "delete my account" flow on a public host). Keep the history
  -- row, sever the personal link. The trail survives, attribution does not.
  actor_id uuid references account (id) on delete set null,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

-- The change history for one row, newest first.
create index audit_log_row_idx on audit_log (table_name, row_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- set_updated_at -- shared BEFORE UPDATE trigger, the row-level concurrency
-- token (decision 26). The edit view loads updated_at with each row and sends
-- it back on save; a mismatch rejects just that row.
-- ---------------------------------------------------------------------------

create function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'SPEC decision 26. BEFORE UPDATE: stamp updated_at = now() on every editable '
  'table. Issue #8 applies this to its own tables.';

-- Every table carrying updated_at so far. Applied by name so #8 can extend the
-- list without touching this migration.
create trigger set_updated_at before update on person
  for each row execute function set_updated_at();
create trigger set_updated_at before update on person_name
  for each row execute function set_updated_at();
create trigger set_updated_at before update on family
  for each row execute function set_updated_at();
create trigger set_updated_at before update on family_child
  for each row execute function set_updated_at();
create trigger set_updated_at before update on place
  for each row execute function set_updated_at();
create trigger set_updated_at before update on event
  for each row execute function set_updated_at();
create trigger set_updated_at before update on fact
  for each row execute function set_updated_at();
create trigger set_updated_at before update on repository
  for each row execute function set_updated_at();
create trigger set_updated_at before update on source
  for each row execute function set_updated_at();
create trigger set_updated_at before update on citation
  for each row execute function set_updated_at();
create trigger set_updated_at before update on media
  for each row execute function set_updated_at();
create trigger set_updated_at before update on media_link
  for each row execute function set_updated_at();
create trigger set_updated_at before update on note
  for each row execute function set_updated_at();
create trigger set_updated_at before update on account
  for each row execute function set_updated_at();
create trigger set_updated_at before update on tree_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- write_audit_log -- shared AFTER INSERT/UPDATE/DELETE trigger on the
-- genealogy + account tables (SPEC §4.6, decision 21).
--
-- SECURITY DEFINER so the client's moderator-only write policy (issue #9) does
-- not also need an INSERT policy on audit_log. search_path = '' so every
-- reference is schema-qualified and the definer's rights cannot be abused
-- through a hijacked search_path.
--
-- Any table added to the trigger list below must have a single uuid column
-- named `id` -- write_audit_log reads new.id / old.id for row_id.
-- Does not fire on TRUNCATE: a replace_all import (#14) must audit its own wipe.
-- ---------------------------------------------------------------------------

create function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- actor_id has an FK to account. A GEDCOM import running as the service role
  -- has no auth.uid(); an auth user acting before their account row exists
  -- would otherwise fail the FK and block the write. Null out both cases.
  if v_actor is not null
     and not exists (select 1 from public.account where id = v_actor) then
    v_actor := null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log
      (table_name, row_id, action, actor_id, old_data, new_data)
    values
      (tg_table_name, old.id, 'delete', v_actor, to_jsonb(old), null);
    return old;
  end if;

  insert into public.audit_log
    (table_name, row_id, action, actor_id, old_data, new_data)
  values (
    tg_table_name,
    new.id,
    lower(tg_op)::public.audit_action,
    v_actor,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

comment on function write_audit_log() is
  'SPEC §4.6 / decision 21. AFTER INSERT/UPDATE/DELETE on the genealogy + '
  'account tables: append one audit_log row with old/new jsonb and auth.uid() '
  'as actor. SECURITY DEFINER -- the only writer of audit_log.';

create trigger write_audit_log after insert or update or delete on person
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on person_name
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on family
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on family_child
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on place
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on event
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on fact
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on repository
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on source
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on citation
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on media
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on media_link
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on note
  for each row execute function write_audit_log();
create trigger write_audit_log after insert or update or delete on account
  for each row execute function write_audit_log();
