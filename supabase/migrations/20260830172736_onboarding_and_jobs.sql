-- Onboarding, moderation, notifications, and the GEDCOM job tables.
-- Spec: docs/SPEC.md §4.7 (invitation / access_request / claim_attempt /
-- notification / notification_read), §4.8 (import_job / export_job), with the
-- §4 table conventions. Issue #8. Depends on #4 (person) and #7 (account).
--
-- Deliberately out of scope here (later issues own them, migrations are additive):
--   * RLS enable + policies on every table -- issue #9;
--   * the moderator/admin read + resolve policies for notification and the
--     onboarding queue -- issue #9 (SPEC §5).
--
-- Design calls settled in this issue (see DECISIONS.md):
--   * No updated_at / set_updated_at trigger on any table here. SPEC §4
--     enumerates the editable tables that carry the concurrency token (the
--     reason it exists is decision 26 -- the edit-view row-level version check)
--     and none of these are in that list. They move through fixed status
--     ladders driven by edge functions and the moderation UI, not the edit
--     view. created_at is enough. Issue #9's test should assert the
--     set_updated_at trigger set equals exactly the §4 list.
--   * No write_audit_log trigger on any table here. #7 left this open; these are
--     operational rows (a job updates processed_records on every chunk) and the
--     resolved_by / accepted_by / status columns already record who did what.
--   * export_job.status needs an enum and none of the six in the issue scope
--     fit, so this migration adds export_status.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type invitation_status as enum ('pending', 'accepted', 'expired');

create type request_status as enum ('pending', 'approved', 'rejected');

-- Audience is always moderators + admins (SPEC §4.7, decisions 16, 27).
create type notification_type as enum (
  'self_claim_linked', 'access_requested', 'claim_attempt_cap',
  'import_finished', 'import_failed', 'hide_request'
);

-- decision 33: the three import strategies.
create type import_mode as enum ('initial', 'replace_all', 'match_update');

create type import_status as enum (
  'uploaded', 'parsing', 'importing', 'completed', 'failed', 'cancelled'
);

create type export_type as enum (
  'manual_gedcom', 'manual_full', 'scheduled_full'
);

-- Not in the issue scope list: export_job needs a status and import_status does
-- not fit (no 'parsing'/'importing' step). Minimal ladder, pending -> running
-- -> completed/failed, 'pending'-first like invitation_status / request_status.
create type export_status as enum (
  'pending', 'running', 'completed', 'failed'
);

-- ---------------------------------------------------------------------------
-- invitation -- an admin/moderator invites an email to claim a node (§4.7,
-- decision 12). Only an admin may set role moderator/admin -- enforced in the
-- invite action and the #9 policy, not by a column constraint.
-- ---------------------------------------------------------------------------

create table invitation (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- The node to link on accept. Withdrawing the person withdraws the invite.
  person_id uuid not null references person (id) on delete cascade,
  role account_role not null default 'viewer',
  invited_by uuid references account (id) on delete set null,
  status invitation_status not null default 'pending',
  accepted_by uuid references account (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- The moderation view lists open invitations first.
create index invitation_status_idx on invitation (status, created_at desc);

-- FK traversal: "invitations for this node", and the person-delete cascade scan.
create index invitation_person_id_idx on invitation (person_id);

-- ---------------------------------------------------------------------------
-- access_request -- a signed-in user with no node match asks for access
-- (§4.7, decision 13). Raises an 'access_requested' notification.
-- ---------------------------------------------------------------------------

create table access_request (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  submitted_name text,
  submitted_birth_month smallint,
  submitted_birth_year smallint,
  message text,
  status request_status not null default 'pending',
  resolved_by uuid references account (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index access_request_status_idx
  on access_request (status, created_at desc);

-- FK traversal: "my access requests", and the account-delete cascade scan.
create index access_request_account_id_idx on access_request (account_id);

-- ---------------------------------------------------------------------------
-- claim_attempt -- one row per self-claim challenge attempt (§4.7,
-- decision 24). onboarding-match enforces 5 attempts / account / rolling 24h;
-- this table is the counter it reads.
-- ---------------------------------------------------------------------------

create table claim_attempt (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);

-- Serves the rolling-window count: where account_id = $1 and attempted_at > now() - interval '24 hours'.
create index claim_attempt_account_time_idx
  on claim_attempt (account_id, attempted_at desc);

-- ---------------------------------------------------------------------------
-- notification -- one shared row for the whole moderator/admin queue (§4.7,
-- decisions 16, 27). Read state is per-user via notification_read; "handled"
-- is global via resolved_at / resolved_by.
-- ---------------------------------------------------------------------------

create table notification (
  id uuid primary key default gen_random_uuid(),
  type notification_type not null,
  -- Type-specific keys: person_id, account_id, import_job_id, message.
  -- import_job_id is a soft link (payload ->> 'import_job_id'), not an FK (§4.9).
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references account (id) on delete set null
);

-- The queue view defaults to unresolved, newest first (decision 27).
create index notification_unresolved_idx
  on notification (created_at desc)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- notification_read -- per-user read state for the shared queue (§4.7,
-- decision 27). Composite PK, no surrogate id -- so it is also not a
-- write_audit_log target (that trigger reads NEW.id).
-- ---------------------------------------------------------------------------

create table notification_read (
  notification_id uuid not null references notification (id) on delete cascade,
  account_id uuid not null references account (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, account_id)
);

-- account_id is not a prefix of the PK: index it for "my read state" and the
-- account-delete cascade scan. (notification_id is covered by the PK.)
create index notification_read_account_id_idx
  on notification_read (account_id);

-- ---------------------------------------------------------------------------
-- import_job -- a chunked, resumable GEDCOM import (§4.8, decision 8).
-- ---------------------------------------------------------------------------

create table import_job (
  id uuid primary key default gen_random_uuid(),
  filename text,
  -- Uploaded GEDCOM in a private bucket.
  storage_path text,
  mode import_mode not null,
  status import_status not null default 'uploaded',
  total_records integer,
  processed_records integer not null default 0,
  -- Resume point: which record / line to continue from after a restart.
  cursor jsonb,
  -- {added, updated, skipped, removed}.
  stats jsonb not null default '{}'::jsonb,
  error_text text,
  started_by uuid references account (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- export_job -- a GEDCOM or full-archive export (§4.8, decision 29). The table
-- exists in the MVP; the scheduled_full path is post-MVP.
-- ---------------------------------------------------------------------------

create table export_job (
  id uuid primary key default gen_random_uuid(),
  type export_type not null,
  status export_status not null default 'pending',
  storage_path text,
  size_bytes bigint,
  error_text text,
  -- Nullable: a scheduled_full run has no initiating account.
  started_by uuid references account (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
