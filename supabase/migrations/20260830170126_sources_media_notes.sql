-- Sources, media, and polymorphic notes.
-- Spec: docs/SPEC.md §4.3 (repository / source / citation), §4.4 (media /
-- media_link), §4.5 (note), with the §4 table conventions. Issue #6.
-- Depends on #4 (person, family, person_name, family_child) and #5 (event, fact,
-- place, the genealogy-date helpers).
--
-- Deliberately out of scope here (later issues own them, migrations are additive):
--   * the shared updated_at bump trigger over the #4-#8 tables -- issue #7;
--   * RLS enable + policies on every table -- issue #9;
--   * the account foreign key for media.uploaded_by -- issue #7 (see the comment
--     on issue #7, which already lists media);
--   * a schema sync-guard for the repeated date_* column set -- issue #9.

-- ---------------------------------------------------------------------------
-- Enums -- the polymorphic owner discriminators (SPEC §4.3-§4.5)
-- ---------------------------------------------------------------------------

create type citation_owner as enum (
  'person', 'event', 'fact', 'family', 'person_name'
);

create type media_owner as enum (
  'person', 'event', 'fact', 'family', 'source', 'place'
);

create type note_owner as enum (
  'person', 'event', 'fact', 'family', 'family_child', 'source', 'citation',
  'media'
);

-- ---------------------------------------------------------------------------
-- repository -- an archive or holding institution for sources (SPEC §4.3)
-- ---------------------------------------------------------------------------

create table repository (
  id uuid primary key default gen_random_uuid(),
  gedcom_xref text,
  name text,
  address text,
  phone text,
  email text,
  website text,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index repository_gedcom_xref_uidx
  on repository (gedcom_xref)
  where gedcom_xref is not null;

-- ---------------------------------------------------------------------------
-- source -- a bibliographic source record; optionally held by a repository
-- ---------------------------------------------------------------------------

create table source (
  id uuid primary key default gen_random_uuid(),
  gedcom_xref text,
  title text,
  author text,
  publication_info text,
  -- Deleting a repository must not cascade away the sources it held; the source
  -- simply loses its holding institution.
  repository_id uuid references repository (id) on delete set null,
  source_text text,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index source_gedcom_xref_uidx
  on source (gedcom_xref)
  where gedcom_xref is not null;

create index source_repository_id_idx on source (repository_id)
  where repository_id is not null;

-- ---------------------------------------------------------------------------
-- citation -- links one source to one owning record (SPEC §4.3)
-- owner_type / owner_id is polymorphic across person / event / fact / family /
-- person_name, so owner_id carries no FK (SPEC §4.9). Deleting the source
-- removes its citations.
-- ---------------------------------------------------------------------------

create table citation (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source (id) on delete cascade,
  owner_type citation_owner not null,
  owner_id uuid not null,
  page text,
  data_text text,
  -- Embedded genealogy-date column set from SPEC §4.1 -- the date as stated by
  -- this source. Identical layout to event / fact (#5); date_sort_key calls the
  -- one shared genealogy_date_sort_key() so the sort logic cannot drift.
  date_value_raw text,
  date_kind genealogy_date_kind,
  date_year1 smallint,
  date_month1 smallint,
  date_day1 smallint,
  date_year2 smallint,
  date_month2 smallint,
  date_day2 smallint,
  date_calendar calendar not null default 'gregorian',
  date_dual_year boolean,
  date_phrase text,
  date_sort_key date generated always as (
    genealogy_date_sort_key(date_year1, date_month1, date_day1)
  ) stored,
  quality smallint,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- GEDCOM QUAY: 0 unreliable, 1 questionable, 2 secondary, 3 direct/primary.
  constraint citation_quality_range check (quality between 0 and 3)
);

create index citation_source_id_idx on citation (source_id);
create index citation_owner_idx on citation (owner_type, owner_id);

-- ---------------------------------------------------------------------------
-- media -- an uploaded object (photo, document, ...) (SPEC §4.4)
-- The three storage_path_* columns point into the private storage bucket:
-- the untouched original, a ~240px thumb, and a ~1200px display copy, the last
-- two produced by the media-process edge function (#33).
-- ---------------------------------------------------------------------------

create table media (
  id uuid primary key default gen_random_uuid(),
  gedcom_xref text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  storage_path_original text,
  storage_path_thumb text,
  storage_path_display text,
  title text,
  -- Embedded genealogy-date column set (SPEC §4.1) -- "date taken".
  date_value_raw text,
  date_kind genealogy_date_kind,
  date_year1 smallint,
  date_month1 smallint,
  date_day1 smallint,
  date_year2 smallint,
  date_month2 smallint,
  date_day2 smallint,
  date_calendar calendar not null default 'gregorian',
  date_dual_year boolean,
  date_phrase text,
  date_sort_key date generated always as (
    genealogy_date_sort_key(date_year1, date_month1, date_day1)
  ) stored,
  exif jsonb,
  raw_gedcom jsonb,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column media.uploaded_by is
  'account.id of the uploader; FK to account added in issue #7.';

create unique index media_gedcom_xref_uidx
  on media (gedcom_xref)
  where gedcom_xref is not null;

-- ---------------------------------------------------------------------------
-- media_link -- attaches a media object to an owning record (SPEC §4.4)
-- Polymorphic owner across person / event / fact / family / source / place; no
-- FK on owner_id (SPEC §4.9). Deleting the media removes its links.
-- ---------------------------------------------------------------------------

create table media_link (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references media (id) on delete cascade,
  owner_type media_owner not null,
  owner_id uuid not null,
  -- The owner's main photo. not null default false so the "one primary" partial
  -- unique index below has a clean predicate.
  is_primary boolean not null default false,
  sort_order smallint,
  caption text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index media_link_media_id_idx on media_link (media_id);
create index media_link_owner_idx on media_link (owner_type, owner_id);

-- At most one primary media per owner. A second is_primary insert for the same
-- (owner_type, owner_id) raises a unique violation (SPEC §4.4).
create unique index media_link_one_primary_uidx
  on media_link (owner_type, owner_id)
  where is_primary;

-- ---------------------------------------------------------------------------
-- note -- free text attached to almost any record (SPEC §4.5)
-- Polymorphic owner; no FK on owner_id (SPEC §4.9). gedcom_xref is set only for
-- shared GEDCOM NOTE records and is unique among those.
-- ---------------------------------------------------------------------------

create table note (
  id uuid primary key default gen_random_uuid(),
  gedcom_xref text,
  owner_type note_owner not null,
  owner_id uuid not null,
  text text not null,
  sort_order smallint,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index note_gedcom_xref_uidx
  on note (gedcom_xref)
  where gedcom_xref is not null;

create index note_owner_idx on note (owner_type, owner_id);
