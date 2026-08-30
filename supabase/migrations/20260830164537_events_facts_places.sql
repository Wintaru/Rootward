-- Events, facts (attributes), places, and the embedded genealogy-date column set.
-- Spec: docs/SPEC.md §4.1 (date columns), §4.2 (event/fact/place), §10 item 5.
-- Issue #5. Depends on #4 (person, family).
--
-- Deliberately out of scope here (later issues own them, migrations are additive):
--   * the shared updated_at bump trigger over the #4-#8 tables -- issue #7;
--   * RLS enable + policies on every table -- issue #9;
--   * the account foreign key for created_by / updated_by -- issue #7.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type genealogy_date_kind as enum (
  'exact', 'about', 'estimated', 'calculated', 'before', 'after',
  'between', 'from_to', 'interpreted', 'phrase', 'unknown'
);

create type calendar as enum (
  'gregorian', 'julian', 'hebrew', 'french_republican', 'unknown'
);

create type event_owner as enum ('person', 'family');

create type fact_owner as enum ('person', 'family');

create type event_type as enum (
  'birth', 'death', 'marriage', 'divorce', 'burial', 'cremation',
  'christening', 'baptism', 'bar_mitzvah', 'bat_mitzvah', 'confirmation',
  'first_communion', 'adoption', 'graduation', 'immigration', 'emigration',
  'naturalization', 'census', 'residence', 'occupation', 'retirement',
  'will', 'probate', 'engagement', 'marriage_banns', 'annulment', 'other'
);

create type fact_type as enum (
  'eye_color', 'hair_color', 'height', 'weight', 'physical_description',
  'ethnic_origin', 'skin_color', 'religion', 'nationality', 'occupation',
  'education', 'caste', 'title_of_nobility', 'number_of_children',
  'number_of_marriages', 'property', 'national_id', 'ssn', 'medical', 'other'
);

-- Same value set as person_visibility (#4); a distinct type because the fact
-- visibility ladder is evaluated on its own and the two may diverge (SPEC §4.2,
-- §5). Issue #5's enum list does not name it -- the §4.2 fact table requires it.
create type fact_visibility as enum (
  'everyone_approved', 'close_family', 'moderators_only', 'hidden'
);

create type geocode_source as enum ('nominatim', 'manual', 'none');

-- ---------------------------------------------------------------------------
-- Embedded genealogy-date helpers
-- ---------------------------------------------------------------------------
-- The date column set from SPEC §4.1 is embedded flat on event and fact here,
-- and on citation and media in #6 (SPEC §11: flat columns over a composite type,
-- for ORM / `supabase gen types` friendliness). The canonical set is:
--
--   date_value_raw text
--   date_kind      genealogy_date_kind
--   date_year1 / date_month1 / date_day1   smallint   (first date; m, d nullable)
--   date_year2 / date_month2 / date_day2   smallint   (between / from_to; nullable)
--   date_calendar  calendar not null default 'gregorian'
--   date_dual_year boolean                            (1700/01 style dual dating)
--   date_phrase    text                               (phrase / interpreted / unparsed)
--   date_sort_key  date generated  -> genealogy_date_sort_key(year1, month1, day1)
--
-- Copy it verbatim into #6. The generated sort key stays identical across all
-- four tables because every copy calls the one function below.

-- make_date on clamped parts: missing month/day -> 01, out-of-range values
-- pulled back into range so the expression never raises. Null year -> null key
-- (undated rows are excluded from timeline ordering). Immutable, so it is usable
-- in a stored generated column.
create function genealogy_date_sort_key(
  p_year smallint, p_month smallint, p_day smallint
) returns date
language sql
immutable
as $$
  select case
    when p_year is null then null
    else make_date(
           least(greatest(p_year::int, 1), 9999),
           least(greatest(coalesce(p_month, 1)::int, 1), 12),
           1
         )
         + (least(greatest(coalesce(p_day, 1)::int, 1), 31) - 1)
  end
$$;

comment on function genealogy_date_sort_key(smallint, smallint, smallint) is
  'SPEC §4.1 date_sort_key. Null year -> null. Otherwise: year and month clamped '
  'into range, missing month/day -> 1, then day-1 added as days so an '
  'out-of-range day (e.g. Feb 30) rolls forward instead of raising -- a raise '
  'would block the INSERT from the STORED generated column.';

-- ---------------------------------------------------------------------------
-- place -- entered once, deduplicated on normalized_name; lat/long post-MVP
-- ---------------------------------------------------------------------------

create table place (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text,
  locality text,
  county text,
  state text,
  country text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  geocode_source geocode_source,
  geocoded_at timestamptz,
  raw_gedcom jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique among the rows that have a normalized name; the dedupe/lookup key.
create unique index place_normalized_name_uidx
  on place (normalized_name)
  where normalized_name is not null;

-- ---------------------------------------------------------------------------
-- event -- dated life events for a person or a family (SPEC §4.2)
-- ---------------------------------------------------------------------------

create table event (
  id uuid primary key default gen_random_uuid(),
  owner_type event_owner not null,
  person_id uuid references person (id) on delete cascade,
  family_id uuid references family (id) on delete cascade,
  type event_type not null,
  type_other text,
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
  place_id uuid references place (id) on delete set null,
  value text,
  age_text text,
  -- Plain column, trigger-populated below -- not generated: a generated column
  -- may not read another generated column (date_sort_key), and the per-type
  -- tie-break is not a scalar column expression (SPEC §4.2).
  sort_key timestamptz,
  raw_gedcom jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_one_owner check (
    (owner_type = 'person' and person_id is not null and family_id is null)
    or (owner_type = 'family' and family_id is not null and person_id is null)
  )
);

comment on column event.created_by is
  'account.id of the creator; FK to account added in issue #7.';
comment on column event.updated_by is
  'account.id of the last editor; FK to account added in issue #7.';

-- (person_id, sort_key) / (family_id, sort_key): the FK lookup (leftmost prefix)
-- and the per-owner timeline sort in one index each. Partial -- the one-owner
-- CHECK means exactly half the rows are null in each. place_id for the reverse
-- "events at this place" lookup.
create index event_person_id_sort_key_idx on event (person_id, sort_key)
  where person_id is not null;
create index event_family_id_sort_key_idx on event (family_id, sort_key)
  where family_id is not null;
create index event_place_id_idx on event (place_id);

-- Per-event-type ordinal for the intra-day tie-break: birth before christening
-- before ... before death before burial. Unlisted / 'other' land mid-life.
create function event_type_sort_ordinal(p_type event_type)
returns int
language sql
immutable
as $$
  select case p_type
    when 'birth' then 0
    when 'christening' then 1
    when 'baptism' then 2
    when 'bar_mitzvah' then 3
    when 'bat_mitzvah' then 3
    when 'confirmation' then 4
    when 'first_communion' then 4
    when 'adoption' then 5
    when 'graduation' then 6
    when 'engagement' then 7
    when 'marriage_banns' then 8
    when 'marriage' then 9
    when 'annulment' then 10
    when 'divorce' then 11
    when 'immigration' then 12
    when 'emigration' then 12
    when 'naturalization' then 13
    when 'census' then 14
    when 'residence' then 15
    when 'occupation' then 16
    when 'retirement' then 18
    when 'death' then 20
    when 'will' then 21
    when 'probate' then 22
    when 'burial' then 23
    when 'cremation' then 23
    else 17
  end
$$;

-- sort_key = midnight-UTC of the date + the type ordinal as seconds.
-- No date -> null sort_key (order these last with NULLS LAST).
--
-- The trigger recomputes the date from the raw parts through the same helper
-- rather than reading new.date_sort_key: generated columns are evaluated AFTER
-- BEFORE-row triggers, so new.date_sort_key is still null here. Both values come
-- from genealogy_date_sort_key(), so they always agree.
create function event_set_sort_key()
returns trigger
language plpgsql
as $$
declare
  d date := genealogy_date_sort_key(
    new.date_year1, new.date_month1, new.date_day1
  );
begin
  if d is null then
    new.sort_key := null;
  else
    new.sort_key := (d::timestamp at time zone 'UTC')
      + make_interval(secs => event_type_sort_ordinal(new.type));
  end if;
  return new;
end;
$$;

create trigger event_set_sort_key
  before insert or update on event
  for each row
  execute function event_set_sort_key();

-- ---------------------------------------------------------------------------
-- fact -- attributes for a person or a family (SPEC §4.2)
-- person_id / family_id cascade on delete: SPEC §4.2 is silent for fact but
-- states it for event, and the ownership model is identical.
-- ---------------------------------------------------------------------------

create table fact (
  id uuid primary key default gen_random_uuid(),
  owner_type fact_owner not null,
  person_id uuid references person (id) on delete cascade,
  family_id uuid references family (id) on delete cascade,
  type fact_type not null,
  type_other text,
  value text,
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
  place_id uuid references place (id) on delete set null,
  visibility fact_visibility not null default 'everyone_approved',
  -- Always hidden from non-moderators regardless of visibility (SPEC §5,
  -- decision 6).
  is_sensitive boolean generated always as (
    type in ('ssn', 'national_id', 'medical')
  ) stored,
  raw_gedcom jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fact_one_owner check (
    (owner_type = 'person' and person_id is not null and family_id is null)
    or (owner_type = 'family' and family_id is not null and person_id is null)
  )
);

comment on column fact.created_by is
  'account.id of the creator; FK to account added in issue #7.';
comment on column fact.updated_by is
  'account.id of the last editor; FK to account added in issue #7.';

create index fact_person_id_idx on fact (person_id);
create index fact_family_id_idx on fact (family_id);
create index fact_place_id_idx on fact (place_id);
