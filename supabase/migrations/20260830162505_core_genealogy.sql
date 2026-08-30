-- Core genealogy schema: enums + person, person_name, family, family_child.
-- Spec: docs/SPEC.md §4.2, with the §4 table conventions. Issue #4.
--
-- Deliberately out of scope here (later issues own them, migrations are additive):
--   * the shared updated_at bump trigger over the #4-#8 tables -- issue #7;
--   * RLS enable + policies on every table -- issue #9;
--   * the account foreign key for person.created_by / person.updated_by, which
--     cannot exist until the account table does -- issue #7.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type sex as enum ('male', 'female', 'unknown', 'other');

create type person_visibility as enum (
  'everyone_approved', 'close_family', 'moderators_only', 'hidden'
);

create type name_type as enum (
  'birth', 'married', 'maiden', 'also_known_as',
  'nickname', 'religious', 'immigrant', 'other'
);

create type partner_role as enum ('husband', 'wife', 'partner', 'unknown');

create type union_type as enum (
  'married', 'partnership', 'civil_union', 'unknown'
);

create type child_relation as enum (
  'biological', 'adopted', 'step', 'foster', 'guardian', 'sealed', 'unknown'
);

-- ---------------------------------------------------------------------------
-- person -- one row per individual; the primary name is denormalised onto it
-- ---------------------------------------------------------------------------

create table person (
  id uuid primary key default gen_random_uuid(),
  gedcom_xref text,
  given_name text,
  surname text,
  name_prefix text,
  name_suffix text,
  nickname text,
  sex sex,
  is_living boolean,
  visibility person_visibility not null default 'everyone_approved',
  familysearch_id text,
  ancestral_file_number text,
  user_reference_number text,
  raw_gedcom jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- gedcom_xref: null for site-created people until first export assigns one,
-- unique among the rows that do have one.
create unique index person_gedcom_xref_uidx
  on person (gedcom_xref)
  where gedcom_xref is not null;

comment on column person.created_by is
  'account.id of the creator; FK to account added in issue #7.';
comment on column person.updated_by is
  'account.id of the last editor; FK to account added in issue #7.';

-- ---------------------------------------------------------------------------
-- person_name -- additional names only; the primary name lives on person
-- ---------------------------------------------------------------------------

create table person_name (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  type name_type,
  given_name text,
  surname text,
  prefix text,
  suffix text,
  nickname text,
  sort_order smallint,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index person_name_person_id_idx on person_name (person_id);

-- ---------------------------------------------------------------------------
-- family -- a partnership plus its children; either partner may be absent
-- ---------------------------------------------------------------------------

create table family (
  id uuid primary key default gen_random_uuid(),
  gedcom_xref text,
  partner1_id uuid references person (id) on delete set null,
  partner2_id uuid references person (id) on delete set null,
  partner1_role partner_role,
  partner2_role partner_role,
  relationship_type union_type,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index family_gedcom_xref_uidx
  on family (gedcom_xref)
  where gedcom_xref is not null;

create index family_partner1_id_idx on family (partner1_id);
create index family_partner2_id_idx on family (partner2_id);

-- ---------------------------------------------------------------------------
-- family_child -- membership of a person in a family as a child
-- ---------------------------------------------------------------------------

create table family_child (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family (id) on delete cascade,
  person_id uuid not null references person (id) on delete cascade,
  relation_to_partner1 child_relation,
  relation_to_partner2 child_relation,
  sort_order smallint,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, person_id)
);

-- The unique (family_id, person_id) index serves family_id lookups; the reverse
-- direction (which families is this person a child of) needs its own.
create index family_child_person_id_idx on family_child (person_id);
